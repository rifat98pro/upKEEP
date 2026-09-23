// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title FeeMath
/// @notice Deterministic integer fee arithmetic for upKEEP executions.
/// @dev Mirrored byte-for-byte in TypeScript at src/lib/fee.ts, and both are
///      driven by the same vector table so the figure the UI shows before you
///      confirm is exactly what the contract charges. Pure integer math: there
///      is no floating point anywhere in the money path.
library FeeMath {
    /// @notice Basis-point denominator.
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Minimum fee per execution: $0.001, in 18-decimal native wei.
    uint256 internal constant MIN_FEE_WEI = 1e15;

    /// @notice Hard ceiling on the effective fee: 1% of the amount moved.
    /// @dev This is what prevents MIN_FEE_WEI from ever swallowing a small
    ///      transfer. It also guarantees fee < amount for any amount > 0,
    ///      so `amount - fee` can never underflow.
    uint256 internal constant MAX_EFFECTIVE_FEE_BPS = 100;

    /// @notice Upper bound on the configurable rate, checked at construction so
    ///         a misconfigured deployment cannot charge an outrageous fee.
    uint256 internal constant MAX_CONFIGURABLE_FEE_BPS = 50; // 0.5%

    /// @notice Fee charged on an execution of `amount` at `feeBps`.
    /// @dev Applied in order: rate, then the $0.001 floor, then the 1% ceiling.
    ///      Division truncates, which always rounds in the user's favour.
    /// @param amount Gross amount released by the vault, in native wei.
    /// @param feeBps Configured rate in basis points (5 = 0.05%).
    /// @return fee The protocol fee, in native wei. Always < amount when amount > 0.
    function computeFee(uint256 amount, uint256 feeBps) internal pure returns (uint256 fee) {
        if (amount == 0) return 0;

        fee = (amount * feeBps) / BPS_DENOMINATOR;

        if (fee < MIN_FEE_WEI) {
            fee = MIN_FEE_WEI;
        }

        uint256 cap = (amount * MAX_EFFECTIVE_FEE_BPS) / BPS_DENOMINATOR;
        if (fee > cap) {
            fee = cap;
        }
    }

    /// @notice Split `amount` into the recipient's share and the protocol fee.
    function split(uint256 amount, uint256 feeBps)
        internal
        pure
        returns (uint256 netAmount, uint256 fee)
    {
        fee = computeFee(amount, feeBps);
        netAmount = amount - fee; // safe: computeFee guarantees fee <= amount
    }
}
