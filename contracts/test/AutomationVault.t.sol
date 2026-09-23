// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AutomationVault} from "../src/AutomationVault.sol";
import {FeeMath} from "../src/libraries/FeeMath.sol";
import {IAutomationVault} from "../src/interfaces/IAutomationVault.sol";
import {RejectingRecipient, VaultReentrantRecipient} from "./helpers/Mocks.sol";

/// @title AutomationVaultTest
/// @notice Proves the vault's spending surface is exactly as narrow as claimed.
contract AutomationVaultTest is Test {
    AutomationVault vault;

    address owner = makeAddr("owner");
    address executor = makeAddr("executor");
    address recipient = makeAddr("reserveWallet");
    address treasury = makeAddr("treasury");
    address attacker = makeAddr("attacker");

    uint256 constant FEE_BPS = 5;
    uint256 constant MAX_PER_EXECUTION = 1000e18; // $1,000
    uint256 constant FUNDING = 5000e18; // $5,000

    function setUp() public {
        vm.deal(owner, FUNDING * 2);
        vm.prank(owner);
        vault = new AutomationVault{value: FUNDING}(
            owner, executor, recipient, MAX_PER_EXECUTION, 0, FEE_BPS, treasury
        );
    }

    function _id(string memory s) private pure returns (bytes32) {
        return keccak256(bytes(s));
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    function test_construction_storesConfiguration() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.executor(), executor);
        assertEq(vault.recipient(), recipient);
        assertEq(vault.maxPerExecution(), MAX_PER_EXECUTION);
        assertEq(vault.feeBps(), FEE_BPS);
        assertEq(vault.treasury(), treasury);
        assertEq(vault.availableBalance(), FUNDING);
        assertFalse(vault.paused());
    }

    /// @dev Ownable's own constructor rejects the zero owner before our check is
    ///      reached, so this asserts OZ's error rather than ours. The outcome is
    ///      what matters: an ownerless vault cannot be deployed.
    function test_construction_revertsOnZeroOwner() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0))
        );
        new AutomationVault(address(0), executor, recipient, MAX_PER_EXECUTION, 0, FEE_BPS, treasury);
    }

    function test_construction_revertsOnZeroRecipient() public {
        vm.expectRevert(AutomationVault.ZeroAddress.selector);
        new AutomationVault(owner, executor, address(0), MAX_PER_EXECUTION, 0, FEE_BPS, treasury);
    }

    function test_construction_revertsOnZeroTreasury() public {
        vm.expectRevert(AutomationVault.ZeroAddress.selector);
        new AutomationVault(owner, executor, recipient, MAX_PER_EXECUTION, 0, FEE_BPS, address(0));
    }

    function test_construction_revertsOnZeroLimit() public {
        vm.expectRevert(AutomationVault.ZeroAmount.selector);
        new AutomationVault(owner, executor, recipient, 0, 0, FEE_BPS, treasury);
    }

    /// @notice A misconfigured deployment cannot charge an outrageous fee.
    function test_construction_revertsOnExcessiveFeeRate() public {
        uint256 tooHigh = FeeMath.MAX_CONFIGURABLE_FEE_BPS + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                AutomationVault.FeeRateTooHigh.selector, tooHigh, FeeMath.MAX_CONFIGURABLE_FEE_BPS
            )
        );
        new AutomationVault(owner, executor, recipient, MAX_PER_EXECUTION, 0, tooHigh, treasury);
    }

    /*//////////////////////////////////////////////////////////////
                        AUTHORIZATION (§37)
    //////////////////////////////////////////////////////////////*/

    function test_unauthorizedExecution_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AutomationVault.NotExecutor.selector, attacker));
        vault.executeTransfer(100e18, recipient, _id("a"));
    }

    /// @notice Even the vault owner cannot execute. Only the authorized executor can.
    function test_unauthorizedExecution_ownerCannotExecute() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AutomationVault.NotExecutor.selector, owner));
        vault.executeTransfer(100e18, recipient, _id("b"));
    }

    function test_unauthorizedRecipient_reverts() public {
        address wrong = makeAddr("attackerWallet");
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutomationVault.RecipientNotApproved.selector, wrong, recipient
            )
        );
        vault.executeTransfer(100e18, wrong, _id("c"));
    }

    function test_amountExceedingLimit_reverts() public {
        uint256 tooMuch = MAX_PER_EXECUTION + 1;
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutomationVault.AmountExceedsLimit.selector, tooMuch, MAX_PER_EXECUTION
            )
        );
        vault.executeTransfer(tooMuch, recipient, _id("d"));
    }

    function test_zeroAmount_reverts() public {
        vm.prank(executor);
        vm.expectRevert(AutomationVault.ZeroAmount.selector);
        vault.executeTransfer(0, recipient, _id("e"));
    }

    function test_insufficientVaultBalance_reverts() public {
        // Drain the vault, then try to execute a legal-sized transfer.
        vm.prank(owner);
        vault.withdrawAll(owner);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(AutomationVault.InsufficientVaultBalance.selector, 100e18, 0)
        );
        vault.executeTransfer(100e18, recipient, _id("f"));
    }

    /*//////////////////////////////////////////////////////////////
                         EMERGENCY CONTROLS (§37)
    //////////////////////////////////////////////////////////////*/

    function test_pausedVault_blocksExecution() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(executor);
        vm.expectRevert(AutomationVault.VaultPaused.selector);
        vault.executeTransfer(100e18, recipient, _id("g"));
    }

    function test_unpause_restoresExecution() public {
        vm.startPrank(owner);
        vault.pause();
        vault.unpause();
        vm.stopPrank();

        vm.prank(executor);
        vault.executeTransfer(100e18, recipient, _id("h"));
        assertEq(vault.executionCount(), 1);
    }

    /// @notice Revocation is the user's hard kill switch.
    function test_revokeAutomation_permanentlyDisarms() public {
        vm.prank(owner);
        vault.revokeAutomation();

        assertEq(vault.executor(), address(0));
        assertTrue(vault.paused());

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(AutomationVault.NotExecutor.selector, executor));
        vault.executeTransfer(100e18, recipient, _id("i"));
    }

    /// @notice Withdrawal must survive every emergency state, or funds could strand.
    function test_withdraw_worksWhilePausedAndRevoked() public {
        vm.startPrank(owner);
        vault.revokeAutomation();

        uint256 before = owner.balance;
        vault.withdrawAll(owner);
        vm.stopPrank();

        assertEq(vault.availableBalance(), 0);
        assertEq(owner.balance, before + FUNDING);
    }

    function test_unauthorizedPause_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vault.pause();
    }

    function test_unauthorizedWithdrawal_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vault.withdraw(1e18, attacker);
    }

    /// @notice The executor must not be able to widen its own permissions.
    function test_executorCannotChangeItsOwnPermissions() public {
        vm.startPrank(executor);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, executor));
        vault.setRecipient(attacker);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, executor));
        vault.setMaxPerExecution(type(uint256).max);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, executor));
        vault.withdraw(1e18, executor);

        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                           OWNER WITHDRAWAL (§37)
    //////////////////////////////////////////////////////////////*/

    function test_ownerWithdrawal_partial() public {
        uint256 before = owner.balance;
        vm.prank(owner);
        vault.withdraw(1000e18, owner);

        assertEq(owner.balance, before + 1000e18);
        assertEq(vault.availableBalance(), FUNDING - 1000e18);
    }

    function test_ownerWithdrawal_toZeroAddressReverts() public {
        vm.prank(owner);
        vm.expectRevert(AutomationVault.ZeroAddress.selector);
        vault.withdraw(1e18, address(0));
    }

    function test_ownerWithdrawal_zeroAmountReverts() public {
        vm.prank(owner);
        vm.expectRevert(AutomationVault.ZeroAmount.selector);
        vault.withdraw(0, owner);
    }

    function test_ownerWithdrawal_moreThanBalanceReverts() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutomationVault.InsufficientVaultBalance.selector, FUNDING + 1, FUNDING
            )
        );
        vault.withdraw(FUNDING + 1, owner);
    }

    /*//////////////////////////////////////////////////////////////
                          REPLAY PROTECTION (§37)
    //////////////////////////////////////////////////////////////*/

    function test_replay_sameExecutionIdReverts() public {
        bytes32 executionId = _id("trigger-1");

        vm.prank(executor);
        vault.executeTransfer(100e18, recipient, executionId);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(AutomationVault.ExecutionReplay.selector, executionId)
        );
        vault.executeTransfer(100e18, recipient, executionId);
    }

    function test_replay_distinctIdsAreIndependent() public {
        vm.startPrank(executor);
        vault.executeTransfer(100e18, recipient, _id("trigger-1"));
        vault.executeTransfer(100e18, recipient, _id("trigger-2"));
        vm.stopPrank();

        assertEq(vault.executionCount(), 2);
    }

    /*//////////////////////////////////////////////////////////////
                             REENTRANCY (§37)
    //////////////////////////////////////////////////////////////*/

    function test_reentrancy_recipientCannotReenterVault() public {
        VaultReentrantRecipient malicious = new VaultReentrantRecipient(IAutomationVault(address(0)));
        // Re-deploy the vault pointing at the malicious recipient.
        vm.prank(owner);
        AutomationVault v = new AutomationVault{value: FUNDING}(
            owner, executor, address(malicious), MAX_PER_EXECUTION, 0, FEE_BPS, treasury
        );
        VaultReentrantRecipient attackerContract = new VaultReentrantRecipient(IAutomationVault(address(v)));

        vm.prank(owner);
        v.setRecipient(address(attackerContract));

        vm.prank(executor);
        v.executeTransfer(100e18, address(attackerContract), _id("reentry"));

        assertEq(attackerContract.reentryAttempts(), 1, "the attack should have been attempted");
        assertTrue(attackerContract.reentryReverted(), "reentrancy was not blocked");
        assertEq(v.executionCount(), 1, "a reentrant execution slipped through");
    }

    /*//////////////////////////////////////////////////////////////
                         FEE CALCULATION (§37)
    //////////////////////////////////////////////////////////////*/

    function test_feeCalculation_onExecution() public {
        uint256 amount = 1000e18;
        vm.prank(executor);
        (uint256 net, uint256 fee) = vault.executeTransfer(amount, recipient, _id("fee"));

        assertEq(fee, 0.5e18, "$1,000 must cost exactly $0.50");
        assertEq(net, 999.5e18);
        assertEq(recipient.balance, 999.5e18, "recipient underpaid");
        assertEq(treasury.balance, 0.5e18, "treasury underpaid");
        assertEq(vault.availableBalance(), FUNDING - amount, "vault debited incorrectly");
        assertEq(vault.totalFeesPaid(), 0.5e18);
        assertEq(vault.totalExecutedGross(), amount);
    }

    /// @notice The micro-amount path used for the first Mainnet execution.
    function test_feeCalculation_microAmount() public {
        uint256 amount = 0.01e18; // $0.01
        vm.prank(executor);
        (uint256 net, uint256 fee) = vault.executeTransfer(amount, recipient, _id("micro"));

        assertEq(fee, 1e14, "1% cap applies at this size: $0.0001");
        assertEq(net, amount - fee);
        assertEq(recipient.balance, net);
        assertEq(treasury.balance, fee);
    }

    function test_previewMatchesExecution() public {
        uint256 amount = 777e18;
        (uint256 previewNet, uint256 previewFee) = vault.previewExecution(amount);

        vm.prank(executor);
        (uint256 net, uint256 fee) = vault.executeTransfer(amount, recipient, _id("preview"));

        assertEq(net, previewNet, "quoted net differed from settled net");
        assertEq(fee, previewFee, "quoted fee differed from settled fee");
    }

    /*//////////////////////////////////////////////////////////////
                               FAILURES
    //////////////////////////////////////////////////////////////*/

    /// @notice A refusing recipient must revert the whole execution, never
    ///         silently succeed and strand funds.
    function test_rejectingRecipient_revertsEntireExecution() public {
        RejectingRecipient rejecter = new RejectingRecipient();
        vm.prank(owner);
        vault.setRecipient(address(rejecter));

        vm.prank(executor);
        vm.expectRevert();
        vault.executeTransfer(100e18, address(rejecter), _id("reject"));

        assertEq(vault.availableBalance(), FUNDING, "funds moved despite failure");
        assertEq(vault.executionCount(), 0, "a failed execution was counted");
    }

    /*//////////////////////////////////////////////////////////////
                                FUNDING
    //////////////////////////////////////////////////////////////*/

    function test_receive_acceptsFunding() public {
        vm.deal(attacker, 10e18);
        vm.prank(attacker);
        (bool ok,) = address(vault).call{value: 10e18}("");
        assertTrue(ok);
        assertEq(vault.availableBalance(), FUNDING + 10e18);
    }

    function test_deposit_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(AutomationVault.ZeroAmount.selector);
        vault.deposit{value: 0}();
    }

    /*//////////////////////////////////////////////////////////////
                                 FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @notice Whatever the executor asks for, it can never move more than the
    ///         owner-authorized ceiling, and never to anywhere but the recipient.
    function testFuzz_executorIsBoundedByLimitAndRecipient(uint256 amount, address to) public {
        amount = bound(amount, 1, FUNDING);
        vm.assume(to != address(0));

        vm.prank(executor);
        if (to != recipient) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    AutomationVault.RecipientNotApproved.selector, to, recipient
                )
            );
            vault.executeTransfer(amount, to, _id("fuzz"));
            return;
        }

        if (amount > MAX_PER_EXECUTION) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    AutomationVault.AmountExceedsLimit.selector, amount, MAX_PER_EXECUTION
                )
            );
            vault.executeTransfer(amount, to, _id("fuzz"));
            return;
        }

        vault.executeTransfer(amount, to, _id("fuzz"));
        assertLe(FUNDING - vault.availableBalance(), MAX_PER_EXECUTION);
    }
}
