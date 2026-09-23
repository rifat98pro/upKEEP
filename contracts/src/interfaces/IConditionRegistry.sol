// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ConditionTypes} from "../libraries/ConditionTypes.sol";

/// @title IConditionRegistry
/// @notice The upKEEP condition engine's external surface.
interface IConditionRegistry {
    function getCondition(uint256 conditionId)
        external
        view
        returns (ConditionTypes.Condition memory);

    function getAction(uint256 actionId) external view returns (ConditionTypes.Action memory);

    function isConditionActive(uint256 conditionId) external view returns (bool);

    /// @notice The value the condition's evaluator currently observes.
    function observedValue(uint256 conditionId) external view returns (uint256);

    /// @notice Evaluates the predicate against live on-chain state.
    /// @dev This is why the keeper cannot lie. Evaluators are view functions
    ///      reached by staticcall, so the executor re-checks the predicate in
    ///      the same transaction that moves the funds.
    function isConditionTrue(uint256 conditionId) external view returns (bool);

    function canExecute(uint256 conditionId) external view returns (bool);

    function canRearm(uint256 conditionId) external view returns (bool);

    /// @notice Latch the condition as fired. Callable only by the executor.
    function markTriggered(uint256 conditionId) external returns (uint32 triggerCount);

    /// @notice Re-arm a fired condition once its subject has recovered.
    function rearm(uint256 conditionId) external;

    function executor() external view returns (address);

    /// @notice Whether an address may latch conditions as fired.
    /// @dev A set rather than one address, so an authorization upgrade can be
    ///      staged instead of being a flag-day cutover. See ConditionRegistry.
    function isAuthorizedExecutor(address candidate) external view returns (bool);

    /// @notice The evaluator registered for a condition kind, or address(0).
    function evaluatorFor(uint8 kind) external view returns (address);
}
