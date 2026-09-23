// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ConditionTypes
/// @notice Shared types for the upKEEP condition engine.
///
/// @dev upKEEP is a condition engine, not a balance-guard app. A condition is a
///      generic triple - subject, operator, threshold - evaluated by a pluggable
///      evaluator, bound to an action. Balance Guard is the first pair of
///      (evaluator, action) registered on that engine, not the thing the engine
///      is made of.
///
///      `kind` and `actionKind` are `uint8` rather than enums on purpose: a new
///      condition type is a new evaluator registration, not a contract upgrade.
///
///      All monetary values are **18-decimal native USDC wei**. On Arc, USDC is
///      the native gas token with 18 decimals and additionally exposes a
///      6-decimal ERC-20 view over the same balance. The Arc docs warn against
///      recording balances from the 6-decimal view because it truncates, so
///      upKEEP never does: `address.balance` and `msg.value` are the units of
///      account throughout. https://docs.arc.io/arc/references/evm-differences
library ConditionTypes {
    /*//////////////////////////////////////////////////////////////
                            CONDITION KINDS
    //////////////////////////////////////////////////////////////*/

    /// @notice Unset.
    uint8 internal constant KIND_NONE = 0;

    /// @notice Native USDC balance compared against a threshold.
    uint8 internal constant KIND_BALANCE_THRESHOLD = 1;

    /// @notice Wall-clock time compared against a deadline or a repeating window.
    /// @dev Added after deployment by deploying ScheduleEvaluator and calling
    ///      `registerEvaluator`. Nothing in the registry, the executor or any
    ///      vault changed to make this possible - which is the claim the engine
    ///      architecture makes, tested here by actually doing it.
    uint8 internal constant KIND_SCHEDULE = 2;

    /*//////////////////////////////////////////////////////////////
                             ACTION KINDS
    //////////////////////////////////////////////////////////////*/

    uint8 internal constant ACTION_NONE = 0;

    /// @notice Transfer USDC from a vault to its approved recipient.
    /// @dev Unlike evaluators, action kinds are deliberately *not* an open
    ///      plugin point. An evaluator is a view function and cannot touch
    ///      money; an action decides what upKEEP may do with user funds. Each
    ///      new action kind therefore has to be added explicitly here and in the
    ///      executor, so it is auditable and visible to users rather than
    ///      something an admin can register silently.
    uint8 internal constant ACTION_TRANSFER_USDC = 1;

    /*//////////////////////////////////////////////////////////////
                              OPERATORS
    //////////////////////////////////////////////////////////////*/

    uint8 internal constant OP_NONE = 0;
    uint8 internal constant OP_LT = 1; // subject value <  threshold
    uint8 internal constant OP_GT = 2; // subject value >  threshold
    uint8 internal constant OP_LTE = 3; // subject value <= threshold
    uint8 internal constant OP_GTE = 4; // subject value >= threshold

    /*//////////////////////////////////////////////////////////////
                                 STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice Lifecycle of a persistent condition.
    enum Status {
        NONE,
        ACTIVE, // evaluating; may fire when armed and the predicate is true
        PAUSED, // owner halted evaluation; funds untouched
        TRIGGERED, // fired at least once and awaiting re-arm (recurring only)
        EXECUTED, // one-shot condition that has fired and will not fire again
        DISABLED // permanently retired by the owner

    }

    /// @notice Hysteresis latch. This is what stops a condition that stays true
    ///         from executing on every single poll.
    enum Arm {
        ARMED, // predicate may fire
        FIRED // predicate already fired; needs re-arm before firing again

    }

    /*//////////////////////////////////////////////////////////////
                                STRUCTS
    //////////////////////////////////////////////////////////////*/

    /// @notice A persistent financial condition.
    /// @dev Packed to keep createCondition affordable. uint128 holds up to
    ///      ~3.4e38 wei, i.e. ~3.4e20 USDC, far beyond any real threshold.
    struct Condition {
        address owner; // may pause/resume/disable; nobody else can
        address subject; // what the condition is about (V1: the watched wallet)
        uint128 threshold; // the value compared against
        uint128 rearmBuffer; // hysteresis the subject must clear to re-arm
        uint256 actionId; // the authorized action to perform
        uint8 kind; // which evaluator interprets this condition
        uint8 operator; // how subject value and threshold are compared
        Status status;
        Arm arm;
        bool recurring; // false => one-shot, moves to EXECUTED after firing
        uint32 triggerCount;
        uint64 createdAt;
        uint64 lastEvaluatedAt; // updated on on-chain transitions only
        uint64 lastTriggeredAt;
    }

    /// @notice The single authorized action bound to a condition.
    /// @dev `amount` is what gets released per execution. `maxAmount` is the
    ///      ceiling the owner authorized and is enforced again, independently,
    ///      inside the vault. Neither the keeper nor the registry can raise it.
    struct Action {
        uint8 kind;
        address vault; // AutomationVault funding the action
        address recipient; // the one approved destination
        uint128 amount;
        uint128 maxAmount;
    }
}
