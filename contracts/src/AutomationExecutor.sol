// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ConditionTypes} from "./libraries/ConditionTypes.sol";
import {FeeMath} from "./libraries/FeeMath.sol";
import {IConditionRegistry} from "./interfaces/IConditionRegistry.sol";
import {IAutomationVault} from "./interfaces/IAutomationVault.sol";

/// @title AutomationExecutor
/// @notice Turns a true condition into its one authorized action.
///
/// @dev This contract is the only thing that ever calls a vault, and it is
///      deliberately unable to decide anything. It reads the condition and the
///      action from the registry, re-verifies the predicate against live chain
///      state, latches the condition, and forwards fixed parameters to the
///      vault. It holds no funds, has no `receive`, and cannot be paid.
///
///      A keeper calling `execute` supplies exactly one thing: a condition id.
///      Everything else, the amount, the destination, whether the trigger is
///      genuine, comes from on-chain state the keeper does not control.
///
///      Replay is blocked three times over: the registry latches the condition
///      to FIRED before any value moves, this contract records the derived
///      execution id, and the vault independently refuses a spent id.
contract AutomationExecutor is Ownable2Step, ReentrancyGuard {
    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The registry this executor serves. Fixed at deployment.
    IConditionRegistry public immutable registry;

    /// @notice Addresses permitted to call `execute`.
    mapping(address keeper => bool allowed) public keepers;

    /// @notice When true, anyone may call `execute`.
    /// @dev Safe in principle, because the predicate is verified on-chain and
    ///      the action is fully constrained by the user's vault. Off by default
    ///      so that keeper behaviour stays observable while the system is young.
    bool public permissionless;

    /// @notice Protocol-level circuit breaker.
    /// @dev Only ever *stops* execution. It cannot move funds, and it cannot
    ///      prevent a user from pausing, revoking or withdrawing from a vault.
    bool public paused;

    /// @notice Execution ids already spent by this executor.
    mapping(bytes32 executionId => bool spent) public executedTriggers;

    uint256 public totalExecutions;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event ExecutionCompleted(
        uint256 indexed conditionId,
        bytes32 indexed executionId,
        address indexed recipient,
        address vault,
        uint256 grossAmount,
        uint256 netAmount,
        uint256 fee,
        uint256 observedValue,
        uint32 triggerCount
    );
    event KeeperUpdated(address indexed keeper, bool allowed);
    event PermissionlessSet(bool permissionless);
    event PausedSet(bool paused);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotKeeper(address caller);
    error ExecutorPaused();
    error ConditionNotExecutable(uint256 conditionId);
    error UnsupportedAction(uint8 kind);
    error AmountExceedsAuthorized(uint128 amount, uint128 maxAmount);
    error ExecutionReplay(bytes32 executionId);
    error ZeroAddress();

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyKeeper() {
        if (!permissionless && !keepers[msg.sender]) revert NotKeeper(msg.sender);
        _;
    }

    constructor(address registry_, address admin) Ownable(admin) {
        if (registry_ == address(0) || admin == address(0)) revert ZeroAddress();
        registry = IConditionRegistry(registry_);
    }

    /*//////////////////////////////////////////////////////////////
                               EXECUTION
    //////////////////////////////////////////////////////////////*/

    /// @notice Execute the action bound to `conditionId`, if it is genuinely due.
    /// @dev Checks-effects-interactions throughout. `registry.markTriggered`
    ///      re-runs `canExecute` itself, so the predicate is verified on-chain
    ///      inside the same transaction that moves the funds.
    /// @param conditionId The condition to act on.
    /// @return executionId Unique id for this trigger.
    /// @return netAmount Delivered to the approved recipient.
    /// @return fee Protocol fee taken by the vault.
    function execute(uint256 conditionId)
        external
        onlyKeeper
        nonReentrant
        returns (bytes32 executionId, uint256 netAmount, uint256 fee)
    {
        // ---- checks ----
        if (paused) revert ExecutorPaused();
        if (!registry.canExecute(conditionId)) revert ConditionNotExecutable(conditionId);

        ConditionTypes.Condition memory condition = registry.getCondition(conditionId);
        ConditionTypes.Action memory action = registry.getAction(condition.actionId);

        /*
         * Action dispatch. Unlike evaluators, action kinds are deliberately not
         * an open plugin point: an evaluator is a view function and cannot touch
         * money, whereas an action decides what upKEEP may do with user funds.
         * Each new action kind is added here explicitly so it stays auditable
         * and visible to users, rather than being something an admin can
         * register silently.
         */
        if (action.kind != ConditionTypes.ACTION_TRANSFER_USDC) {
            revert UnsupportedAction(action.kind);
        }
        // Defence in depth: the registry already enforces this at creation and
        // the vault enforces its own ceiling, but the amount is re-checked
        // against the owner's authorization here as well.
        if (action.amount > action.maxAmount) {
            revert AmountExceedsAuthorized(action.amount, action.maxAmount);
        }

        uint256 observedValue = registry.observedValue(conditionId);

        // ---- effects ----
        // Latch first. A reentrant call now finds the condition FIRED.
        uint32 triggerCount = registry.markTriggered(conditionId);

        executionId = deriveExecutionId(conditionId, triggerCount);
        if (executedTriggers[executionId]) revert ExecutionReplay(executionId);
        executedTriggers[executionId] = true;

        unchecked {
            ++totalExecutions;
        }

        // ---- interactions ----
        (netAmount, fee) =
            IAutomationVault(action.vault).executeTransfer(action.amount, action.recipient, executionId);

        emit ExecutionCompleted(
            conditionId,
            executionId,
            action.recipient,
            action.vault,
            action.amount,
            netAmount,
            fee,
            observedValue,
            triggerCount
        );
    }

    /// @notice Re-arm a condition whose balance recovered.
    /// @dev A thin passthrough so keepers have one contract to talk to. The
    ///      registry's `rearm` is permissionless and verifies the balance itself.
    function rearm(uint256 conditionId) external {
        registry.rearm(conditionId);
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Deterministic id for a given trigger of a given condition.
    /// @dev Includes the chain id and registry address so an id can never be
    ///      replayed across chains or against a different registry.
    function deriveExecutionId(uint256 conditionId, uint32 triggerCount)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(registry), conditionId, triggerCount));
    }

    /// @notice Dry-run an execution without sending a transaction.
    /// @dev Used by the keeper to skip conditions that would revert, and by the
    ///      UI to show the exact fee split before the user confirms.
    function simulate(uint256 conditionId)
        external
        view
        returns (
            bool executable,
            uint256 grossAmount,
            uint256 netAmount,
            uint256 fee,
            uint256 observedValue,
            uint256 vaultBalance
        )
    {
        if (paused) return (false, 0, 0, 0, 0, 0);

        ConditionTypes.Condition memory condition = registry.getCondition(conditionId);
        ConditionTypes.Action memory action = registry.getAction(condition.actionId);

        observedValue = registry.observedValue(conditionId);
        grossAmount = action.amount;
        vaultBalance = action.vault.balance;

        IAutomationVault vault = IAutomationVault(action.vault);
        (netAmount, fee) = vault.previewExecution(grossAmount);

        executable = registry.canExecute(conditionId) && vault.executor() == address(this)
            && !vault.paused() && grossAmount <= vault.maxPerExecution()
            && vaultBalance >= grossAmount && action.recipient == vault.recipient();
    }

    /*//////////////////////////////////////////////////////////////
                             PROTOCOL ADMIN
    //////////////////////////////////////////////////////////////*/

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();
        keepers[keeper] = allowed;
        emit KeeperUpdated(keeper, allowed);
    }

    function setPermissionless(bool value) external onlyOwner {
        permissionless = value;
        emit PermissionlessSet(value);
    }

    function pause() external onlyOwner {
        paused = true;
        emit PausedSet(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PausedSet(false);
    }
}
