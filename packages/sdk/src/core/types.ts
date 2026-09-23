/**
 * Domain types for the upKEEP condition engine.
 *
 * Every monetary field is a `bigint` of 18-decimal native USDC wei. There is no
 * `number` anywhere in the money path, by design.
 */
import type { Address, Hash } from 'viem';
import type { ActionTypeName, ConditionTypeName } from './kinds.js';

/*//////////////////////////////////////////////////////////////
                            CONDITIONS
//////////////////////////////////////////////////////////////*/

/**
 * Condition lifecycle, mirroring ConditionTypes.Status on-chain.
 * Array position matches the Solidity enum ordinal exactly.
 */
export type ConditionStatus =
  | 'none'
  | 'active'
  | 'paused'
  | 'triggered'
  | 'executed'
  | 'disabled';

export const CONDITION_STATUS_BY_ORDINAL: readonly ConditionStatus[] = [
  'none',
  'active',
  'paused',
  'triggered',
  'executed',
  'disabled',
] as const;

/** Hysteresis latch, mirroring ConditionTypes.Arm. */
export type ArmState = 'armed' | 'fired';

export const ARM_STATE_BY_ORDINAL: readonly ArmState[] = ['armed', 'fired'] as const;

export interface Action {
  id: string;
  /** Friendly name, or undefined if the chain holds a kind this SDK build does not know. */
  type?: ActionTypeName;
  /** Raw on-chain action kind. */
  kind: number;
  /** Vault funding the action. */
  vault: Address;
  /** The single approved destination. */
  recipient: Address;
  /** Released per execution, in native wei. */
  amount: bigint;
  /** Owner-authorized ceiling, in native wei. */
  maxAmount: bigint;
}

export interface Condition {
  id: string;
  owner: Address;
  /** Friendly name, or undefined for a (kind, operator) pair this build does not know. */
  type?: ConditionTypeName;
  /** Raw on-chain evaluator kind. */
  kind: number;
  /** Raw on-chain comparison operator. */
  operator: number;
  status: ConditionStatus;
  arm: ArmState;
  /** What the condition is about. For balance conditions, the watched wallet. */
  subject: Address;
  asset: 'USDC';
  /** The value compared against, in native wei. */
  threshold: bigint;
  /** The subject must clear threshold + rearmBuffer to arm again. */
  rearmBuffer: bigint;
  actionId: string;
  recurring: boolean;
  triggerCount: number;
  createdAt: string;
  lastEvaluatedAt?: string;
  lastTriggeredAt?: string;
}

/** A condition joined with its action and live chain state. */
export interface ConditionView {
  condition: Condition;
  action: Action;
  /** Live value observed by the condition's evaluator, in native wei. */
  currentValue: bigint;
  /** How far the observed value is from firing; 0n once the predicate is true. */
  distanceToTrigger: bigint;
  /** Would fire right now, per on-chain `canExecute`. */
  executable: boolean;
  /** Could be re-armed right now. */
  rearmable: boolean;
}

/*//////////////////////////////////////////////////////////////
                            EXECUTIONS
//////////////////////////////////////////////////////////////*/

export type ExecutionStatus = 'pending' | 'confirmed' | 'failed' | 'reverted';

export interface Execution {
  /** The on-chain execution id: unique per trigger. */
  id: string;
  conditionId: string;
  /** Same value as `id`; named separately because the DB schema calls it trigger_id. */
  triggerId: string;
  transactionHash: Hash;
  status: ExecutionStatus;
  /** Gross amount released, in native wei. */
  amount: bigint;
  /** Delivered to the recipient, in native wei. */
  netAmount: bigint;
  /** upKEEP protocol fee, in native wei. */
  fee: bigint;
  recipient: Address;
  vault: Address;
  /** Value observed by the evaluator at execution time, in native wei. */
  observedValue: bigint;
  triggerCount: number;
  blockNumber: bigint;
  createdAt: string;
  confirmedAt?: string;
  error?: string;
}

/*//////////////////////////////////////////////////////////////
                              VAULTS
//////////////////////////////////////////////////////////////*/

export interface VaultInfo {
  address: Address;
  owner: Address;
  executor: Address;
  recipient: Address;
  maxPerExecution: bigint;
  /**
   * Ceiling on everything automation may move in one UTC day. 0n means none.
   *
   * This is part of the permission, not a condition: it is enforced inside the
   * transfer itself, so there is no keeper to race and no moment at which it is
   * briefly untrue.
   */
  maxPerDay: bigint;
  /** Gross moved by automation so far in the current window. */
  spentToday: bigint;
  /** Still movable today. Undefined when no cap is set. */
  remainingToday?: bigint;
  balance: bigint;
  paused: boolean;
  feeBps: number;
  /** True when the owner has revoked automation entirely. */
  revoked: boolean;
}

/*//////////////////////////////////////////////////////////////
                             NETWORK
//////////////////////////////////////////////////////////////*/

export interface NetworkStatus {
  connected: boolean;
  chainId?: number;
  blockNumber?: bigint;
  /** Current gas price in wei, from eth_gasPrice. */
  gasPrice?: bigint;
  latencyMs: number;
  /** The endpoint answered, but for a different chain than expected. */
  chainMismatch: boolean;
  error?: string;
}
