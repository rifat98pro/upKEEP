/**
 * Condition engine tests.
 *
 * The property that matters most: a condition that simply stays true must
 * produce exactly one execution, not one per polling cycle.
 *
 * Note the division of labour being tested here. The chain decides whether the
 * predicate holds (`executable` / `rearmable` come from the registry, which
 * evaluates on-chain). This function decides whether the *action* could
 * succeed, and it is those vault checks plus the latch logic that are under
 * test below.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCondition, evaluateConditions, summarizeDecisions } from './engine.js';
import { parseUsdc } from './units.js';
import type { ConditionView, VaultInfo } from './types.js';

const OWNER = '0x1111111111111111111111111111111111111111' as const;
const SUBJECT = '0x2222222222222222222222222222222222222222' as const;
const RECIPIENT = '0x3333333333333333333333333333333333333333' as const;
const VAULT = '0x4444444444444444444444444444444444444444' as const;
const EXECUTOR = '0x5555555555555555555555555555555555555555' as const;

const THRESHOLD = parseUsdc('5000');
const REARM_BUFFER = parseUsdc('100');
const AMOUNT = parseUsdc('1000');

type ViewOverrides = Partial<ConditionView['condition']> & {
  value?: bigint;
  executable?: boolean;
  rearmable?: boolean;
};

function makeView(overrides: ViewOverrides = {}): ConditionView {
  const {
    value = parseUsdc('8420'),
    executable,
    rearmable,
    ...conditionOverrides
  } = overrides;

  const condition: ConditionView['condition'] = {
    id: '1',
    owner: OWNER,
    type: 'BALANCE_BELOW',
    kind: 1,
    operator: 1,
    status: 'active',
    arm: 'armed',
    subject: SUBJECT,
    asset: 'USDC',
    threshold: THRESHOLD,
    rearmBuffer: REARM_BUFFER,
    actionId: '1',
    recurring: true,
    triggerCount: 0,
    createdAt: '2026-09-21T00:00:00.000Z',
    ...conditionOverrides,
  };

  // Mirror what the on-chain BalanceThresholdEvaluator would report, unless the
  // test states otherwise.
  const predicateTrue = value < condition.threshold;

  return {
    condition,
    action: {
      id: '1',
      type: 'TRANSFER_USDC',
      kind: 1,
      vault: VAULT,
      recipient: RECIPIENT,
      amount: AMOUNT,
      maxAmount: AMOUNT,
    },
    currentValue: value,
    distanceToTrigger: value > THRESHOLD ? value - THRESHOLD : 0n,
    executable:
      executable ?? (condition.status === 'active' && condition.arm === 'armed' && predicateTrue),
    rearmable:
      rearmable ??
      (condition.arm === 'fired' &&
        condition.status === 'triggered' &&
        condition.recurring &&
        value >= condition.threshold + condition.rearmBuffer),
  };
}

function makeVault(overrides: Partial<VaultInfo> = {}): VaultInfo {
  return {
    address: VAULT,
    owner: OWNER,
    executor: EXECUTOR,
    recipient: RECIPIENT,
    maxPerExecution: AMOUNT,
    maxPerDay: 0n,
    spentToday: 0n,
    balance: parseUsdc('5000'),
    paused: false,
    feeBps: 5,
    revoked: false,
    ...overrides,
  };
}

describe('the headline rule', () => {
  it('does nothing while the balance is healthy', () => {
    const decision = evaluateCondition(makeView({ value: parseUsdc('8420') }), makeVault());
    expect(decision.kind).toBe('skip');
    expect(decision.code).toBe('predicate-false');
  });

  it('executes when the balance falls below the threshold', () => {
    const decision = evaluateCondition(makeView({ value: parseUsdc('4200') }), makeVault());
    expect(decision.kind).toBe('execute');
    expect(decision.code).toBe('trigger-armed');
  });

  it('treats a balance exactly at the threshold as healthy', () => {
    // The predicate is strictly "<", so equality must not fire.
    expect(evaluateCondition(makeView({ value: THRESHOLD }), makeVault()).kind).toBe('skip');
  });

  it('fires one wei below the threshold', () => {
    expect(evaluateCondition(makeView({ value: THRESHOLD - 1n }), makeVault()).kind).toBe('execute');
  });
});

describe('repeated execution prevention', () => {
  it('does not execute again while the condition stays true', () => {
    const view = makeView({
      value: parseUsdc('4900'),
      status: 'triggered',
      arm: 'fired',
      triggerCount: 1,
    });

    // Poll twenty times. The balance never recovers.
    for (let i = 0; i < 20; i++) {
      expect(evaluateCondition(view, makeVault()).kind).toBe('skip');
    }
  });

  it('does not re-arm inside the hysteresis band', () => {
    const decision = evaluateCondition(
      makeView({
        value: THRESHOLD + REARM_BUFFER - 1n,
        status: 'triggered',
        arm: 'fired',
        triggerCount: 1,
      }),
      makeVault(),
    );
    expect(decision.kind).toBe('skip');
    expect(decision.code).toBe('inside-hysteresis');
  });

  it('re-arms once the value clears the re-arm level', () => {
    const decision = evaluateCondition(
      makeView({
        value: THRESHOLD + REARM_BUFFER,
        status: 'triggered',
        arm: 'fired',
        triggerCount: 1,
      }),
      makeVault(),
    );
    expect(decision.kind).toBe('rearm');
    expect(decision.code).toBe('predicate-recovered');
  });

  it('walks the full cycle: fire, hold, recover, fire again', () => {
    const vault = makeVault();

    // 1. Healthy.
    expect(evaluateCondition(makeView({ value: parseUsdc('8000') }), vault).kind).toBe('skip');

    // 2. Drops -> executes.
    expect(evaluateCondition(makeView({ value: parseUsdc('4000') }), vault).kind).toBe('execute');

    // 3. Now fired, still low -> holds.
    const fired = makeView({
      value: parseUsdc('4000'),
      status: 'triggered',
      arm: 'fired',
      triggerCount: 1,
    });
    expect(evaluateCondition(fired, vault).kind).toBe('skip');

    // 4. Recovers -> re-arms.
    const recovered = makeView({
      value: parseUsdc('9000'),
      status: 'triggered',
      arm: 'fired',
      triggerCount: 1,
    });
    expect(evaluateCondition(recovered, vault).kind).toBe('rearm');

    // 5. Armed again and drops -> executes again.
    const rearmed = makeView({
      value: parseUsdc('4000'),
      status: 'active',
      arm: 'armed',
      triggerCount: 1,
    });
    expect(evaluateCondition(rearmed, vault).kind).toBe('execute');
  });

  it('never re-arms a one-shot condition', () => {
    const decision = evaluateCondition(
      makeView({
        value: parseUsdc('9000'),
        status: 'executed',
        arm: 'fired',
        recurring: false,
      }),
      makeVault(),
    );
    expect(decision.kind).toBe('skip');
    expect(decision.code).toBe('one-shot-complete');
  });
});

describe('lifecycle gates', () => {
  it.each([
    ['paused', 'paused'],
    ['disabled', 'disabled'],
    ['executed', 'one-shot-complete'],
  ] as const)('skips a %s condition even when the value is low', (status, code) => {
    const decision = evaluateCondition(
      makeView({ value: parseUsdc('100'), status, executable: true }),
      makeVault(),
    );
    expect(decision.kind).toBe('skip');
    expect(decision.code).toBe(code);
  });
});

describe('vault permission gates', () => {
  const due = () => makeView({ value: parseUsdc('4000') });

  it('skips when the vault is paused', () => {
    expect(evaluateCondition(due(), makeVault({ paused: true })).code).toBe('vault-paused');
  });

  it('skips when automation has been revoked', () => {
    expect(evaluateCondition(due(), makeVault({ revoked: true })).code).toBe('vault-revoked');
  });

  it('skips when the vault has no executor', () => {
    const decision = evaluateCondition(
      due(),
      makeVault({ executor: '0x0000000000000000000000000000000000000000' }),
    );
    expect(decision.code).toBe('vault-revoked');
  });

  it('skips when the vault is underfunded', () => {
    expect(evaluateCondition(due(), makeVault({ balance: parseUsdc('10') })).code).toBe(
      'vault-underfunded',
    );
  });

  it('skips when the action exceeds the vault limit', () => {
    expect(evaluateCondition(due(), makeVault({ maxPerExecution: parseUsdc('10') })).code).toBe(
      'vault-limit-exceeded',
    );
  });

  it('skips when the vault approves a different recipient', () => {
    const decision = evaluateCondition(
      due(),
      makeVault({ recipient: '0x9999999999999999999999999999999999999999' }),
    );
    expect(decision.code).toBe('recipient-mismatch');
  });

  it('skips when the vault could not be read', () => {
    expect(evaluateCondition(due(), null).code).toBe('vault-unknown');
  });

  it('is case-insensitive about recipient addresses', () => {
    const decision = evaluateCondition(
      due(),
      makeVault({ recipient: '0x3333333333333333333333333333333333333333'.toUpperCase().replace('0X', '0x') as typeof RECIPIENT }),
    );
    expect(decision.kind).toBe('execute');
  });
});

describe('batch evaluation', () => {
  it('summarizes a mixed batch', () => {
    const views = [
      makeView({ value: parseUsdc('4000') }), // execute
      makeView({ value: parseUsdc('9000') }), // skip
      makeView({ value: parseUsdc('9000'), status: 'triggered', arm: 'fired' }), // rearm
    ];
    const vaults = new Map([[VAULT.toLowerCase(), makeVault()]]);

    const summary = summarizeDecisions(evaluateConditions(views, vaults));

    expect(summary.evaluated).toBe(3);
    expect(summary.toExecute).toHaveLength(1);
    expect(summary.toRearm).toHaveLength(1);
    expect(summary.skipped).toHaveLength(1);
  });

  it('looks vaults up case-insensitively', () => {
    const views = [makeView({ value: parseUsdc('4000') })];
    // A map keyed with the checksummed address must still resolve.
    const vaults = new Map([[VAULT.toLowerCase(), makeVault()]]);
    expect(evaluateConditions(views, vaults)[0].kind).toBe('execute');
  });
});
