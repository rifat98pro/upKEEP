// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ConditionRegistry} from "../src/ConditionRegistry.sol";
import {AutomationVault} from "../src/AutomationVault.sol";
import {BalanceThresholdEvaluator} from "../src/evaluators/BalanceThresholdEvaluator.sol";
import {ConditionTypes} from "../src/libraries/ConditionTypes.sol";

/// @title ConditionRegistryTest
/// @notice Proves conditions belong to their creator and that the latch cannot
///         be bypassed.
contract ConditionRegistryTest is Test {
    ConditionRegistry registry;
    AutomationVault vault;
    BalanceThresholdEvaluator evaluator;

    address admin = makeAddr("admin");
    address user = makeAddr("user");
    address attacker = makeAddr("attacker");
    address executor = makeAddr("executor");
    address treasury = makeAddr("treasury");
    address recipient = makeAddr("reserveWallet");
    address sourceWallet = makeAddr("treasuryWallet");

    uint128 constant THRESHOLD = 5000e18; // $5,000
    uint128 constant REARM_BUFFER = 100e18; // $100 of hysteresis
    uint128 constant AMOUNT = 1000e18; // $1,000
    uint128 constant MAX_AMOUNT = 1000e18;

    uint256 conditionId;

    function setUp() public {
        vm.startPrank(admin);
        registry = new ConditionRegistry(admin);
        evaluator = new BalanceThresholdEvaluator();
        // Balance Guard is a registered evaluator, not a special case in the engine.
        registry.registerEvaluator(address(evaluator));
        registry.setExecutor(executor);
        vm.stopPrank();

        vm.deal(user, 10_000e18);
        vm.prank(user);
        vault = new AutomationVault{value: 5000e18}(
            user, executor, recipient, MAX_AMOUNT, 0, 5, treasury
        );

        vm.deal(sourceWallet, 8000e18); // healthy: above threshold

        vm.prank(user);
        (conditionId,) = registry.createCondition(_params());
    }

    function _params() private view returns (ConditionRegistry.CreateParams memory) {
        return ConditionRegistry.CreateParams({
            kind: ConditionTypes.KIND_BALANCE_THRESHOLD,
            operator: ConditionTypes.OP_LT,
            subject: sourceWallet,
            threshold: THRESHOLD,
            rearmBuffer: REARM_BUFFER,
            recurring: true,
            params: "",
            actionKind: ConditionTypes.ACTION_TRANSFER_USDC,
            vault: address(vault),
            recipient: recipient,
            amount: AMOUNT,
            maxAmount: MAX_AMOUNT
        });
    }

    /*//////////////////////////////////////////////////////////////
                                CREATION
    //////////////////////////////////////////////////////////////*/

    function test_createCondition_storesEverything() public view {
        ConditionTypes.Condition memory c = registry.getCondition(conditionId);

        assertEq(c.owner, user);
        assertEq(c.subject, sourceWallet);
        assertEq(c.threshold, THRESHOLD);
        assertEq(c.rearmBuffer, REARM_BUFFER);
        assertTrue(c.recurring);
        assertEq(uint8(c.status), uint8(ConditionTypes.Status.ACTIVE));
        assertEq(uint8(c.arm), uint8(ConditionTypes.Arm.ARMED));
        assertEq(c.triggerCount, 0);

        ConditionTypes.Action memory a = registry.getAction(c.actionId);
        assertEq(a.vault, address(vault));
        assertEq(a.recipient, recipient);
        assertEq(a.amount, AMOUNT);
        assertEq(a.maxAmount, MAX_AMOUNT);
    }

    function test_createCondition_indexesByOwner() public view {
        uint256[] memory ids = registry.conditionsOf(user);
        assertEq(ids.length, 1);
        assertEq(ids[0], conditionId);
        assertEq(registry.totalConditions(), 1);
    }

    /// @notice You may not bind a vault you do not own.
    function test_createCondition_rejectsForeignVault() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConditionRegistry.NotVaultOwner.selector, address(vault), attacker
            )
        );
        registry.createCondition(_params());
    }

    /// @notice The registry must agree with the vault about the destination.
    function test_createCondition_rejectsRecipientMismatch() public {
        ConditionRegistry.CreateParams memory p = _params();
        p.recipient = attacker;

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConditionRegistry.VaultRecipientMismatch.selector, recipient, attacker
            )
        );
        registry.createCondition(p);
    }

    /// @notice A condition may not authorize more than the vault's own ceiling.
    function test_createCondition_rejectsAmountAboveVaultLimit() public {
        ConditionRegistry.CreateParams memory p = _params();
        p.amount = MAX_AMOUNT + 1;
        p.maxAmount = MAX_AMOUNT + 1;

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConditionRegistry.VaultLimitTooLow.selector, MAX_AMOUNT, MAX_AMOUNT + 1
            )
        );
        registry.createCondition(p);
    }

    function test_createCondition_rejectsAmountAboveItsOwnMax() public {
        ConditionRegistry.CreateParams memory p = _params();
        p.amount = 900e18;
        p.maxAmount = 800e18;

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConditionRegistry.AmountExceedsMax.selector, uint128(900e18), uint128(800e18)
            )
        );
        registry.createCondition(p);
    }

    function test_createCondition_rejectsZeroAddresses() public {
        ConditionRegistry.CreateParams memory p = _params();
        p.subject = address(0);
        vm.prank(user);
        vm.expectRevert(ConditionRegistry.ZeroAddress.selector);
        registry.createCondition(p);

        p = _params();
        p.recipient = address(0);
        vm.prank(user);
        vm.expectRevert(ConditionRegistry.ZeroAddress.selector);
        registry.createCondition(p);

        p = _params();
        p.vault = address(0);
        vm.prank(user);
        vm.expectRevert(ConditionRegistry.ZeroAddress.selector);
        registry.createCondition(p);
    }

    function test_createCondition_rejectsZeroAmounts() public {
        ConditionRegistry.CreateParams memory p = _params();
        p.threshold = 0;
        vm.prank(user);
        vm.expectRevert(ConditionRegistry.ZeroAmount.selector);
        registry.createCondition(p);

        p = _params();
        p.amount = 0;
        vm.prank(user);
        vm.expectRevert(ConditionRegistry.ZeroAmount.selector);
        registry.createCondition(p);
    }

    /*//////////////////////////////////////////////////////////////
                 UNAUTHORIZED CONDITION MODIFICATION (§37)
    //////////////////////////////////////////////////////////////*/

    function test_unauthorizedModification_pauseReverts() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConditionRegistry.NotConditionOwner.selector, conditionId, attacker
            )
        );
        registry.pauseCondition(conditionId);
    }

    function test_unauthorizedModification_disableReverts() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConditionRegistry.NotConditionOwner.selector, conditionId, attacker
            )
        );
        registry.disableCondition(conditionId);
    }

    /// @notice Not even the protocol admin may touch a user's condition.
    function test_unauthorizedModification_adminCannotPause() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConditionRegistry.NotConditionOwner.selector, conditionId, admin
            )
        );
        registry.pauseCondition(conditionId);
    }

    function test_unknownCondition_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(ConditionRegistry.ConditionNotFound.selector, 999));
        registry.pauseCondition(999);
    }

    /*//////////////////////////////////////////////////////////////
                           LIFECYCLE (§37)
    //////////////////////////////////////////////////////////////*/

    function test_pausedCondition_isNotExecutable() public {
        vm.deal(sourceWallet, 4000e18); // below threshold: would otherwise fire
        assertTrue(registry.canExecute(conditionId));

        vm.prank(user);
        registry.pauseCondition(conditionId);

        assertFalse(registry.canExecute(conditionId), "paused condition still executable");
    }

    function test_disabledCondition_isNotExecutable() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(user);
        registry.disableCondition(conditionId);

        assertFalse(registry.canExecute(conditionId));
    }

    function test_disabledCondition_cannotBeResumed() public {
        vm.startPrank(user);
        registry.disableCondition(conditionId);

        vm.expectRevert(
            abi.encodeWithSelector(
                ConditionRegistry.InvalidStatusTransition.selector,
                ConditionTypes.Status.DISABLED,
                ConditionTypes.Status.ACTIVE
            )
        );
        registry.resumeCondition(conditionId);
        vm.stopPrank();
    }

    function test_pauseResume_roundTrip() public {
        vm.startPrank(user);
        registry.pauseCondition(conditionId);
        assertEq(
            uint8(registry.getCondition(conditionId).status), uint8(ConditionTypes.Status.PAUSED)
        );

        registry.resumeCondition(conditionId);
        assertEq(
            uint8(registry.getCondition(conditionId).status), uint8(ConditionTypes.Status.ACTIVE)
        );
        vm.stopPrank();
    }

    /// @notice Pausing and resuming must not launder a fired latch back to armed.
    function test_pauseResume_cannotBypassTheLatch() public {
        vm.deal(sourceWallet, 4000e18);
        vm.prank(executor);
        registry.markTriggered(conditionId);

        vm.startPrank(user);
        registry.pauseCondition(conditionId);
        registry.resumeCondition(conditionId);
        vm.stopPrank();

        ConditionTypes.Condition memory c = registry.getCondition(conditionId);
        assertEq(uint8(c.status), uint8(ConditionTypes.Status.TRIGGERED), "latch was laundered");
        assertEq(uint8(c.arm), uint8(ConditionTypes.Arm.FIRED));
        assertFalse(registry.canExecute(conditionId), "condition re-armed without recovery");
    }

    /*//////////////////////////////////////////////////////////////
                      UNAUTHORIZED EXECUTION (§37)
    //////////////////////////////////////////////////////////////*/

    function test_markTriggered_onlyExecutor() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(ConditionRegistry.NotExecutor.selector, attacker));
        registry.markTriggered(conditionId);

        // Not even the condition's owner may latch it directly.
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(ConditionRegistry.NotExecutor.selector, user));
        registry.markTriggered(conditionId);
    }

    /// @notice The keeper cannot fabricate a trigger: the balance is read on-chain.
    function test_markTriggered_revertsWhenPredicateIsFalse() public {
        assertEq(sourceWallet.balance, 8000e18); // healthy, above threshold

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(ConditionRegistry.ConditionNotExecutable.selector, conditionId)
        );
        registry.markTriggered(conditionId);
    }

    function test_setExecutor_onlyAdmin() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        registry.setExecutor(attacker);
    }

    /*//////////////////////////////////////////////////////////////
                     REPEATED TRIGGER / STATE MACHINE (§37)
    //////////////////////////////////////////////////////////////*/

    /// @notice The headline anti-drain property: a balance that simply stays
    ///         below the threshold fires exactly once, however often it is polled.
    function test_repeatedTrigger_balanceStaysLow_firesOnlyOnce() public {
        vm.deal(sourceWallet, 4900e18); // below $5,000

        vm.prank(executor);
        registry.markTriggered(conditionId);
        assertEq(registry.getCondition(conditionId).triggerCount, 1);

        // Poll again and again. The balance is still 4,900.
        for (uint256 i = 0; i < 10; i++) {
            assertFalse(registry.canExecute(conditionId), "condition re-fired while still low");
            vm.prank(executor);
            vm.expectRevert(
                abi.encodeWithSelector(
                    ConditionRegistry.ConditionNotExecutable.selector, conditionId
                )
            );
            registry.markTriggered(conditionId);
        }

        assertEq(registry.getCondition(conditionId).triggerCount, 1, "fired more than once");
    }

    /// @notice NORMAL -> TRIGGERED -> (recovery) -> ARMED -> TRIGGERED again.
    function test_stateMachine_fullCycle() public {
        // 1. Healthy.
        assertFalse(registry.canExecute(conditionId));

        // 2. Drops below the threshold -> fires.
        vm.deal(sourceWallet, 4000e18);
        assertTrue(registry.canExecute(conditionId));
        vm.prank(executor);
        registry.markTriggered(conditionId);

        ConditionTypes.Condition memory c = registry.getCondition(conditionId);
        assertEq(uint8(c.status), uint8(ConditionTypes.Status.TRIGGERED));
        assertEq(uint8(c.arm), uint8(ConditionTypes.Arm.FIRED));

        // 3. Partial recovery, still inside the hysteresis band -> stays fired.
        vm.deal(sourceWallet, THRESHOLD + REARM_BUFFER - 1);
        assertFalse(registry.canRearm(conditionId), "re-armed inside the hysteresis band");

        // 4. Full recovery -> re-armable.
        vm.deal(sourceWallet, THRESHOLD + REARM_BUFFER);
        assertTrue(registry.canRearm(conditionId));
        registry.rearm(conditionId);

        c = registry.getCondition(conditionId);
        assertEq(uint8(c.status), uint8(ConditionTypes.Status.ACTIVE));
        assertEq(uint8(c.arm), uint8(ConditionTypes.Arm.ARMED));

        // 5. Drops again -> fires again.
        vm.deal(sourceWallet, 4000e18);
        assertTrue(registry.canExecute(conditionId));
        vm.prank(executor);
        registry.markTriggered(conditionId);
        assertEq(registry.getCondition(conditionId).triggerCount, 2);
    }

    function test_rearm_revertsWhenNotRecovered() public {
        vm.deal(sourceWallet, 4000e18);
        vm.prank(executor);
        registry.markTriggered(conditionId);

        vm.expectRevert(
            abi.encodeWithSelector(ConditionRegistry.ConditionNotRearmable.selector, conditionId)
        );
        registry.rearm(conditionId);
    }

    function test_rearm_isPermissionless() public {
        vm.deal(sourceWallet, 4000e18);
        vm.prank(executor);
        registry.markTriggered(conditionId);

        vm.deal(sourceWallet, 9000e18);
        vm.prank(attacker); // anyone may pay the gas to re-arm
        registry.rearm(conditionId);

        assertEq(
            uint8(registry.getCondition(conditionId).status), uint8(ConditionTypes.Status.ACTIVE)
        );
    }

    /// @notice A one-shot condition retires itself instead of waiting to re-arm.
    function test_oneShotCondition_retiresAfterFiring() public {
        ConditionRegistry.CreateParams memory p = _params();
        p.recurring = false;

        vm.prank(user);
        (uint256 oneShotId,) = registry.createCondition(p);

        vm.deal(sourceWallet, 4000e18);
        vm.prank(executor);
        registry.markTriggered(oneShotId);

        ConditionTypes.Condition memory c = registry.getCondition(oneShotId);
        assertEq(uint8(c.status), uint8(ConditionTypes.Status.EXECUTED));
        assertFalse(registry.canExecute(oneShotId));

        vm.deal(sourceWallet, 9000e18);
        assertFalse(registry.canRearm(oneShotId), "a one-shot condition re-armed");
    }

    /*//////////////////////////////////////////////////////////////
                                 FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @notice The predicate must match a plain comparison at every balance.
    function testFuzz_predicateMatchesBalanceComparison(uint256 balance) public {
        balance = bound(balance, 0, type(uint128).max);
        vm.deal(sourceWallet, balance);

        assertEq(registry.isConditionTrue(conditionId), balance < THRESHOLD);
        assertEq(registry.canExecute(conditionId), balance < THRESHOLD);
    }

    /// @notice No sequence of polls can fire twice without a genuine recovery.
    function testFuzz_cannotFireTwiceWithoutRecovery(uint256 balanceA, uint256 balanceB) public {
        balanceA = bound(balanceA, 0, THRESHOLD - 1);
        balanceB = bound(balanceB, 0, uint256(THRESHOLD) + uint256(REARM_BUFFER) - 1);

        vm.deal(sourceWallet, balanceA);
        vm.prank(executor);
        registry.markTriggered(conditionId);

        vm.deal(sourceWallet, balanceB);
        assertFalse(registry.canExecute(conditionId));
        assertFalse(registry.canRearm(conditionId));
        assertEq(registry.getCondition(conditionId).triggerCount, 1);
    }
}
