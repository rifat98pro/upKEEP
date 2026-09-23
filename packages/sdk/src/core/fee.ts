/**
 * upKEEP fee math.
 *
 * This is a behavioural mirror of contracts/src/libraries/FeeMath.sol, and both
 * implementations are exercised by the same vector table, so the number a
 * caller is quoted before confirming is exactly what the contract charges.
 *
 * Pure integer arithmetic on bigint. No floating point anywhere.
 * All amounts are 18-decimal native USDC wei.
 */
import {
  BPS_DENOMINATOR,
  DEFAULT_UPKEEP_FEE_BPS,
  UPKEEP_MAX_EFFECTIVE_FEE_BPS,
  UPKEEP_MIN_FEE_WEI,
} from '../config/fees.js';

export interface FeeBreakdown {
  /** Gross amount released by the vault for this execution. */
  amount: bigint;
  /** upKEEP protocol fee, routed to the protocol treasury. */
  fee: bigint;
  /** What the approved recipient actually receives. */
  netAmount: bigint;
  /** The rate used, for display. */
  feeBps: number;
  /** True when the $0.001 floor, not the bps rate, set the fee. */
  minimumApplied: boolean;
  /** True when the 1% ceiling clamped the fee back down. */
  capApplied: boolean;
}

/**
 * Fee for an execution of `amount`, in native wei.
 *
 * Rules, in order:
 *   1. rate    -> floor(amount * feeBps / 10_000)
 *   2. floor   -> raise to UPKEEP_MIN_FEE_WEI ($0.001) if below it
 *   3. ceiling -> clamp to 1% of amount, so the fee can never outgrow the
 *                 transfer it is charged on
 *
 * Integer division truncates, which always favours the user.
 */
export function computeFee(amount: bigint, feeBps: number = DEFAULT_UPKEEP_FEE_BPS): bigint {
  return computeFeeBreakdown(amount, feeBps).fee;
}

export function computeFeeBreakdown(
  amount: bigint,
  feeBps: number = DEFAULT_UPKEEP_FEE_BPS,
): FeeBreakdown {
  if (amount <= 0n) {
    return { amount: 0n, fee: 0n, netAmount: 0n, feeBps, minimumApplied: false, capApplied: false };
  }

  let fee = (amount * BigInt(feeBps)) / BPS_DENOMINATOR;

  let minimumApplied = false;
  if (fee < UPKEEP_MIN_FEE_WEI) {
    fee = UPKEEP_MIN_FEE_WEI;
    minimumApplied = true;
  }

  // Ceiling: the fee may never exceed 1% of the amount being moved.
  const cap = (amount * UPKEEP_MAX_EFFECTIVE_FEE_BPS) / BPS_DENOMINATOR;
  let capApplied = false;
  if (fee > cap) {
    fee = cap;
    capApplied = true;
    minimumApplied = false;
  }

  return { amount, fee, netAmount: amount - fee, feeBps, minimumApplied, capApplied };
}
