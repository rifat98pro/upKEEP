/**
 * `upkeep.conditions.*`
 *
 * Create, read and control persistent financial conditions. This is the API the
 * reference dashboard uses; there is no private path around it.
 */
import {
  decodeEventLog,
  encodeAbiParameters,
  type Address,
  type Hash,
  type PublicClient,
} from 'viem';
import { conditionRegistryAbi } from './abi.js';
import type { UpkeepAddresses, UpkeepContext } from './client.js';
import { ValidationError, UnsupportedTypeError, WalletRequiredError } from './errors.js';
import {
  ARM_STATE_BY_ORDINAL,
  CONDITION_STATUS_BY_ORDINAL,
  type Action,
  type Condition,
  type ConditionView,
} from './core/types.js';
import {
  actionTypeFor,
  conditionTypeFor,
  isScheduleType,
  getActionType,
  getConditionType,
  availableActionTypes,
  availableConditionTypes,
  type ActionTypeName,
  type ConditionTypeName,
} from './core/kinds.js';
import { toUsdcWei } from './core/units.js';
import type { SupportedAsset } from './config/tokens.js';
import { sendArcTransaction } from './tx.js';
import { readBatchAllowFailure } from './internal/multicall.js';

/*//////////////////////////////////////////////////////////////
                           PUBLIC INPUT
//////////////////////////////////////////////////////////////*/

export interface CreateConditionInput {
  /**
   * What the condition watches. For balance conditions, the wallet whose USDC
   * balance is monitored. Aliased as `subject` for non-wallet condition types.
   */
  wallet?: Address;
  subject?: Address;

  /** Condition type. V1 enables BALANCE_BELOW. */
  type: ConditionTypeName;

  /** V1 supports USDC only. */
  asset?: SupportedAsset;

  /**
   * What the condition compares against.
   *
   * For balance types this is money: a human string ("5000") or a bigint of
   * native wei. For schedule types it is a moment in time - a `Date`, an ISO
   * string, or Unix **seconds** - and for a repeating schedule it means "not
   * before this", i.e. when the schedule starts.
   */
  threshold: string | bigint | Date;

  /**
   * Makes a schedule repeat. Omit it for a one-off deadline.
   *
   * `every` is the cycle length and `window` is how long the condition stays
   * firable within each cycle. The window must be long enough for your keeper
   * to notice - a 30-second poll against a 10-second window will miss cycles.
   *
   * Cycles are anchored to the Unix epoch, so `every: 86400` means midnight UTC
   * rather than "24 hours from now".
   */
  schedule?: {
    /** Cycle length in seconds. */
    every: number;
    /** Firing window in seconds. Must be > 0 and < `every`. */
    window: number;
  };

  /**
   * How far the subject must recover before the condition can fire again.
   *
   * Defaults to 0. A non-zero buffer is strongly recommended for a value that
   * hovers near the threshold: without it, a balance oscillating by one wei
   * around the boundary can fire repeatedly.
   */
  rearmBuffer?: string | bigint;

  /** False makes this a one-shot condition that retires after firing. Default true. */
  recurring?: boolean;

  /** The vault funding the action. Create one with `upkeep.vaults.create`. */
  vault: Address;

  action: {
    type: ActionTypeName;
    /** Amount released per execution. */
    amount: string | bigint;
    /** The one approved destination. Must match the vault's approved recipient. */
    recipient: Address;
    /**
     * Ceiling the owner authorizes per execution. Defaults to `amount`.
     * Must not exceed the vault's own per-execution limit.
     */
    maxAmount?: string | bigint;
  };
}

export interface CreateConditionResult {
  conditionId: string;
  actionId: string;
  transactionHash: Hash;
  explorerUrl: string;
}

export interface ConditionsApi {
  create: (input: CreateConditionInput) => Promise<CreateConditionResult>;
  get: (conditionId: string | bigint) => Promise<ConditionView>;
  list: (owner?: Address) => Promise<ConditionView[]>;
  listAll: () => Promise<ConditionView[]>;
  ids: (owner: Address) => Promise<bigint[]>;
  pause: (conditionId: string | bigint) => Promise<Hash>;
  resume: (conditionId: string | bigint) => Promise<Hash>;
  disable: (conditionId: string | bigint) => Promise<Hash>;
  rearm: (conditionId: string | bigint) => Promise<Hash>;
}

/*//////////////////////////////////////////////////////////////
                            SCHEDULES
//////////////////////////////////////////////////////////////*/

