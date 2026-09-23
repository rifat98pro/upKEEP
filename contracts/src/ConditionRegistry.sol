// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ConditionTypes} from "./libraries/ConditionTypes.sol";
import {IConditionRegistry} from "./interfaces/IConditionRegistry.sol";
import {IConditionEvaluator} from "./interfaces/IConditionEvaluator.sol";
import {IAutomationVault} from "./interfaces/IAutomationVault.sol";

/// @title ConditionRegistry
/// @notice The upKEEP condition engine: persistent conditions, a pluggable
///         evaluation layer, and the state machine that decides when one fires.
///
/// @dev This contract knows nothing about balances. It stores a generic
///      (subject, operator, threshold) triple, dispatches evaluation to whichever
///      IConditionEvaluator is registered for the condition's kind, and manages
///      the latch. Balance Guard is one registered evaluator, not a special case
///      in here.
///
///      Two design decisions carry most of the weight:
///
///      1. Predicates are evaluated **on-chain**. Evaluators are view functions
///         reached by staticcall, so the executor re-checks the predicate in the
///         same transaction that moves the funds. The off-chain monitor is only
///         a scheduler: it decides *when* to ask, never *whether* the condition
///         holds. A malicious or buggy keeper cannot fabricate a trigger.
///
///      2. Re-execution is blocked by a latch, not a timer. After firing, a
///         condition moves to `Arm.FIRED` and stays there until its evaluator
///         says the subject has genuinely recovered. A condition that simply
///         stays true fires exactly once, however often it is polled.
///
///      All amounts are 18-decimal native USDC wei. See ConditionTypes.
contract ConditionRegistry is IConditionRegistry, Ownable2Step {
    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The primary AutomationExecutor allowed to latch conditions.
    /// @dev Not a spending permission. An executor still has to satisfy the
    ///      user's own vault, which authorizes its executor separately, so
    ///      changing this cannot by itself reach user money.
    address public override executor;

    /// @notice Additional executors accepted alongside the primary one.
    ///
    /// @dev This exists for migration, and it is the difference between an
    ///      authorization upgrade being stageable and being a flag day.
    ///
    ///      An execution requires the caller to satisfy *both* the registry and
    ///      the user's vault. With a single registry executor, the moment an
    ///      admin switched to a new one, every vault still pointing at the old
    ///      executor would stop working - silently, since a paused-looking
    ///      condition and a mis-wired one are indistinguishable from outside.
    ///      Users would be broken until each of them migrated.
    ///
    ///      Allowing a set means the old and new authorization mechanisms run
    ///      side by side: users migrate their own vaults whenever they choose,
    ///      and the admin retires the old executor only once nobody depends on
    ///      it. Nothing is weakened, because each executor must still be
    ///      authorized separately by every vault it touches.
    mapping(address executorAddress => bool allowed) public additionalExecutors;

    /// @notice Registered evaluators, by condition kind.
    /// @dev The engine's extension point. Adding a condition type to upKEEP is
    ///      a registration here, not a change to this contract.
    mapping(uint8 kind => address evaluator) public override evaluatorFor;

    /// @notice Every kind that currently has an evaluator, for enumeration.
    uint8[] private _registeredKinds;

    /// @notice Optional encoded parameters for evaluators that need them.
    /// @dev Stored separately so simple kinds like balance thresholds pay no
    ///      storage cost for a field they never use.
    mapping(uint256 conditionId => bytes params) private _conditionParams;

    uint256 private _nextConditionId = 1;
    uint256 private _nextActionId = 1;

    mapping(uint256 conditionId => ConditionTypes.Condition) private _conditions;
    mapping(uint256 actionId => ConditionTypes.Action) private _actions;
    mapping(address owner => uint256[] conditionIds) private _ownerConditions;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event ConditionCreated(
        uint256 indexed conditionId,
        address indexed owner,
        address indexed subject,
        uint256 actionId,
        uint8 kind,
        uint8 operator,
        uint128 threshold,
        uint128 rearmBuffer,
        bool recurring
    );
    event ActionCreated(
        uint256 indexed actionId,
        uint256 indexed conditionId,
        uint8 kind,
        address vault,
        address recipient,
        uint128 amount,
        uint128 maxAmount
    );
    event ConditionStatusChanged(
        uint256 indexed conditionId,
        ConditionTypes.Status previousStatus,
        ConditionTypes.Status newStatus
    );
    event ConditionTriggered(
        uint256 indexed conditionId,
        uint32 indexed triggerCount,
        uint256 observedValue,
        uint128 threshold,
        uint64 timestamp
    );
    event ConditionRearmed(uint256 indexed conditionId, uint256 observedValue, uint64 timestamp);
    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);
    event AdditionalExecutorUpdated(address indexed executorAddress, bool allowed);
    event EvaluatorRegistered(uint8 indexed kind, address indexed evaluator, string description);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotConditionOwner(uint256 conditionId, address caller);
    error NotExecutor(address caller);
    error ConditionNotFound(uint256 conditionId);
    error InvalidStatusTransition(ConditionTypes.Status from, ConditionTypes.Status to);
    error ConditionNotExecutable(uint256 conditionId);
    error ConditionNotRearmable(uint256 conditionId);
    error ZeroAddress();
    error ZeroAmount();
    error AmountExceedsMax(uint128 amount, uint128 maxAmount);
    error NotVaultOwner(address vault, address caller);
    error VaultRecipientMismatch(address vaultRecipient, address requested);
    error VaultLimitTooLow(uint256 vaultLimit, uint128 requested);
    error NoEvaluatorForKind(uint8 kind);
    error EvaluatorKindMismatch(uint8 expected, uint8 actual);
    error OperatorNotSupported(uint8 kind, uint8 operator);
    error UnsupportedActionKind(uint8 kind);

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyConditionOwner(uint256 conditionId) {
        ConditionTypes.Condition storage c = _conditions[conditionId];
        if (c.status == ConditionTypes.Status.NONE) revert ConditionNotFound(conditionId);
        if (c.owner != msg.sender) revert NotConditionOwner(conditionId, msg.sender);
        _;
    }

    constructor(address admin) Ownable(admin) {
        if (admin == address(0)) revert ZeroAddress();
    }

    /*//////////////////////////////////////////////////////////////
                           ENGINE REGISTRATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Register the evaluator that implements a condition kind.
    /// @dev The evaluator is asked which kind it implements and the answer is
    ///      checked, so a mismatched registration reverts rather than silently
    ///      wiring the wrong logic to a kind.
    function registerEvaluator(address evaluator) external onlyOwner returns (uint8 kind) {
        if (evaluator == address(0)) revert ZeroAddress();

        kind = IConditionEvaluator(evaluator).kind();
        if (kind == ConditionTypes.KIND_NONE) revert NoEvaluatorForKind(kind);

        if (evaluatorFor[kind] == address(0)) {
            _registeredKinds.push(kind);
        }
        evaluatorFor[kind] = evaluator;

        emit EvaluatorRegistered(kind, evaluator, IConditionEvaluator(evaluator).description());
    }

    /// @notice Kinds that currently have a registered evaluator.
    function registeredKinds() external view returns (uint8[] memory) {
        return _registeredKinds;
    }

    function _evaluator(uint8 kind) private view returns (IConditionEvaluator) {
        address evaluator = evaluatorFor[kind];
        if (evaluator == address(0)) revert NoEvaluatorForKind(kind);
        return IConditionEvaluator(evaluator);
    }

    /*//////////////////////////////////////////////////////////////
                            CONDITION CREATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Parameters for creating a condition and its bound action.
    struct CreateParams {
        uint8 kind; // which evaluator interprets this condition
        uint8 operator; // how the observed value is compared
        address subject; // what the condition is about
        uint128 threshold; // the value compared against, in native wei
        uint128 rearmBuffer; // hysteresis before the condition can fire again
        bool recurring; // false = fire once, then retire
        bytes params; // extra evaluator parameters; empty for V1 kinds
        uint8 actionKind;
        address vault; // AutomationVault funding the action
        address recipient; // the one approved destination
        uint128 amount; // released per execution
        uint128 maxAmount; // owner-authorized ceiling
    }

    /// @notice Create a persistent condition plus the single action it may perform.
    /// @dev The caller must own the vault. The vault's own approved recipient and
    ///      per-execution ceiling are cross-checked here, so it is impossible to
    ///      create a condition whose action the vault would later refuse.
    function createCondition(CreateParams calldata params)
        external
        returns (uint256 conditionId, uint256 actionId)
    {
        // ---- engine validation ----
        IConditionEvaluator evaluator = _evaluator(params.kind);
        if (!evaluator.supportsOperator(params.operator)) {
            revert OperatorNotSupported(params.kind, params.operator);
        }
        if (params.actionKind != ConditionTypes.ACTION_TRANSFER_USDC) {
            revert UnsupportedActionKind(params.actionKind);
        }

        // ---- parameter validation ----
        if (params.subject == address(0) || params.vault == address(0)) revert ZeroAddress();
        if (params.recipient == address(0)) revert ZeroAddress();
        if (params.threshold == 0) revert ZeroAmount();
        if (params.amount == 0 || params.maxAmount == 0) revert ZeroAmount();
        if (params.amount > params.maxAmount) {
            revert AmountExceedsMax(params.amount, params.maxAmount);
        }

        // ---- vault cross-checks ----
        IAutomationVault vault = IAutomationVault(params.vault);

        if (vault.owner() != msg.sender) revert NotVaultOwner(params.vault, msg.sender);

        address vaultRecipient = vault.recipient();
        if (vaultRecipient != params.recipient) {
            revert VaultRecipientMismatch(vaultRecipient, params.recipient);
        }

        uint256 vaultLimit = vault.maxPerExecution();
        if (vaultLimit < params.maxAmount) revert VaultLimitTooLow(vaultLimit, params.maxAmount);

        // ---- write ----
        conditionId = _nextConditionId++;
        actionId = _nextActionId++;

        _actions[actionId] = ConditionTypes.Action({
            kind: params.actionKind,
            vault: params.vault,
            recipient: params.recipient,
            amount: params.amount,
            maxAmount: params.maxAmount
        });

        _conditions[conditionId] = ConditionTypes.Condition({
            owner: msg.sender,
            subject: params.subject,
            threshold: params.threshold,
            rearmBuffer: params.rearmBuffer,
            actionId: actionId,
            kind: params.kind,
            operator: params.operator,
            status: ConditionTypes.Status.ACTIVE,
            arm: ConditionTypes.Arm.ARMED,
            recurring: params.recurring,
            triggerCount: 0,
            createdAt: uint64(block.timestamp),
            lastEvaluatedAt: 0,
            lastTriggeredAt: 0
        });

        if (params.params.length > 0) {
            _conditionParams[conditionId] = params.params;
        }

        _ownerConditions[msg.sender].push(conditionId);

        emit ActionCreated(
            actionId,
            conditionId,
            params.actionKind,
            params.vault,
            params.recipient,
            params.amount,
            params.maxAmount
        );
        emit ConditionCreated(
            conditionId,
            msg.sender,
            params.subject,
            actionId,
            params.kind,
            params.operator,
            params.threshold,
            params.rearmBuffer,
            params.recurring
        );
        emit ConditionStatusChanged(
            conditionId, ConditionTypes.Status.NONE, ConditionTypes.Status.ACTIVE
        );
    }

    /*//////////////////////////////////////////////////////////////
                             OWNER LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    /// @notice Halt evaluation. The condition keeps its arm state.
    function pauseCondition(uint256 conditionId) external onlyConditionOwner(conditionId) {
        ConditionTypes.Condition storage c = _conditions[conditionId];
        ConditionTypes.Status from = c.status;
        if (from != ConditionTypes.Status.ACTIVE && from != ConditionTypes.Status.TRIGGERED) {
            revert InvalidStatusTransition(from, ConditionTypes.Status.PAUSED);
        }
        c.status = ConditionTypes.Status.PAUSED;
        emit ConditionStatusChanged(conditionId, from, ConditionTypes.Status.PAUSED);
    }

    /// @notice Resume evaluation.
    /// @dev Resumes into TRIGGERED if the condition was still latched when
    ///      paused, so pausing and resuming can never be used to bypass the
    ///      re-arm requirement and fire twice.
    function resumeCondition(uint256 conditionId) external onlyConditionOwner(conditionId) {
        ConditionTypes.Condition storage c = _conditions[conditionId];
        ConditionTypes.Status from = c.status;
        if (from != ConditionTypes.Status.PAUSED) {
            revert InvalidStatusTransition(from, ConditionTypes.Status.ACTIVE);
        }
        ConditionTypes.Status to = c.arm == ConditionTypes.Arm.FIRED
            ? ConditionTypes.Status.TRIGGERED
            : ConditionTypes.Status.ACTIVE;
        c.status = to;
        emit ConditionStatusChanged(conditionId, from, to);
    }

    /// @notice Permanently retire a condition. Not reversible.
    function disableCondition(uint256 conditionId) external onlyConditionOwner(conditionId) {
        ConditionTypes.Condition storage c = _conditions[conditionId];
        ConditionTypes.Status from = c.status;
        if (from == ConditionTypes.Status.DISABLED) {
            revert InvalidStatusTransition(from, ConditionTypes.Status.DISABLED);
        }
        c.status = ConditionTypes.Status.DISABLED;
        emit ConditionStatusChanged(conditionId, from, ConditionTypes.Status.DISABLED);
    }

    /*//////////////////////////////////////////////////////////////
                              STATE MACHINE
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IConditionRegistry
    /// @dev Called by the executor *before* it moves any funds, so the latch is
    ///      set first and a reentrant call finds the condition already fired.
    function markTriggered(uint256 conditionId) external override returns (uint32) {
        if (!isAuthorizedExecutor(msg.sender)) revert NotExecutor(msg.sender);
        if (!canExecute(conditionId)) revert ConditionNotExecutable(conditionId);

        ConditionTypes.Condition storage c = _conditions[conditionId];

        c.arm = ConditionTypes.Arm.FIRED;
        c.triggerCount += 1;
        c.lastTriggeredAt = uint64(block.timestamp);
        c.lastEvaluatedAt = uint64(block.timestamp);

        ConditionTypes.Status from = c.status;
        // A recurring condition waits for re-arm; a one-shot condition is done.
        ConditionTypes.Status to =
            c.recurring ? ConditionTypes.Status.TRIGGERED : ConditionTypes.Status.EXECUTED;
        c.status = to;

        emit ConditionTriggered(
            conditionId,
            c.triggerCount,
            observedValue(conditionId),
            c.threshold,
            uint64(block.timestamp)
        );
        emit ConditionStatusChanged(conditionId, from, to);

        return c.triggerCount;
    }

    /// @inheritdoc IConditionRegistry
    /// @dev Permissionless: it can only ever move a condition back to ACTIVE, and
    ///      only when the evaluator confirms a genuine recovery. Anyone paying
    ///      the gas to re-arm someone's condition is doing them a favour.
    function rearm(uint256 conditionId) external override {
        if (!canRearm(conditionId)) revert ConditionNotRearmable(conditionId);

        ConditionTypes.Condition storage c = _conditions[conditionId];
        ConditionTypes.Status from = c.status;

        c.arm = ConditionTypes.Arm.ARMED;
        c.status = ConditionTypes.Status.ACTIVE;
        c.lastEvaluatedAt = uint64(block.timestamp);

        emit ConditionRearmed(conditionId, observedValue(conditionId), uint64(block.timestamp));
        emit ConditionStatusChanged(conditionId, from, ConditionTypes.Status.ACTIVE);
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice The value the condition's evaluator currently observes.
    function observedValue(uint256 conditionId) public view override returns (uint256) {
        ConditionTypes.Condition storage c = _conditions[conditionId];
        if (c.status == ConditionTypes.Status.NONE) return 0;

        address evaluator = evaluatorFor[c.kind];
        if (evaluator == address(0)) return 0;

        return IConditionEvaluator(evaluator).observe(c.subject, _conditionParams[conditionId]);
    }

    /// @inheritdoc IConditionRegistry
    function isConditionTrue(uint256 conditionId) public view override returns (bool) {
        ConditionTypes.Condition storage c = _conditions[conditionId];
        if (c.status == ConditionTypes.Status.NONE) return false;

        address evaluator = evaluatorFor[c.kind];
        if (evaluator == address(0)) return false;

        return IConditionEvaluator(evaluator).evaluate(
            c.subject, c.threshold, c.operator, _conditionParams[conditionId]
        );
    }

    /// @inheritdoc IConditionRegistry
    function canExecute(uint256 conditionId) public view override returns (bool) {
        ConditionTypes.Condition storage c = _conditions[conditionId];
        if (c.status != ConditionTypes.Status.ACTIVE) return false;
        if (c.arm != ConditionTypes.Arm.ARMED) return false;
        return isConditionTrue(conditionId);
    }

    /// @inheritdoc IConditionRegistry
    /// @dev Delegated to the evaluator, which owns both directions of recovery.
    function canRearm(uint256 conditionId) public view override returns (bool) {
        ConditionTypes.Condition storage c = _conditions[conditionId];
        if (c.arm != ConditionTypes.Arm.FIRED) return false;
        if (c.status != ConditionTypes.Status.TRIGGERED) return false;
        if (!c.recurring) return false;

        address evaluator = evaluatorFor[c.kind];
        if (evaluator == address(0)) return false;

        return IConditionEvaluator(evaluator).canRearm(
            c.subject, c.threshold, c.rearmBuffer, c.operator, _conditionParams[conditionId]
        );
    }

    /// @inheritdoc IConditionRegistry
    function isConditionActive(uint256 conditionId) external view override returns (bool) {
        return _conditions[conditionId].status == ConditionTypes.Status.ACTIVE;
    }

    /// @inheritdoc IConditionRegistry
    function getCondition(uint256 conditionId)
        external
        view
        override
        returns (ConditionTypes.Condition memory)
    {
        ConditionTypes.Condition memory c = _conditions[conditionId];
        if (c.status == ConditionTypes.Status.NONE) revert ConditionNotFound(conditionId);
        return c;
    }

    /// @inheritdoc IConditionRegistry
    function getAction(uint256 actionId)
        external
        view
        override
        returns (ConditionTypes.Action memory)
    {
        return _actions[actionId];
    }

    /// @notice Extra evaluator parameters stored for a condition, if any.
    function getConditionParams(uint256 conditionId) external view returns (bytes memory) {
        return _conditionParams[conditionId];
    }

    /// @notice Everything the UI, SDK and keeper need for one condition, in one call.
    /// @return condition The stored condition.
    /// @return action The bound action.
    /// @return currentValue Live value observed by the condition's evaluator.
    /// @return executable Whether it would fire right now.
    /// @return rearmable Whether it could be re-armed right now.
    function getConditionView(uint256 conditionId)
        external
        view
        returns (
            ConditionTypes.Condition memory condition,
            ConditionTypes.Action memory action,
            uint256 currentValue,
            bool executable,
            bool rearmable
        )
    {
        condition = _conditions[conditionId];
        if (condition.status == ConditionTypes.Status.NONE) revert ConditionNotFound(conditionId);
        action = _actions[condition.actionId];
        currentValue = observedValue(conditionId);
        executable = canExecute(conditionId);
        rearmable = canRearm(conditionId);
    }

    /// @notice Condition ids belonging to `owner`, oldest first.
    function conditionsOf(address owner) external view returns (uint256[] memory) {
        return _ownerConditions[owner];
    }

    function conditionCountOf(address owner) external view returns (uint256) {
        return _ownerConditions[owner].length;
    }

    /// @notice Total conditions ever created. Ids run 1..totalConditions().
    function totalConditions() external view returns (uint256) {
        return _nextConditionId - 1;
    }

    /*//////////////////////////////////////////////////////////////
                             PROTOCOL ADMIN
    //////////////////////////////////////////////////////////////*/

    /// @notice Whether an address may latch conditions as fired.
    /// @dev The primary executor, or any additional one authorized for a
    ///      migration window. address(0) is never authorized.
    function isAuthorizedExecutor(address candidate) public view override returns (bool) {
        if (candidate == address(0)) return false;
        return candidate == executor || additionalExecutors[candidate];
    }

    /// @notice Set the primary executor permitted to latch conditions.
    /// @dev Cannot reach user funds on its own: every transfer additionally
    ///      requires the user's vault to have authorized the same executor.
    function setExecutor(address newExecutor) external onlyOwner {
        emit ExecutorUpdated(executor, newExecutor);
        executor = newExecutor;
    }

    /// @notice Authorize or retire an additional executor.
    ///
    /// @dev The staged-migration control. Authorize the new executor, let users
    ///      move their vaults at their own pace, then retire the old one.
    ///
    ///      Adding an executor here does not let it move anyone's funds: every
    ///      vault it touches must have independently named it, and the user
    ///      alone can do that.
    function setAdditionalExecutor(address additionalExecutor, bool allowed) external onlyOwner {
        if (additionalExecutor == address(0)) revert ZeroAddress();
        additionalExecutors[additionalExecutor] = allowed;
        emit AdditionalExecutorUpdated(additionalExecutor, allowed);
    }
}
