// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AutomationExecutor} from "../src/AutomationExecutor.sol";
import {AutomationVault} from "../src/AutomationVault.sol";
import {AutomationVaultFactory} from "../src/AutomationVaultFactory.sol";
import {ConditionRegistry} from "../src/ConditionRegistry.sol";
import {BalanceThresholdEvaluator} from "../src/evaluators/BalanceThresholdEvaluator.sol";
import {ConditionTypes} from "../src/libraries/ConditionTypes.sol";
import {ReentrantRecipient} from "./helpers/Mocks.sol";

/// @title AutomationExecutorTest
/// @notice End-to-end: a real Balance Guard, from creation through execution,
///         re-arm and re-execution, with the adversarial cases in between.
contract AutomationExecutorTest is Test {
    ConditionRegistry registry;
    AutomationExecutor executor;
    AutomationVaultFactory factory;
    AutomationVault vault;

    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address user = makeAddr("user");
    address attacker = makeAddr("attacker");
    address treasury = makeAddr("treasury");
    address recipient = makeAddr("reserveWallet");
    address sourceWallet = makeAddr("treasuryWallet");

    uint128 constant THRESHOLD = 5000e18;
    uint128 constant REARM_BUFFER = 0;
    uint128 constant AMOUNT = 1000e18;
    uint128 constant MAX_AMOUNT = 1000e18;
    uint256 constant FEE_BPS = 5;

    uint256 conditionId;

    function setUp() public {
        vm.startPrank(admin);
        registry = new ConditionRegistry(admin);
        executor = new AutomationExecutor(address(registry), admin);
        factory = new AutomationVaultFactory(admin, treasury, FEE_BPS, address(executor));
        // Balance Guard is registered onto the engine like any other condition kind.
        registry.registerEvaluator(address(new BalanceThresholdEvaluator()));
        registry.setExecutor(address(executor));
        executor.setKeeper(keeper, true);
        vm.stopPrank();

        vm.deal(user, 20_000e18);
        vm.prank(user);
        vault = AutomationVault(
            payable(factory.createVault{value: 5000e18}(recipient, MAX_AMOUNT, address(0)))
        );

        vm.deal(sourceWallet, 8000e18); // healthy

        vm.prank(user);
        (conditionId,) = registry.createCondition(
            ConditionRegistry.CreateParams({
                kind: ConditionTypes.KIND_BALANCE_THRESHOLD,
                operator: ConditionTypes.OP_LT,
                params: "",
                actionKind: ConditionTypes.ACTION_TRANSFER_USDC,
                subject: sourceWallet,
                threshold: THRESHOLD,
                rearmBuffer: REARM_BUFFER,
                recurring: true,
                vault: address(vault),
                recipient: recipient,
                amount: AMOUNT,
                maxAmount: MAX_AMOUNT
            })
        );
    }

    /*//////////////////////////////////////////////////////////////
                             THE HAPPY PATH
    //////////////////////////////////////////////////////////////*/

    /// @notice IF balance < $5,000 THEN transfer $1,000 to the reserve wallet.
    function test_endToEnd_balanceGuardFires() public {
        // Balance is healthy: nothing happens.
        (bool executableBefore,,,,,) = executor.simulate(conditionId);
        assertFalse(executableBefore, "fired while the balance was healthy");

        // The treasury is drawn down below the threshold.
        vm.deal(sourceWallet, 4200e18);

        (bool executableNow, uint256 gross, uint256 net, uint256 fee,,) =
            executor.simulate(conditionId);
        assertTrue(executableNow, "condition did not become executable");
        assertEq(gross, AMOUNT);
        assertEq(fee, 0.5e18, "fee quote must be $0.50");
        assertEq(net, 999.5e18);

        uint256 vaultBefore = address(vault).balance;

        vm.prank(keeper);
        (bytes32 executionId, uint256 settledNet, uint256 settledFee) = executor.execute(conditionId);

        // Money moved exactly as quoted.
        assertEq(settledNet, net, "settled net differed from the quote");
        assertEq(settledFee, fee, "settled fee differed from the quote");
        assertEq(recipient.balance, 999.5e18, "reserve wallet underpaid");
        assertEq(treasury.balance, 0.5e18, "protocol fee not collected");
        assertEq(address(vault).balance, vaultBefore - AMOUNT);

        // State advanced.
        ConditionTypes.Condition memory c = registry.getCondition(conditionId);
        assertEq(uint8(c.status), uint8(ConditionTypes.Status.TRIGGERED));
        assertEq(c.triggerCount, 1);
        assertEq(executor.totalExecutions(), 1);
        assertTrue(executor.executedTriggers(executionId));
        assertTrue(vault.executed(executionId));
    }

    /// @notice The micro-amount path intended for the first Mainnet execution.
    function test_endToEnd_microAmounts() public {
        address microSource = makeAddr("microSource");
        address microRecipient = makeAddr("microRecipient");

        vm.prank(user);
        AutomationVault microVault = AutomationVault(
            payable(factory.createVault{value: 0.05e18}(microRecipient, 0.01e18, address(0)))
        );

        vm.deal(microSource, 0.2e18); // $0.20, above a $0.10 threshold

        vm.prank(user);
        (uint256 microId,) = registry.createCondition(
            ConditionRegistry.CreateParams({
                kind: ConditionTypes.KIND_BALANCE_THRESHOLD,
                operator: ConditionTypes.OP_LT,
                params: "",
                actionKind: ConditionTypes.ACTION_TRANSFER_USDC,
                subject: microSource,
                threshold: 0.1e18, // $0.10
                rearmBuffer: 0,
                recurring: true,
                vault: address(microVault),
                recipient: microRecipient,
                amount: 0.01e18, // $0.01
                maxAmount: 0.01e18
            })
        );

        vm.deal(microSource, 0.05e18); // drop below $0.10

        vm.prank(keeper);
        (, uint256 net, uint256 fee) = executor.execute(microId);

        assertEq(fee, 1e14, "micro fee must be the 1% cap: $0.0001");
        assertEq(net, 0.01e18 - 1e14);
        assertEq(microRecipient.balance, net);
        assertLt(fee, 0.01e18, "fee outgrew the transfer");
    }

    /*//////////////////////////////////////////////////////////////
                          AUTHORIZATION (§37)
    //////////////////////////////////////////////////////////////*/

    function test_unauthorizedExecution_nonKeeperReverts() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AutomationExecutor.NotKeeper.selector, attacker));
        executor.execute(conditionId);
    }

    function test_permissionlessMode_allowsAnyone() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(admin);
        executor.setPermissionless(true);

        // Safe because the predicate is verified on-chain and the action is
        // fully constrained by the user's vault.
        vm.prank(attacker);
        executor.execute(conditionId);

        assertEq(recipient.balance, 999.5e18, "funds went somewhere unexpected");
    }

    function test_keeperCannotRedirectFunds() public {
        vm.deal(sourceWallet, 4000e18);

        // The keeper's only input is a condition id. There is no parameter through
        // which it could name itself as the recipient.
        vm.prank(keeper);
        executor.execute(conditionId);

        assertEq(keeper.balance, 0, "keeper paid itself");
        assertEq(attacker.balance, 0);
        assertEq(recipient.balance, 999.5e18);
    }

    function test_removedKeeper_cannotExecute() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(admin);
        executor.setKeeper(keeper, false);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(AutomationExecutor.NotKeeper.selector, keeper));
        executor.execute(conditionId);
    }

    /*//////////////////////////////////////////////////////////////
                        EMERGENCY CONTROLS (§37)
    //////////////////////////////////////////////////////////////*/

    function test_pausedCondition_blocksExecution() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(user);
        registry.pauseCondition(conditionId);

        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(AutomationExecutor.ConditionNotExecutable.selector, conditionId)
        );
        executor.execute(conditionId);
    }

    function test_disabledCondition_blocksExecution() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(user);
        registry.disableCondition(conditionId);

        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(AutomationExecutor.ConditionNotExecutable.selector, conditionId)
        );
        executor.execute(conditionId);
    }

    /// @notice The user's vault-level kill switch overrides everything upstream.
    function test_revokedVault_blocksExecution() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(user);
        vault.revokeAutomation();

        vm.prank(keeper);
        vm.expectRevert();
        executor.execute(conditionId);

        assertEq(recipient.balance, 0, "funds moved after revocation");
    }

    function test_pausedVault_blocksExecution() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(user);
        vault.pause();

        vm.prank(keeper);
        vm.expectRevert(AutomationVault.VaultPaused.selector);
        executor.execute(conditionId);
    }

    function test_protocolCircuitBreaker_blocksExecution() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(admin);
        executor.pause();

        vm.prank(keeper);
        vm.expectRevert(AutomationExecutor.ExecutorPaused.selector);
        executor.execute(conditionId);
    }

    function test_onlyAdminCanPauseExecutor() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        executor.pause();
    }

    /*//////////////////////////////////////////////////////////////
                    REPEATED TRIGGER AND REPLAY (§37)
    //////////////////////////////////////////////////////////////*/

    /// @notice The property that stops a sinking balance draining the vault.
    function test_repeatedTrigger_doesNotDrainTheVault() public {
        vm.deal(sourceWallet, 4000e18);

        vm.prank(keeper);
        executor.execute(conditionId);
        uint256 afterFirst = address(vault).balance;

        // The keeper keeps polling. The balance is still below the threshold.
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(keeper);
            vm.expectRevert(
                abi.encodeWithSelector(
                    AutomationExecutor.ConditionNotExecutable.selector, conditionId
                )
            );
            executor.execute(conditionId);
        }

        assertEq(address(vault).balance, afterFirst, "vault drained by repeated polling");
        assertEq(recipient.balance, 999.5e18, "paid more than once");
        assertEq(executor.totalExecutions(), 1);
    }

    /// @notice Recovery re-arms, and the next dip fires a genuinely new trigger.
    function test_rearmThenFireAgain_usesAFreshExecutionId() public {
        vm.deal(sourceWallet, 4000e18);
        vm.prank(keeper);
        (bytes32 firstId,,) = executor.execute(conditionId);

        // Recover above the threshold.
        vm.deal(sourceWallet, 9000e18);
        executor.rearm(conditionId);

        // Dip again.
        vm.deal(sourceWallet, 4000e18);
        vm.prank(keeper);
        (bytes32 secondId,,) = executor.execute(conditionId);

        assertTrue(firstId != secondId, "execution id was reused across triggers");
        assertEq(recipient.balance, 999.5e18 * 2);
        assertEq(registry.getCondition(conditionId).triggerCount, 2);
    }

    function test_executionIdIsDeterministicAndUnique() public view {
        bytes32 a = executor.deriveExecutionId(conditionId, 1);
        bytes32 b = executor.deriveExecutionId(conditionId, 2);
        bytes32 c = executor.deriveExecutionId(conditionId + 1, 1);

        assertEq(a, executor.deriveExecutionId(conditionId, 1), "not deterministic");
        assertTrue(a != b, "collision across triggers");
        assertTrue(a != c, "collision across conditions");
    }

    /*//////////////////////////////////////////////////////////////
                             REENTRANCY (§37)
    //////////////////////////////////////////////////////////////*/

    /// @notice A recipient that calls back into `execute` while being paid must
    ///         not obtain a second payout.
    function test_reentrancy_recipientCannotReenterExecutor() public {
        // Predict the condition id the attacker's condition will receive.
        uint256 predictedId = registry.totalConditions() + 1;
        ReentrantRecipient malicious = new ReentrantRecipient(executor, predictedId);

        vm.prank(user);
        AutomationVault v = AutomationVault(
            payable(factory.createVault{value: 5000e18}(address(malicious), MAX_AMOUNT, address(0)))
        );

        address src = makeAddr("reentrancySource");
        vm.deal(src, 8000e18);

        vm.prank(user);
        (uint256 id,) = registry.createCondition(
            ConditionRegistry.CreateParams({
                kind: ConditionTypes.KIND_BALANCE_THRESHOLD,
                operator: ConditionTypes.OP_LT,
                params: "",
                actionKind: ConditionTypes.ACTION_TRANSFER_USDC,
                subject: src,
                threshold: THRESHOLD,
                rearmBuffer: 0,
                recurring: true,
                vault: address(v),
                recipient: address(malicious),
                amount: AMOUNT,
                maxAmount: MAX_AMOUNT
            })
        );
        assertEq(id, predictedId, "test setup: unexpected condition id");

        vm.deal(src, 4000e18);
        vm.prank(keeper);
        executor.execute(id);

        assertEq(malicious.reentryAttempts(), 1, "the attack was never attempted");
        assertTrue(malicious.reentryReverted(), "reentrancy was not blocked");
        assertEq(address(malicious).balance, 999.5e18, "attacker got paid twice");
        assertEq(registry.getCondition(id).triggerCount, 1);
        assertEq(executor.totalExecutions(), 1);
    }

    /*//////////////////////////////////////////////////////////////
                       INSUFFICIENT VAULT BALANCE (§37)
    //////////////////////////////////////////////////////////////*/

    function test_insufficientVaultBalance_failsWithoutLatchingForever() public {
        vm.prank(user);
        vault.withdrawAll(user); // owner pulls the funds out

        vm.deal(sourceWallet, 4000e18);

        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutomationVault.InsufficientVaultBalance.selector, AMOUNT, uint256(0)
            )
        );
        executor.execute(conditionId);

        // The whole transaction reverted, so the latch was rolled back too: the
        // condition is still armed and will fire once the vault is refunded.
        ConditionTypes.Condition memory c = registry.getCondition(conditionId);
        assertEq(c.triggerCount, 0, "a failed execution consumed the trigger");
        assertEq(uint8(c.arm), uint8(ConditionTypes.Arm.ARMED));
        assertTrue(registry.canExecute(conditionId));

        // Refund and it works.
        vm.prank(user);
        (bool ok,) = address(vault).call{value: 2000e18}("");
        assertTrue(ok);

        vm.prank(keeper);
        executor.execute(conditionId);
        assertEq(recipient.balance, 999.5e18);
    }

    /// @notice simulate() must flag the shortfall rather than let the keeper
    ///         burn gas on a doomed transaction.
    function test_simulate_detectsInsufficientBalance() public {
        vm.prank(user);
        vault.withdrawAll(user);
        vm.deal(sourceWallet, 4000e18);

        (bool executable,,,,, uint256 vaultBalance) = executor.simulate(conditionId);
        assertFalse(executable);
        assertEq(vaultBalance, 0);
    }

    function test_simulate_detectsRevokedAutomation() public {
        vm.deal(sourceWallet, 4000e18);
        vm.prank(user);
        vault.revokeAutomation();

        (bool executable,,,,,) = executor.simulate(conditionId);
        assertFalse(executable, "simulate missed a revoked vault");
    }

    /*//////////////////////////////////////////////////////////////
                                 FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @notice However the balance moves, the vault never pays out more than one
    ///         authorized amount per armed trigger.
    function testFuzz_neverPaysMoreThanOneAmountPerTrigger(uint256 balance, uint8 polls) public {
        balance = bound(balance, 0, THRESHOLD - 1);
        uint256 pollCount = bound(uint256(polls), 1, 20);

        vm.deal(sourceWallet, balance);

        for (uint256 i = 0; i < pollCount; i++) {
            vm.prank(keeper);
            try executor.execute(conditionId) {} catch {}
        }

        assertLe(recipient.balance, 999.5e18, "paid more than one authorized amount");
        assertLe(registry.getCondition(conditionId).triggerCount, 1);
    }
}
