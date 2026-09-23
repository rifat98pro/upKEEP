// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IConditionEvaluator} from "../interfaces/IConditionEvaluator.sol";
import {ConditionTypes} from "../libraries/ConditionTypes.sol";

/// @title BalanceThresholdEvaluator
/// @notice The first condition kind on the upKEEP engine: compare a wallet's
///         native USDC balance against a threshold.
///
/// @dev This contract is the entire implementation of "Balance Guard". It is
///      about sixty lines, holds nothing, and can be swapped or joined by others
///      without touching the registry, the executor or any vault - which is the
///      point of the engine architecture.
///
///      Because Arc uses USDC as its native gas token, the observed value is
///      simply `subject.balance` in 18 decimals. No token contract is involved
///      and no oracle is trusted: the value is read from chain state inside the
///      same transaction that acts on it.
///      https://docs.arc.io/arc/references/evm-differences
///
///      Both LT and GT are implemented, so this one evaluator covers "balance
///      below" and "balance above". V1 only enables LT in the UI and SDK; the
///      other direction is here because supporting it costs nothing and proves
///      the abstraction is real rather than decorative.
contract BalanceThresholdEvaluator is IConditionEvaluator {
    error UnsupportedOperator(uint8 operator);

    /// @inheritdoc IConditionEvaluator
    function kind() external pure override returns (uint8) {
        return ConditionTypes.KIND_BALANCE_THRESHOLD;
    }

    /// @inheritdoc IConditionEvaluator
    function description() external pure override returns (string memory) {
        return "Native USDC balance compared against a threshold";
    }

    /// @inheritdoc IConditionEvaluator
    function supportsOperator(uint8 operator) public pure override returns (bool) {
        return operator == ConditionTypes.OP_LT || operator == ConditionTypes.OP_GT;
    }

    /// @inheritdoc IConditionEvaluator
    /// @dev `params` is unused for this kind; the subject address is enough.
    function observe(address subject, bytes calldata) external view override returns (uint256) {
        return subject.balance;
    }

    /// @inheritdoc IConditionEvaluator
    function evaluate(address subject, uint256 threshold, uint8 operator, bytes calldata)
        external
        view
        override
        returns (bool)
    {
        uint256 value = subject.balance;

        if (operator == ConditionTypes.OP_LT) return value < threshold;
        if (operator == ConditionTypes.OP_GT) return value > threshold;

        revert UnsupportedOperator(operator);
    }

    /// @inheritdoc IConditionEvaluator
    /// @dev Recovery is directional. A "below" condition re-arms once the
    ///      balance clears `threshold + buffer`; an "above" condition re-arms
    ///      once it falls back under `threshold - buffer`. Without that gap a
    ///      balance hovering at the boundary would flap between fired and armed
    ///      and drain the vault one authorized amount at a time.
    function canRearm(
        address subject,
        uint256 threshold,
        uint256 rearmBuffer,
        uint8 operator,
        bytes calldata
    ) external view override returns (bool) {
        uint256 value = subject.balance;

        if (operator == ConditionTypes.OP_LT) {
            return value >= threshold + rearmBuffer;
        }
        if (operator == ConditionTypes.OP_GT) {
            // Guard the subtraction: a buffer larger than the threshold floors at 0.
            uint256 rearmLevel = rearmBuffer >= threshold ? 0 : threshold - rearmBuffer;
            return value <= rearmLevel;
        }

        revert UnsupportedOperator(operator);
    }
}
