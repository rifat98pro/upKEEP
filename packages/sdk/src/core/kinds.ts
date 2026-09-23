/**
 * The upKEEP engine catalog.
 *
 * upKEEP is a condition engine. A condition is a generic triple - subject,
 * operator, threshold - interpreted by a registered evaluator and bound to an
 * action. This file is the catalog of the condition and action types the SDK
 * knows how to express, and the mapping between the friendly names developers
 * write and the (kind, operator) pairs the contracts store.
 *
 * Adding a condition type to upKEEP means:
 *   1. deploy an IConditionEvaluator contract
 *   2. register it on the ConditionRegistry
 *   3. add one entry here so the SDK can express it
 *
 * No change to the registry, the executor, or anything holding funds.
 *
 * V1 enables both balance directions against TRANSFER_USDC, from a single
 * deployed evaluator. Anything in this file marked `available: false` has no
 * contract behind it, and the SDK refuses to build it rather than pretending
 * it works.
 */

/*//////////////////////////////////////////////////////////////
                    ON-CHAIN NUMERIC CONSTANTS
      These mirror contracts/src/libraries/ConditionTypes.sol
//////////////////////////////////////////////////////////////*/

export const KIND_NONE = 0;
export const KIND_BALANCE_THRESHOLD = 1;
export const KIND_SCHEDULE = 2;

export const ACTION_NONE = 0;
export const ACTION_TRANSFER_USDC = 1;

export const OP_NONE = 0;
export const OP_LT = 1;
export const OP_GT = 2;
export const OP_LTE = 3;
export const OP_GTE = 4;

/*//////////////////////////////////////////////////////////////
                          CONDITION TYPES
//////////////////////////////////////////////////////////////*/

/**
 * Condition types the SDK can express.
 *
 * Both are enabled, and both are served by the *same* deployed evaluator
 * reached with a different operator - which is the engine's reuse claim stated
 * in code rather than in prose.
 */
export type ConditionTypeName =
  | 'BALANCE_BELOW'
  | 'BALANCE_ABOVE'
  | 'SCHEDULE_AT'
  | 'SCHEDULE_EVERY';

export interface ConditionTypeDefinition {
  name: ConditionTypeName;
  /** The on-chain evaluator kind this maps to. */
  kind: number;
  /** The on-chain comparison operator. */
  operator: number;
  /**
   * What `threshold` means for this type.
   *
   * Every condition stores one uint128 threshold, but not every condition
   * measures money. A schedule stores a Unix timestamp in the same slot, so
   * anything formatting or parsing a threshold has to ask this first rather
   * than assuming dollars.
   */
  thresholdUnit: 'usdc' | 'timestamp';
  /** True when this type carries an encoded `params` payload. */
  usesParams?: boolean;
  label: string;
  description: string;
  /** What the `subject` field means for this type. */
  subjectLabel: string;
  /** Whether V1 enables it. The SDK refuses to build a type that is not available. */
  available: boolean;
}

export const CONDITION_TYPES: Record<ConditionTypeName, ConditionTypeDefinition> = {
  BALANCE_BELOW: {
    name: 'BALANCE_BELOW',
    kind: KIND_BALANCE_THRESHOLD,
    operator: OP_LT,
    label: 'USDC balance falls below',
    description: "Fires when a wallet's native USDC balance drops under the threshold.",
    subjectLabel: 'Monitored wallet',
    thresholdUnit: 'usdc',
    available: true,
  },
  BALANCE_ABOVE: {
    name: 'BALANCE_ABOVE',
    kind: KIND_BALANCE_THRESHOLD,
    operator: OP_GT,
    label: 'USDC balance rises above',
    description: "Fires when a wallet's native USDC balance rises over the threshold.",
    subjectLabel: 'Monitored wallet',
    thresholdUnit: 'usdc',
    /*
     * The same on-chain evaluator as BALANCE_BELOW, reached with a different
     * operator. No new contract and no new deployment: enabling this was a
     * catalog entry, not a feature build.
     *
     * Note the re-arm direction inverts with the operator. A "below" condition
     * recovers by climbing past threshold + buffer; an "above" condition
     * recovers by falling back under threshold - buffer. The evaluator owns
     * that logic, so nothing here or in the UI has to know it.
     */
    available: true,
  },

  /*
   * The second evaluator, added to a live protocol by registration alone. Both
   * entries below share one deployed contract and one (kind, operator) pair -
   * they differ only in whether a `params` payload is attached, which is what
   * turns a one-off deadline into a repeating window.
   */
  SCHEDULE_AT: {
    name: 'SCHEDULE_AT',
    kind: KIND_SCHEDULE,
    operator: OP_GTE,
    label: 'Time reaches',
    description: 'Fires once when the clock reaches a specific moment.',
    subjectLabel: 'Owner wallet',
    thresholdUnit: 'timestamp',
    available: true,
  },
  SCHEDULE_EVERY: {
    name: 'SCHEDULE_EVERY',
    kind: KIND_SCHEDULE,
    operator: OP_GTE,
    label: 'Every interval',
    description: 'Fires on a repeating schedule, starting from a chosen moment.',
    subjectLabel: 'Owner wallet',
    thresholdUnit: 'timestamp',
    usesParams: true,
    available: true,
  },
};

