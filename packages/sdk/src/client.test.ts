/**
 * SDK surface tests.
 *
 * These assert the shape of the developer-facing API and, importantly, that an
 * unconfigured or read-only client fails loudly instead of doing something
 * plausible-looking with missing addresses.
 */
import { describe, it, expect } from 'vitest';
import { createUpkeepClient } from './client.js';
import {
  ProtocolNotConfiguredError,
  UnsupportedTypeError,
  WalletRequiredError,
} from './errors.js';
import { ARC_MAINNET_CHAIN_ID } from './config/chains.js';
import {
  availableConditionTypes,
  CONDITION_TYPES,
  conditionTypeFor,
  getConditionType,
  OP_LT,
  KIND_BALANCE_THRESHOLD,
} from './core/kinds.js';
import { parseUsdc } from './core/units.js';

const ADDRESSES = {
  conditionRegistry: '0x1111111111111111111111111111111111111111',
  automationExecutor: '0x2222222222222222222222222222222222222222',
  vaultFactory: '0x3333333333333333333333333333333333333333',
} as const;

describe('createUpkeepClient', () => {
  it('defaults to Arc Mainnet', () => {
    const upkeep = createUpkeepClient();
    expect(upkeep.chain.id).toBe(ARC_MAINNET_CHAIN_ID);
    expect(upkeep.chain.name).toBe('Arc Mainnet');
    // Arc's native currency is USDC, not ETH.
    expect(upkeep.chain.nativeCurrency.symbol).toBe('USDC');
    expect(upkeep.chain.nativeCurrency.decimals).toBe(18);
  });

  it('reports that it is unconfigured rather than guessing addresses', () => {
    const upkeep = createUpkeepClient();
    expect(upkeep.isConfigured).toBe(false);
    expect(upkeep.addresses).toBeNull();
  });

  it('refuses protocol reads when no addresses are configured', async () => {
    const upkeep = createUpkeepClient();
    await expect(upkeep.conditions.get(1n)).rejects.toThrow(ProtocolNotConfiguredError);
  });

  it('names the missing addresses in the error', async () => {
    const upkeep = createUpkeepClient({
      addresses: { conditionRegistry: ADDRESSES.conditionRegistry },
    });
    await expect(upkeep.conditions.get(1n)).rejects.toThrow(/automationExecutor/);
  });

  it('is read-only without a wallet client', () => {
    const upkeep = createUpkeepClient({ addresses: ADDRESSES });
    expect(upkeep.isConfigured).toBe(true);
    expect(upkeep.canWrite).toBe(false);
  });

  it('refuses writes without a wallet', async () => {
    const upkeep = createUpkeepClient({ addresses: ADDRESSES });

    await expect(
      upkeep.conditions.create({
        wallet: '0x4444444444444444444444444444444444444444',
        type: 'BALANCE_BELOW',
        threshold: '5000',
        vault: '0x5555555555555555555555555555555555555555',
        action: {
          type: 'TRANSFER_USDC',
          amount: '1000',
          recipient: '0x6666666666666666666666666666666666666666',
        },
      }),
    ).rejects.toThrow(WalletRequiredError);
  });

  it('accepts either balance direction and still requires a wallet', async () => {
    const upkeep = createUpkeepClient({ addresses: ADDRESSES });

    // Both directions pass type validation; the wallet check is what stops them.
    for (const type of ['BALANCE_BELOW', 'BALANCE_ABOVE'] as const) {
      await expect(
        upkeep.conditions.create({
          wallet: '0x4444444444444444444444444444444444444444',
          type,
          threshold: '5000',
          vault: '0x5555555555555555555555555555555555555555',
          action: {
            type: 'TRANSFER_USDC',
            amount: '1000',
            recipient: '0x6666666666666666666666666666666666666666',
          },
        }),
      ).rejects.toThrow(WalletRequiredError);
    }
  });

  it('still refuses an action type that is not implemented', async () => {
    const upkeep = createUpkeepClient({ addresses: ADDRESSES });
    await expect(
      upkeep.conditions.create({
        wallet: '0x4444444444444444444444444444444444444444',
        type: 'BALANCE_BELOW',
        threshold: '5000',
        vault: '0x5555555555555555555555555555555555555555',
        action: {
          // Not in the catalog: adding an action changes what upKEEP may do
          // with user funds, so it stays a deliberate, audited addition.
          type: 'PAUSE_AUTOMATION' as 'TRANSFER_USDC',
          amount: '1000',
          recipient: '0x6666666666666666666666666666666666666666',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('fee quoting through the client', () => {
  it('quotes $0.50 on a $1,000 execution', () => {
    const upkeep = createUpkeepClient();
    const quote = upkeep.fees.quote(parseUsdc('1000'));

    expect(quote.fee).toBe(parseUsdc('0.50'));
    expect(quote.netAmount).toBe(parseUsdc('999.50'));
  });

  it('honours a custom rate', () => {
    const upkeep = createUpkeepClient({ feeBps: 10 });
    expect(upkeep.fees.quote(parseUsdc('1000')).fee).toBe(parseUsdc('1.00'));
  });
});

describe('the engine catalog', () => {
  /**
   * Both balance directions are enabled. They share one on-chain evaluator, so
   * the second is a catalog entry rather than a second contract - which is the
   * engine's reuse claim being cashed in rather than asserted.
   */
  it('enables two evaluators, four condition types and one action type', () => {
    const upkeep = createUpkeepClient();

    const conditions = upkeep.engine.conditionTypes().map((t) => t.name);
    expect(conditions).toContain('BALANCE_BELOW');
    expect(conditions).toContain('BALANCE_ABOVE');
    expect(conditions).toContain('SCHEDULE_AT');
    expect(conditions).toContain('SCHEDULE_EVERY');
    expect(conditions).toHaveLength(4);

    // Four types, two deployed evaluators. That ratio is the engine claim.
    const kinds = new Set(upkeep.engine.conditionTypes().map((t) => t.kind));
    expect(kinds.size).toBe(2);

    const actions = upkeep.engine.actionTypes();
    expect(actions).toHaveLength(1);
    expect(actions[0].name).toBe('TRANSFER_USDC');
  });

  it('runs both directions on the same evaluator', () => {
    const below = getConditionType('BALANCE_BELOW');
    const above = getConditionType('BALANCE_ABOVE');
    // Same kind means one deployed contract serves both.
    expect(above.kind).toBe(below.kind);
    expect(above.operator).not.toBe(below.operator);
  });

  it('runs both schedule shapes on the same evaluator', () => {
    const at = getConditionType('SCHEDULE_AT');
    const every = getConditionType('SCHEDULE_EVERY');
    expect(every.kind).toBe(at.kind);
    // Identical (kind, operator): only the params payload tells them apart.
    expect(every.operator).toBe(at.operator);
    expect(every.usesParams).toBe(true);
    expect(at.usesParams).toBeUndefined();
  });

  it('marks schedules as measuring time, not money', () => {
    // Anything formatting a threshold has to know which it is holding.
    expect(getConditionType('SCHEDULE_AT').thresholdUnit).toBe('timestamp');
    expect(getConditionType('BALANCE_BELOW').thresholdUnit).toBe('usdc');
  });

  it('tells the two schedule shapes apart by their payload', () => {
    const at = getConditionType('SCHEDULE_AT');
    expect(conditionTypeFor(at.kind, at.operator, false)).toBe('SCHEDULE_AT');
    expect(conditionTypeFor(at.kind, at.operator, true)).toBe('SCHEDULE_EVERY');
  });

  it('lists planned types separately so nothing unimplemented looks available', () => {
    const upkeep = createUpkeepClient();
    const planned = upkeep.engine.plannedConditionTypes();

    expect(planned.length).toBeGreaterThan(0);
    const availableNames = upkeep.engine.conditionTypes().map((t) => t.name);
    for (const type of planned) {
      expect(availableNames).not.toContain(type.name);
    }
  });

  it('maps BALANCE_BELOW to the on-chain evaluator kind and operator', () => {
    expect(CONDITION_TYPES.BALANCE_BELOW.kind).toBe(KIND_BALANCE_THRESHOLD);
    expect(CONDITION_TYPES.BALANCE_BELOW.operator).toBe(OP_LT);
  });

  it('round-trips an on-chain pair back to a friendly name', () => {
    expect(conditionTypeFor(KIND_BALANCE_THRESHOLD, OP_LT)).toBe('BALANCE_BELOW');
    expect(conditionTypeFor(99, 99)).toBeUndefined();
  });

  it('shares one evaluator between both balance directions', () => {
    // Proof the engine abstraction is real: two condition types, one evaluator.
    expect(CONDITION_TYPES.BALANCE_ABOVE.kind).toBe(CONDITION_TYPES.BALANCE_BELOW.kind);
    expect(CONDITION_TYPES.BALANCE_ABOVE.operator).not.toBe(CONDITION_TYPES.BALANCE_BELOW.operator);
  });

  it('only reports available types as available', () => {
    expect(availableConditionTypes().every((t) => t.available)).toBe(true);
  });
});
