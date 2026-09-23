/**
 * upKEEP protocol fee configuration.
 *
 * Revenue model (V1):
 *   - no subscription, no setup fee, no fee to create a condition, no fee to monitor
 *   - a single fee charged only on a *successful* automated execution
 *
 * All values are basis points against the execution amount, and every amount is
 * in 18-decimal native USDC wei (see config/tokens.ts).
 *
 * These constants mirror contracts/src/libraries/FeeMath.sol. The contract, not
 * this file, is authoritative for what is actually charged: each vault stores
 * its rate in an immutable at construction, so a user's agreed fee can never be
 * raised afterwards by anyone, including protocol admins.
 */

/** Default rate: 5 bps = 0.05%. Overridable per client, never hardcoded at call sites. */
export const DEFAULT_UPKEEP_FEE_BPS = 5;

/** Basis-point denominator. */
export const BPS_DENOMINATOR = 10_000n;

/**
 * Minimum fee per execution: $0.001, in 18-decimal native wei.
 * Stops dust executions from being free to the protocol.
 */
export const UPKEEP_MIN_FEE_WEI = 1_000_000_000_000_000n;

/**
 * Hard ceiling on the *effective* fee: 1% of the execution amount.
 *
 * This is what stops the minimum fee from ever swallowing a small transfer, and
 * it guarantees fee < amount for any amount > 0. Enforced identically in
 * Solidity (FeeMath.sol) and here.
 */
export const UPKEEP_MAX_EFFECTIVE_FEE_BPS = 100n;

/**
 * Safety bound on the configurable rate. The vault rejects any rate above this
 * at construction, so a misconfigured deployment cannot charge 50%.
 */
export const UPKEEP_MAX_CONFIGURABLE_FEE_BPS = 50n;
