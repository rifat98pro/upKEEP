// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AutomationVault} from "../src/AutomationVault.sol";

/// @title DailyLimitTest
/// @notice The vault's daily spending cap.
///
/// @dev A spending limit is a *permission*, not a condition. It is enforced in
///      the same transaction that moves the money, so there is no keeper to
///      race, no window in which it is briefly untrue, and nothing to poll.
///      These tests exist to hold it to that standard.
///
///      The property that matters most is the last section: a cap constrains
///      automation and must never, under any configuration, prevent the owner
///      withdrawing their own funds. Everything else here is arithmetic.
contract DailyLimitTest is Test {
    AutomationVault vault;

    address owner = makeAddr("owner");
    address executor = makeAddr("executor");
    address recipient = makeAddr("reserveWallet");
    address treasury = makeAddr("treasury");

    uint256 constant FEE_BPS = 5;
    uint256 constant MAX_PER_EXECUTION = 100e18; // $100
    uint256 constant DAILY_CAP = 250e18; // $250
    uint256 constant FUNDING = 5000e18;

    function setUp() public {
        vm.deal(owner, FUNDING * 2);
        vm.prank(owner);
        vault = new AutomationVault{value: FUNDING}(
            owner, executor, recipient, MAX_PER_EXECUTION, DAILY_CAP, FEE_BPS, treasury
        );
        // Land mid-window so rollover tests are not accidentally at a boundary.
        vm.warp(1_700_000_000);
    }

    function _spend(uint256 amount, string memory id) internal {
        vm.prank(executor);
        vault.executeTransfer(amount, recipient, keccak256(bytes(id)));
    }

    /*//////////////////////////////////////////////////////////////
                             CONFIGURATION
    //////////////////////////////////////////////////////////////*/

    function test_capIsOptional() public {
        vm.prank(owner);
        AutomationVault uncapped = new AutomationVault{value: FUNDING}(
            owner, executor, recipient, MAX_PER_EXECUTION, 0, FEE_BPS, treasury
        );
        assertEq(uncapped.maxPerDay(), 0);
        // "Unlimited" reports as the maximum so callers need no special case.
        assertEq(uncapped.remainingToday(), type(uint256).max);
    }

    function test_construction_rejectsACapBelowThePerExecutionCeiling() public {
        // Otherwise the per-execution ceiling could never be reached, which
        // would make one of the two numbers a lie.
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutomationVault.DailyLimitExceeded.selector, MAX_PER_EXECUTION, MAX_PER_EXECUTION - 1
            )
        );
        new AutomationVault{value: FUNDING}(
            owner, executor, recipient, MAX_PER_EXECUTION, MAX_PER_EXECUTION - 1, FEE_BPS, treasury
        );
    }

    function test_setMaxPerDay_onlyOwner() public {
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, executor));
        vault.setMaxPerDay(1000e18);
    }

    function test_setMaxPerDay_rejectsACapBelowThePerExecutionCeiling() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutomationVault.DailyLimitExceeded.selector, MAX_PER_EXECUTION, MAX_PER_EXECUTION - 1
            )
        );
        vault.setMaxPerDay(MAX_PER_EXECUTION - 1);
    }

    function test_setMaxPerExecution_rejectsACeilingAboveTheCap() public {
        // The same consistency rule, enforced from the other side.
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutomationVault.DailyLimitExceeded.selector, DAILY_CAP + 1, DAILY_CAP
            )
        );
        vault.setMaxPerExecution(DAILY_CAP + 1);
    }

    function test_setMaxPerDay_zeroRemovesTheCap() public {
        vm.prank(owner);
        vault.setMaxPerDay(0);
        assertEq(vault.maxPerDay(), 0);
        assertEq(vault.remainingToday(), type(uint256).max);
    }

    /*//////////////////////////////////////////////////////////////
                             ENFORCEMENT
    //////////////////////////////////////////////////////////////*/

    function test_allowsSpendingUpToTheCap() public {
        _spend(100e18, "a");
        _spend(100e18, "b");
        _spend(50e18, "c");

        assertEq(vault.spentToday(), 250e18);
        assertEq(vault.remainingToday(), 0);
    }

    function test_blocksTheTransferThatWouldBreachTheCap() public {
        _spend(100e18, "a");
        _spend(100e18, "b");

        // $50 left, $100 requested.
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(AutomationVault.DailyLimitExceeded.selector, 100e18, 50e18)
        );
        vault.executeTransfer(100e18, recipient, keccak256("c"));
    }

    function test_reportsExactlyHowMuchRemains() public {
        assertEq(vault.remainingToday(), DAILY_CAP);
        _spend(60e18, "a");
        assertEq(vault.remainingToday(), DAILY_CAP - 60e18);
    }

    /// @dev The cap counts what leaves the vault, not what the recipient nets.
    ///      Counting net would let the fee slip past a cap on every execution.
    function test_countsGrossNotNet() public {
        _spend(100e18, "a");
        assertEq(vault.spentToday(), 100e18);

        // The recipient received less than 100 because of the fee, but the
        // vault parted with the full 100.
        assertLt(recipient.balance, 100e18);
        assertGt(treasury.balance, 0);
    }

    /*//////////////////////////////////////////////////////////////
                              ROLLOVER
    //////////////////////////////////////////////////////////////*/

    function test_resetsAtTheWindowBoundary() public {
        _spend(100e18, "a");
        _spend(100e18, "b");
        assertEq(vault.spentToday(), 200e18);

        vm.warp(vault.spendWindowResetsAt());

        // Reported as zero without any write having happened.
        assertEq(vault.spentToday(), 0);
        assertEq(vault.remainingToday(), DAILY_CAP);
    }

    function test_spendingResumesAfterRollover() public {
        _spend(100e18, "a");
        _spend(100e18, "b");
        _spend(50e18, "c");
        assertEq(vault.remainingToday(), 0);

        vm.warp(vault.spendWindowResetsAt());

        _spend(100e18, "d");
        assertEq(vault.spentToday(), 100e18);
    }

    function test_doesNotResetBeforeTheBoundary() public {
        _spend(100e18, "a1");
        _spend(100e18, "a2");
        vm.warp(vault.spendWindowResetsAt() - 1);
        assertEq(vault.spentToday(), 200e18);
    }

    function test_windowIsAnchoredToTheEpochNotToFirstSpend() public {
        // A rolling 24h window from first spend would still be counting here;
        // an epoch-anchored one has rolled over.
        uint256 resetAt = vault.spendWindowResetsAt();
        vm.warp(resetAt - 60);
        _spend(100e18, "late");
        assertEq(vault.spentToday(), 100e18);

        vm.warp(resetAt + 60);
        assertEq(vault.spentToday(), 0);
    }

    /*//////////////////////////////////////////////////////////////
                         TIGHTENING IS SAFE
    //////////////////////////////////////////////////////////////*/

    /// @dev Lowering the cap under what is already spent must not revert. It
    ///      simply means nothing more moves until the window rolls over.
    function test_loweringTheCapBelowTodaysSpendIsAllowed() public {
        _spend(100e18, "a");
        _spend(100e18, "b");

        vm.prank(owner);
        vault.setMaxPerDay(MAX_PER_EXECUTION); // 100, below the 200 already spent

        assertEq(vault.remainingToday(), 0);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(AutomationVault.DailyLimitExceeded.selector, 100e18, 0)
        );
        vault.executeTransfer(100e18, recipient, keccak256("c"));
    }

    /*//////////////////////////////////////////////////////////////
              THE INVARIANT: WITHDRAWAL IS NEVER BLOCKED
    //////////////////////////////////////////////////////////////*/

    /// @dev No configuration of this protocol may prevent an owner recovering
    ///      their own money. A spending cap constrains automation only.
    function test_withdrawalIgnoresTheCapEntirely() public {
        _spend(100e18, "a");
        _spend(100e18, "b");
        _spend(50e18, "c");
        assertEq(vault.remainingToday(), 0, "cap should be exhausted");

        uint256 before = owner.balance;
        uint256 vaultBalance = address(vault).balance;

        vm.prank(owner);
        vault.withdrawAll(owner);

        assertEq(owner.balance, before + vaultBalance);
        assertEq(address(vault).balance, 0);
    }

    function test_withdrawalIgnoresACapSmallerThanTheBalance() public {
        vm.prank(owner);
        vault.setMaxPerDay(MAX_PER_EXECUTION);

        uint256 before = owner.balance;
        vm.prank(owner);
        vault.withdraw(FUNDING, owner);

        assertEq(owner.balance, before + FUNDING);
    }

    /*//////////////////////////////////////////////////////////////
                                 FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @dev Across any sequence of transfers, spending within one window can
    ///      never exceed the cap. This is the whole promise of the feature.
    function testFuzz_neverExceedsTheCapWithinAWindow(uint96[8] memory amounts) public {
        uint256 executed;

        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 amount = bound(uint256(amounts[i]), 1, MAX_PER_EXECUTION);

            if (vault.spentToday() + amount > DAILY_CAP) {
                vm.prank(executor);
                vm.expectRevert();
                vault.executeTransfer(amount, recipient, keccak256(abi.encode(i)));
                continue;
            }

            vm.prank(executor);
            vault.executeTransfer(amount, recipient, keccak256(abi.encode(i)));
            executed += amount;
        }

        assertEq(vault.spentToday(), executed);
        assertLe(vault.spentToday(), DAILY_CAP, "a window may never exceed its cap");
    }
}
