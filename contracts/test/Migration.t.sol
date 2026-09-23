// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ConditionRegistry} from "../src/ConditionRegistry.sol";
import {AutomationExecutor} from "../src/AutomationExecutor.sol";
import {AutomationVault} from "../src/AutomationVault.sol";
import {AutomationVaultFactory} from "../src/AutomationVaultFactory.sol";
import {BalanceThresholdEvaluator} from "../src/evaluators/BalanceThresholdEvaluator.sol";
import {ConditionTypes} from "../src/libraries/ConditionTypes.sol";

/// @title MigrationTest
/// @notice upKEEP's contracts are not upgradeable, deliberately. Migration
///         therefore has to work by *address indirection*, and this suite is
///         where that claim is tested rather than asserted.
///
/// @dev The scenario throughout is the one that actually matters: a new
///      authorization mechanism arrives - a post-quantum executor, a smart
///      account, anything - and existing users must be able to move to it
///      without their conditions being recreated and without a flag day where
///      everyone is broken at once.
contract MigrationTest is Test {
    ConditionRegistry registry;
    AutomationExecutor executorV1;
    AutomationExecutor executorV2;
    AutomationVaultFactory factory;

    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice"); // migrates early
    address bob = makeAddr("bob"); // migrates late
    address treasury = makeAddr("treasury");
    address recipient = makeAddr("reserveWallet");
    address subject = makeAddr("watchedWallet");

    uint128 constant THRESHOLD = 5000e18;
    uint128 constant AMOUNT = 1000e18;

    AutomationVault aliceVault;
    AutomationVault bobVault;
    uint256 aliceCondition;
    uint256 bobCondition;

    function setUp() public {
        vm.startPrank(admin);
        registry = new ConditionRegistry(admin);
        executorV1 = new AutomationExecutor(address(registry), admin);
        factory = new AutomationVaultFactory(admin, treasury, 5, address(executorV1));

        registry.registerEvaluator(address(new BalanceThresholdEvaluator()));
        registry.setExecutor(address(executorV1));
        executorV1.setKeeper(keeper, true);
        vm.stopPrank();

        vm.deal(alice, 20_000e18);
        vm.deal(bob, 20_000e18);
        vm.deal(subject, 8000e18);

        (aliceVault, aliceCondition) = _onboard(alice);
        (bobVault, bobCondition) = _onboard(bob);
    }

    function _onboard(address user) private returns (AutomationVault vault, uint256 conditionId) {
        vm.startPrank(user);
        vault = AutomationVault(
            payable(factory.createVault{value: 5000e18}(recipient, AMOUNT, address(0)))
        );

        (conditionId,) = registry.createCondition(
            ConditionRegistry.CreateParams({
                kind: ConditionTypes.KIND_BALANCE_THRESHOLD,
                operator: ConditionTypes.OP_LT,
                params: "",
                actionKind: ConditionTypes.ACTION_TRANSFER_USDC,
                subject: subject,
                threshold: THRESHOLD,
                rearmBuffer: 0,
                recurring: true,
                vault: address(vault),
                recipient: recipient,
                amount: AMOUNT,
                maxAmount: AMOUNT
            })
        );
        vm.stopPrank();
    }

    /// @dev Drop the watched balance, execute, then restore and re-arm, so each
    ///      phase of the migration can be exercised independently.
    function _fireAndReset(AutomationExecutor via, uint256 conditionId) private {
        vm.deal(subject, 4000e18);
        vm.prank(keeper);
        via.execute(conditionId);

        vm.deal(subject, 9000e18);
        registry.rearm(conditionId);
    }

    /*//////////////////////////////////////////////////////////////
                        THE FLAG-DAY PROBLEM
    //////////////////////////////////////////////////////////////*/

    /// @notice Both halves of the authorization must agree, which is exactly why
    ///         a single registry executor would make migration a flag day.
    function test_executionRequiresRegistryAndVaultToAgree() public {
        AutomationExecutor stranger = new AutomationExecutor(address(registry), admin);
        vm.prank(admin);
        stranger.setKeeper(keeper, true);

        vm.deal(subject, 4000e18);

        // The registry does not know this executor, so it cannot latch.
        vm.prank(keeper);
        vm.expectRevert();
        stranger.execute(aliceCondition);
    }

    /*//////////////////////////////////////////////////////////////
                          STAGED MIGRATION
    //////////////////////////////////////////////////////////////*/

    /// @notice The headline: a new authorization mechanism is introduced, users
    ///         move at their own pace, and nobody is broken in between.
    function test_stagedMigration_bothExecutorsWorkSideBySide() public {
        // Everyone is on v1 and working.
        _fireAndReset(executorV1, aliceCondition);
        _fireAndReset(executorV1, bobCondition);

        // A new authorization mechanism ships. The admin authorizes it
        // *alongside* the old one rather than replacing it.
        vm.startPrank(admin);
        executorV2 = new AutomationExecutor(address(registry), admin);
        executorV2.setKeeper(keeper, true);
        registry.setAdditionalExecutor(address(executorV2), true);
        vm.stopPrank();

        assertTrue(registry.isAuthorizedExecutor(address(executorV1)));
        assertTrue(registry.isAuthorizedExecutor(address(executorV2)));

        // Alice migrates her vault. Bob does nothing at all.
        vm.prank(alice);
        aliceVault.setExecutor(address(executorV2));

        // Alice now runs on the new mechanism...
        _fireAndReset(executorV2, aliceCondition);

        // ...and Bob is still running on the old one, undisturbed.
        _fireAndReset(executorV1, bobCondition);

        assertEq(registry.getCondition(aliceCondition).triggerCount, 2);
        assertEq(registry.getCondition(bobCondition).triggerCount, 2);
    }

    /// @notice A migrated user's condition keeps its identity completely.
    function test_migration_preservesTheConditionEntirely() public {
        _fireAndReset(executorV1, aliceCondition);

        ConditionTypes.Condition memory before = registry.getCondition(aliceCondition);
        ConditionTypes.Action memory actionBefore = registry.getAction(before.actionId);
        uint256 balanceBefore = address(aliceVault).balance;

        vm.startPrank(admin);
        executorV2 = new AutomationExecutor(address(registry), admin);
        executorV2.setKeeper(keeper, true);
        registry.setAdditionalExecutor(address(executorV2), true);
        vm.stopPrank();

        vm.prank(alice);
        aliceVault.setExecutor(address(executorV2));

        ConditionTypes.Condition memory afterMigration = registry.getCondition(aliceCondition);
        ConditionTypes.Action memory actionAfter = registry.getAction(afterMigration.actionId);

        assertEq(afterMigration.owner, before.owner, "owner changed");
        assertEq(afterMigration.subject, before.subject, "watched wallet changed");
        assertEq(afterMigration.threshold, before.threshold, "threshold changed");
        assertEq(afterMigration.triggerCount, before.triggerCount, "history lost");
        assertEq(afterMigration.createdAt, before.createdAt, "creation time changed");
        assertEq(uint8(afterMigration.arm), uint8(before.arm), "latch state changed");
        assertEq(actionAfter.amount, actionBefore.amount, "amount changed");
        assertEq(actionAfter.recipient, actionBefore.recipient, "recipient changed");
        assertEq(address(aliceVault).balance, balanceBefore, "funds moved");

        // And it keeps firing under the new mechanism.
        _fireAndReset(executorV2, aliceCondition);
        assertEq(registry.getCondition(aliceCondition).triggerCount, before.triggerCount + 1);
    }

    /// @notice Once everyone has moved, the old mechanism is retired.
    function test_migration_oldExecutorCanBeRetired() public {
        vm.startPrank(admin);
        executorV2 = new AutomationExecutor(address(registry), admin);
        executorV2.setKeeper(keeper, true);
        registry.setAdditionalExecutor(address(executorV2), true);
        vm.stopPrank();

        vm.prank(alice);
        aliceVault.setExecutor(address(executorV2));
        vm.prank(bob);
        bobVault.setExecutor(address(executorV2));

        // Promote v2 and retire v1.
        vm.startPrank(admin);
        registry.setExecutor(address(executorV2));
        registry.setAdditionalExecutor(address(executorV2), false);
        vm.stopPrank();

        assertFalse(registry.isAuthorizedExecutor(address(executorV1)), "v1 was not retired");
        assertTrue(registry.isAuthorizedExecutor(address(executorV2)));

        vm.deal(subject, 4000e18);
        vm.prank(keeper);
        vm.expectRevert();
        executorV1.execute(aliceCondition);

        // v2 still works for everyone.
        vm.prank(keeper);
        executorV2.execute(aliceCondition);
        assertEq(recipient.balance, 999.5e18);
    }

    /*//////////////////////////////////////////////////////////////
                    MIGRATION CANNOT BE FORCED
    //////////////////////////////////////////////////////////////*/

    /// @notice An admin can offer a new mechanism but cannot move a user onto it.
    function test_adminCannotMigrateAUserVault() public {
        vm.startPrank(admin);
        executorV2 = new AutomationExecutor(address(registry), admin);
        registry.setAdditionalExecutor(address(executorV2), true);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        aliceVault.setExecutor(address(executorV2));
        vm.stopPrank();

        assertEq(aliceVault.executor(), address(executorV1), "admin moved a user's vault");
    }

    /// @notice Authorizing an executor in the registry grants it nothing on its
    ///         own: it still needs each vault to have named it.
    function test_registryAuthorizationAloneReachesNoFunds() public {
        vm.startPrank(admin);
        executorV2 = new AutomationExecutor(address(registry), admin);
        executorV2.setKeeper(keeper, true);
        registry.setAdditionalExecutor(address(executorV2), true);
        vm.stopPrank();

        // Alice has NOT migrated, so v2 cannot touch her vault even though the
        // registry now trusts it.
        vm.deal(subject, 4000e18);
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(AutomationVault.NotExecutor.selector, address(executorV2))
        );
        executorV2.execute(aliceCondition);

        assertEq(recipient.balance, 0, "funds moved without the owner's consent");
    }

    function test_setAdditionalExecutor_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        registry.setAdditionalExecutor(address(0xBEEF), true);
    }

    function test_setAdditionalExecutor_rejectsZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(ConditionRegistry.ZeroAddress.selector);
        registry.setAdditionalExecutor(address(0), true);
    }

    /// @notice The zero address must never be an authorized executor, or an
    ///         unset primary would authorize everyone.
    function test_zeroAddressIsNeverAuthorized() public {
        vm.prank(admin);
        registry.setExecutor(address(0));
        assertFalse(registry.isAuthorizedExecutor(address(0)));
    }
}