/** Seconds in a day, the largest cycle the UI offers. */
const MAX_CYCLE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Coerce a moment into Unix **seconds**.
 *
 * Deliberately strict about milliseconds: `Date.now()` is milliseconds and
 * passing it raw would schedule something for the year 55000. A bare number is
 * therefore only accepted when it is plausibly seconds.
 */
function toUnixSeconds(value: string | bigint | Date): bigint {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) throw new ValidationError('The scheduled time is not a valid date.');
    return BigInt(Math.floor(ms / 1000));
  }

  if (typeof value === 'bigint') return value;

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (asNumber > 1e12) {
      throw new ValidationError(
        'The scheduled time looks like milliseconds. Pass a Date, an ISO string, or Unix seconds.',
      );
    }
    return BigInt(trimmed);
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new ValidationError(`Could not read "${value}" as a date or time.`);
  }
  return BigInt(Math.floor(parsed / 1000));
}

/**
 * Encode a repeating schedule for the evaluator.
 *
 * Mirrors ScheduleEvaluator's own validation so a bad schedule is a clear error
 * here rather than a revert after signing. The evaluator re-checks regardless -
 * this is convenience, not the guarantee.
 */
function encodeSchedule(schedule: { every: number; window: number }): `0x${string}` {
  const { every, window } = schedule;

  if (!Number.isInteger(every) || !Number.isInteger(window)) {
    throw new ValidationError('Schedule `every` and `window` must be whole seconds.');
  }
  if (every <= 0) throw new ValidationError('Schedule `every` must be greater than zero.');
  if (every > MAX_CYCLE_SECONDS) {
    throw new ValidationError('Schedule `every` cannot exceed one year.');
  }
  if (window <= 0) {
    throw new ValidationError('Schedule `window` must be greater than zero, or it never fires.');
  }
  if (window >= every) {
    throw new ValidationError(
      'Schedule `window` must be shorter than `every`, or the condition fires once and never re-arms.',
    );
  }

  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [BigInt(every), BigInt(window)],
  );
}

/*//////////////////////////////////////////////////////////////
                             MAPPING
//////////////////////////////////////////////////////////////*/

interface RawCondition {
  owner: Address;
  subject: Address;
  threshold: bigint;
  rearmBuffer: bigint;
  actionId: bigint;
  kind: number;
  operator: number;
  status: number;
  arm: number;
  recurring: boolean;
  triggerCount: number;
  createdAt: bigint;
  lastEvaluatedAt: bigint;
  lastTriggeredAt: bigint;
}

interface RawAction {
  kind: number;
  vault: Address;
  recipient: Address;
  amount: bigint;
  maxAmount: bigint;
}