/**
 * Condition types shown in the UI as "coming soon".
 *
 * These have no evaluator and no contract support. They are listed so the
 * product can show where it is going without implying any of it works.
 */
export const PLANNED_CONDITION_TYPES = [
  {
    name: 'SPEND_RATE_ABOVE',
    label: 'Spending over a period exceeds',
    description: 'Fires when outflow from a wallet crosses a limit within a rolling window.',
  },
  {
    name: 'BALANCE_RATIO',
    label: 'Balance ratio between two wallets',
    description: 'Fires when the ratio between two monitored balances crosses a bound.',
  },
] as const;

/*//////////////////////////////////////////////////////////////
                            ACTION TYPES
//////////////////////////////////////////////////////////////*/

export type ActionTypeName = 'TRANSFER_USDC';

export interface ActionTypeDefinition {
  name: ActionTypeName;
  kind: number;
  label: string;
  description: string;
  available: boolean;
}

/**
 * Actions are deliberately *not* an open plugin point.
 *
 * An evaluator is a view function and cannot touch money. An action decides
 * what upKEEP may do with user funds, so each new action kind is added
 * explicitly in the executor, where it is auditable and visible to users,
 * rather than being something an admin can register silently.
 */
export const ACTION_TYPES: Record<ActionTypeName, ActionTypeDefinition> = {
  TRANSFER_USDC: {
    name: 'TRANSFER_USDC',
    kind: ACTION_TRANSFER_USDC,
    label: 'Transfer USDC',
    description: 'Move a fixed amount of USDC from the vault to its one approved recipient.',
    available: true,
  },
};

export const PLANNED_ACTION_TYPES = [
  {
    name: 'PAUSE_AUTOMATION',
    label: 'Pause an automation',
    description: 'Halt another condition when a risk limit is breached.',
  },
  {
    name: 'NOTIFY',
    label: 'Send a notification',
    description: 'Emit an off-chain alert without moving funds.',
  },
] as const;

/*//////////////////////////////////////////////////////////////
                             LOOKUPS
//////////////////////////////////////////////////////////////*/

export function getConditionType(name: ConditionTypeName): ConditionTypeDefinition {
  const definition = CONDITION_TYPES[name];
  if (!definition) {
    throw new Error(
      `Unknown condition type "${name}". Supported: ${Object.keys(CONDITION_TYPES).join(', ')}`,
    );
  }
  return definition;
}

export function getActionType(name: ActionTypeName): ActionTypeDefinition {
  const definition = ACTION_TYPES[name];
  if (!definition) {
    throw new Error(
      `Unknown action type "${name}". Supported: ${Object.keys(ACTION_TYPES).join(', ')}`,
    );
  }
  return definition;
}

/** Condition types V1 actually enables. */
export function availableConditionTypes(): ConditionTypeDefinition[] {
  return Object.values(CONDITION_TYPES).filter((type) => type.available);
}

export function availableActionTypes(): ActionTypeDefinition[] {
  return Object.values(ACTION_TYPES).filter((type) => type.available);
}

/**
 * Resolve an on-chain condition back to a friendly name.
 *
 * (kind, operator) is enough for the balance types but not for schedules: a
 * deadline and a repeating window are the same pair, distinguished only by
 * whether the condition carries a `params` payload. Pass `hasParams` when the
 * chain has been read, or leave it out for the pair-only answer.
 */
export function conditionTypeFor(
  kind: number,
  operator: number,
  hasParams?: boolean,
): ConditionTypeName | undefined {
  const matches = Object.values(CONDITION_TYPES).filter(
    (type) => type.kind === kind && type.operator === operator,
  );
  if (matches.length === 0) return undefined;
  if (matches.length === 1 || hasParams === undefined) return matches[0]!.name;

  return (matches.find((type) => Boolean(type.usesParams) === hasParams) ?? matches[0]!).name;
}

/** True when this condition type measures time rather than money. */
export function isScheduleType(name: ConditionTypeName): boolean {
  return CONDITION_TYPES[name].thresholdUnit === 'timestamp';
}

export function actionTypeFor(kind: number): ActionTypeName | undefined {
  return Object.values(ACTION_TYPES).find((type) => type.kind === kind)?.name;
}
