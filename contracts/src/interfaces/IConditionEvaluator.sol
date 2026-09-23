// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IConditionEvaluator
/// @notice The plug-in point of the upKEEP engine: how a condition kind decides
///         whether it is true.
///
/// @dev Evaluators are **view-only**. That is the whole reason this is a safe
///      extension point. An evaluator can say "this condition is true", but it
///      cannot move money, cannot write state, and cannot reenter: the registry
///      reaches it through a staticcall. The damage a bad evaluator could do is
///      bounded by the user's own vault, which independently caps the amount and
///      pins the recipient.
///
///      Adding a new condition kind to upKEEP therefore means deploying one of
///      these and registering it. It does not mean touching the registry, the
///      executor, or anything that holds funds.
interface IConditionEvaluator {
    /// @notice The condition kind this evaluator implements.
    /// @dev Checked at registration so an evaluator cannot be registered under
    ///      the wrong kind by mistake.
    function kind() external view returns (uint8);

    /// @notice Human-readable name, surfaced in the UI and SDK.
    function description() external view returns (string memory);

    /// @notice Whether this evaluator supports a given comparison operator.
    function supportsOperator(uint8 operator) external view returns (bool);

    /// @notice The value this condition is currently observing.
    /// @dev Exposed separately from `evaluate` so the UI can show "current
    ///      balance" and "distance to trigger" without duplicating the
    ///      evaluator's logic off-chain.
    /// @param subject What the condition is about. V1: the watched wallet.
    /// @param params Extra encoded parameters, empty for simple kinds.
    function observe(address subject, bytes calldata params)
        external
        view
        returns (uint256 value);

    /// @notice Is the predicate true right now?
    function evaluate(address subject, uint256 threshold, uint8 operator, bytes calldata params)
        external
        view
        returns (bool);

    /// @notice Has the subject recovered far enough to arm the condition again?
    /// @dev The evaluator owns both directions of the state machine. For a
    ///      "below" condition, recovery means clearing `threshold + buffer`; for
    ///      an "above" condition it means falling under `threshold - buffer`.
    ///      Putting both here is what keeps the registry free of any assumption
    ///      about what a condition means.
    function canRearm(
        address subject,
        uint256 threshold,
        uint256 rearmBuffer,
        uint8 operator,
        bytes calldata params
    ) external view returns (bool);
}