function isoOrUndefined(unixSeconds: bigint): string | undefined {
  if (unixSeconds === 0n) return undefined;
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

function mapCondition(id: bigint, raw: RawCondition): Condition {
  return {
    id: id.toString(),
    owner: raw.owner,
    type: conditionTypeFor(raw.kind, raw.operator),
    kind: raw.kind,
    operator: raw.operator,
    status: CONDITION_STATUS_BY_ORDINAL[raw.status] ?? 'none',
    arm: ARM_STATE_BY_ORDINAL[raw.arm] ?? 'armed',
    subject: raw.subject,
    asset: 'USDC',
    threshold: raw.threshold,
    rearmBuffer: raw.rearmBuffer,
    actionId: raw.actionId.toString(),
    recurring: raw.recurring,
    triggerCount: Number(raw.triggerCount),
    createdAt: new Date(Number(raw.createdAt) * 1000).toISOString(),
    lastEvaluatedAt: isoOrUndefined(raw.lastEvaluatedAt),
    lastTriggeredAt: isoOrUndefined(raw.lastTriggeredAt),
  };
}

function mapAction(id: bigint, raw: RawAction): Action {
  return {
    id: id.toString(),
    type: actionTypeFor(raw.kind),
    kind: raw.kind,
    vault: raw.vault,
    recipient: raw.recipient,
    amount: raw.amount,
    maxAmount: raw.maxAmount,
  };
}

/**
 * Distance to trigger, in the direction the condition actually fires.
 *
 * For a "below" condition it is how far the value can still fall; for an
 * "above" condition, how far it can still rise. Zero once the predicate is true.
 */
function distanceToTrigger(condition: Condition, currentValue: bigint): bigint {
  const firesWhenBelow = condition.type === 'BALANCE_BELOW' || condition.operator === 1;
  if (firesWhenBelow) {
    return currentValue > condition.threshold ? currentValue - condition.threshold : 0n;
  }
  return currentValue < condition.threshold ? condition.threshold - currentValue : 0n;
}

function toView(
  conditionId: bigint,
  raw: [RawCondition, RawAction, bigint, boolean, boolean],
): ConditionView {
  const [rawCondition, rawAction, currentValue, executable, rearmable] = raw;
  const condition = mapCondition(conditionId, rawCondition);

  return {
    condition,
    action: mapAction(rawCondition.actionId, rawAction),
    currentValue,
    distanceToTrigger: distanceToTrigger(condition, currentValue),
    executable,
    rearmable,
  };
}

/*//////////////////////////////////////////////////////////////
                               API
//////////////////////////////////////////////////////////////*/

const availableConditionTypeNames = () => availableConditionTypes().map((t) => t.name);
const availableActionTypeNames = () => availableActionTypes().map((t) => t.name);

export function createConditionsApi(ctx: UpkeepContext): ConditionsApi {
  const registry = () => ctx.requireAddresses().conditionRegistry;

  async function readView(
    conditionId: bigint,
    addresses: UpkeepAddresses,
    client: PublicClient,
  ): Promise<ConditionView> {
    const result = (await client.readContract({
      address: addresses.conditionRegistry,
      abi: conditionRegistryAbi,
      functionName: 'getConditionView',
      args: [conditionId],
    })) as unknown as [RawCondition, RawAction, bigint, boolean, boolean];

    return toView(conditionId, result);
  }

  async function lifecycleCall(functionName: string, conditionId: string | bigint): Promise<Hash> {
    if (!ctx.walletClient || !ctx.account) throw new WalletRequiredError(functionName);

    return sendArcTransaction(ctx, {
      address: registry(),
      abi: conditionRegistryAbi,
      functionName,
      args: [BigInt(conditionId)],
    });
  }

  return {
    /**
     * Create a persistent condition and the single action bound to it.
     *
     * Validation happens here as well as on-chain, so a mistake is a clear
     * error before a transaction is signed rather than a revert after.
     */
    async create(input) {
      // Validate the request before checking for a wallet, so a developer
      // learns their condition type or amount is wrong even on a read-only
      // client, rather than being told only that a wallet is missing.
      const conditionType = getConditionType(input.type);
      if (!conditionType.available) {
        throw new UnsupportedTypeError(
          input.type,
          availableConditionTypeNames(),
        );
      }

      const actionType = getActionType(input.action.type);
      if (!actionType.available) {
        throw new UnsupportedTypeError(input.action.type, availableActionTypeNames());
      }

      if (input.asset && input.asset !== 'USDC') {
        throw new UnsupportedTypeError(input.asset, ['USDC']);
      }

      const subject = input.subject ?? input.wallet;
      if (!subject) {
        throw new ValidationError('A `wallet` (or `subject`) to monitor is required.');
      }

      /*
       * The threshold slot holds money for a balance condition and a Unix
       * timestamp for a schedule. Parsing it as dollars either way would turn
       * "fire on March 1st" into an eighteen-decimal fortune.
       */
      const isSchedule = isScheduleType(input.type);

      if (isSchedule && input.type === 'SCHEDULE_EVERY' && !input.schedule) {
        throw new ValidationError(
          'SCHEDULE_EVERY needs a `schedule` ({ every, window }). Use SCHEDULE_AT for a one-off.',
        );
      }
      if (input.schedule && input.type !== 'SCHEDULE_EVERY') {
        throw new ValidationError(
          `A \`schedule\` only applies to SCHEDULE_EVERY, not ${input.type}.`,
        );
      }

      const params = input.schedule ? encodeSchedule(input.schedule) : '0x';

      const threshold = isSchedule
        ? toUnixSeconds(input.threshold)
        : toUsdcWei(input.threshold as string | bigint);

      /*
       * Hysteresis is inherent to a schedule - the gap between windows is the
       * buffer - so the evaluator ignores rearmBuffer entirely. Forcing it to
       * zero keeps a stray value from looking meaningful on the condition page.
       */
      const rearmBuffer =
        isSchedule || !input.rearmBuffer ? 0n : toUsdcWei(input.rearmBuffer);

      const amount = toUsdcWei(input.action.amount);
      const maxAmount = input.action.maxAmount ? toUsdcWei(input.action.maxAmount) : amount;

      if (threshold <= 0n) throw new ValidationError('Threshold must be greater than zero.');
      if (amount <= 0n) throw new ValidationError('Action amount must be greater than zero.');
      if (amount > maxAmount) {
        throw new ValidationError('Action amount cannot exceed the authorized maximum.');
      }
      if (threshold > 2n ** 128n - 1n || maxAmount > 2n ** 128n - 1n) {
        throw new ValidationError('Amount is too large to store on-chain.');
      }

      // Everything about the request is sound; now it needs somewhere to go
      // and someone to sign it.
      const addresses = ctx.requireAddresses();
      if (!ctx.walletClient || !ctx.account) throw new WalletRequiredError('conditions.create');

      const transactionHash = await sendArcTransaction(ctx, {
        address: addresses.conditionRegistry,
        abi: conditionRegistryAbi,
        functionName: 'createCondition',
        args: [
          {
            kind: conditionType.kind,
            operator: conditionType.operator,
            subject,
            threshold,
            rearmBuffer,
            recurring: input.recurring ?? true,
            params,
            actionKind: actionType.kind,
            vault: input.vault,
            recipient: input.action.recipient,
            amount,
            maxAmount,
          },
        ],
      });

      // Read the ids back from the receipt rather than guessing them.
      const receipt = await ctx.publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        confirmations: 1,
      });

      let conditionId = '';
      let actionId = '';
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: conditionRegistryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'ConditionCreated') {
            const args = decoded.args as unknown as { conditionId: bigint; actionId: bigint };
            conditionId = args.conditionId.toString();
            actionId = args.actionId.toString();
            break;
          }
        } catch {
          // Not one of our events; ignore.
        }
      }

      if (!conditionId) {
        throw new Error(
          'The condition transaction confirmed but no ConditionCreated event was found.',
        );
      }

      return {
        conditionId,
        actionId,
        transactionHash,
        explorerUrl: `${ctx.explorerUrl.replace(/\/$/, '')}/tx/${transactionHash}`,
      };
    },

    async get(conditionId) {
      const addresses = ctx.requireAddresses();
      return readView(BigInt(conditionId), addresses, ctx.publicClient);
    },

    async ids(owner) {
      const ids = await ctx.publicClient.readContract({
        address: registry(),
        abi: conditionRegistryAbi,
        functionName: 'conditionsOf',
        args: [owner],
      });
      return [...(ids as readonly bigint[])];
    },

    /** Every condition belonging to an owner, newest first. */
    async list(owner) {
      const addresses = ctx.requireAddresses();
      const target = owner ?? ctx.account;
      if (!target) throw new ValidationError('An owner address is required.');

      const ids = await this.ids(target);
      if (ids.length === 0) return [];

      const results = await readBatchAllowFailure(
        ctx.publicClient,
        ids.map((id) => ({
          address: addresses.conditionRegistry,
          abi: conditionRegistryAbi,
          functionName: 'getConditionView',
          args: [id],
        })),
      );

      const views: ConditionView[] = [];
      results.forEach((result, index) => {
        if (result.status !== 'success') return;
        views.push(
          toView(ids[index], result.result as unknown as [RawCondition, RawAction, bigint, boolean, boolean]),
        );
      });

      return views.reverse();
    },

    /** Every condition in the registry. Used by the keeper's evaluation sweep. */
    async listAll() {
      const addresses = ctx.requireAddresses();

      const total = (await ctx.publicClient.readContract({
        address: addresses.conditionRegistry,
        abi: conditionRegistryAbi,
        functionName: 'totalConditions',
      })) as bigint;

      if (total === 0n) return [];

      const ids = Array.from({ length: Number(total) }, (_, i) => BigInt(i + 1));

      const results = await readBatchAllowFailure(
        ctx.publicClient,
        ids.map((id) => ({
          address: addresses.conditionRegistry,
          abi: conditionRegistryAbi,
          functionName: 'getConditionView',
          args: [id],
        })),
      );

      const views: ConditionView[] = [];
      results.forEach((result, index) => {
        if (result.status !== 'success') return;
        views.push(
          toView(ids[index], result.result as unknown as [RawCondition, RawAction, bigint, boolean, boolean]),
        );
      });

      return views;
    },

    pause: (conditionId) => lifecycleCall('pauseCondition', conditionId),
    resume: (conditionId) => lifecycleCall('resumeCondition', conditionId),
    disable: (conditionId) => lifecycleCall('disableCondition', conditionId),
    /** Permissionless: anyone may pay the gas to re-arm a recovered condition. */
    rearm: (conditionId) => lifecycleCall('rearm', conditionId),
  };
}
