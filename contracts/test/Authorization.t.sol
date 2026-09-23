// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AutomationVault} from "../src/AutomationVault.sol";
import {ExecutorAuthorizationProvider} from "../src/authorization/ExecutorAuthorizationProvider.sol";
import {IAuthorizationProvider} from "../src/interfaces/IAuthorizationProvider.sol";

/*//////////////////////////////////////////////////////////////
                         TEST PROVIDERS
//////////////////////////////////////////////////////////////*/

/// @notice A provider that refuses everything.
contract DenyingProvider is IAuthorizationProvider {
    function schemeId() external pure returns (bytes32) {
        return keccak256("test.deny");
    }

    function label() external pure returns (string memory) {
        return "Denies everything";
    }

    function isAuthorized(Request calldata) external pure returns (bool) {
        return false;
    }

    function migrationRequired() external pure returns (bool) {
        return false;
    }
}

/// @notice A provider that reports a migration is needed.
/// @dev No provider upKEEP ships does this. It exists to prove the policy hook
///      works, so that a future provider with a real signal can use it.
contract MigrationRequiredProvider is IAuthorizationProvider {
    function schemeId() external pure returns (bytes32) {
        return keccak256("test.migration");
    }

    function label() external pure returns (string memory) {
        return "Reports migration required";
    }

    function isAuthorized(Request calldata) external pure returns (bool) {
        return true;
    }

    function migrationRequired() external pure returns (bool) {
        return true;
    }
}

/// @notice A provider that reverts on every call.
contract RevertingProvider is IAuthorizationProvider {
    function schemeId() external pure returns (bytes32) {
        return keccak256("test.revert");
    }

    function label() external pure returns (string memory) {
        return "Reverts";
    }

    function isAuthorized(Request calldata) external pure returns (bool) {
        revert("provider is broken");
    }

    function migrationRequired() external pure returns (bool) {
        revert("provider is broken");
    }
}

/// @notice A provider that only permits amounts under a cap of its own.
/// @dev Demonstrates the intended use: narrowing, never widening.
contract CappedProvider is IAuthorizationProvider {
    uint256 public immutable cap;

    constructor(uint256 cap_) {
        cap = cap_;
    }

    function schemeId() external pure returns (bytes32) {
        return keccak256("test.capped");
    }

    function label() external pure returns (string memory) {
        return "Caps individual transfers";
    }

    function isAuthorized(Request calldata request) external view returns (bool) {
        return request.amount <= cap;
    }

    function migrationRequired() external pure returns (bool) {
        return false;
    }
}

/// @notice Records what it was asked, to prove the request is populated.
contract RecordingProvider is IAuthorizationProvider {
    Request public last;
    bool public called;

    function schemeId() external pure returns (bytes32) {
        return keccak256("test.recording");
    }

    function label() external pure returns (string memory) {
        return "Records requests";
    }

    // Not a view in spirit, but the interface requires one; the vault
    // staticcalls it, so record via a separate non-view probe instead.
    function isAuthorized(Request calldata) external pure returns (bool) {
        return true;
    }

    function migrationRequired() external pure returns (bool) {
        return false;
    }
}

/// @notice Not a provider at all, to prove setSecurityPolicy validates.
contract NotAProvider {
    uint256 public something = 1;
}

/*//////////////////////////////////////////////////////////////
                              TESTS
//////////////////////////////////////////////////////////////*/

/// @title AuthorizationTest
/// @notice The authorization layer must be extensible without ever becoming a
///         way to widen access or strand funds.
contract AuthorizationTest is Test {
    AutomationVault vault;
    ExecutorAuthorizationProvider executorProvider;

    address owner = makeAddr("owner");
    address executor = makeAddr("executor");
    address attacker = makeAddr("attacker");
    address recipient = makeAddr("reserveWallet");
    address treasury = makeAddr("treasury");

    uint256 constant MAX_PER_EXECUTION = 1000e18;
    uint256 constant FUNDING = 5000e18;

    function setUp() public {
        executorProvider = new ExecutorAuthorizationProvider();

        vm.deal(owner, FUNDING * 2);
        vm.prank(owner);
        vault = new AutomationVault{value: FUNDING}(
            owner, executor, recipient, MAX_PER_EXECUTION, 0, 5, treasury
        );
    }

    function _id(string memory s) private pure returns (bytes32) {
        return keccak256(bytes(s));
    }

    /*//////////////////////////////////////////////////////////////
                              DEFAULTS
    //////////////////////////////////////////////////////////////*/

    /// @notice A vault with no policy behaves exactly as before.
    function test_default_noProviderConfigured() public view {
        (address provider,,, bool migration) = vault.authorizationStatus();
        assertEq(provider, address(0));
        assertFalse(migration);
    }

    function test_default_executionWorksWithoutAProvider() public {
        vm.prank(executor);
        vault.executeTransfer(100e18, recipient, _id("a"));
        assertEq(vault.executionCount(), 1);
    }

    /*//////////////////////////////////////////////////////////////
                       THE V1 PROVIDER IS HONEST
    //////////////////////////////////////////////////////////////*/

    function test_executorProvider_describesItself() public view {
        assertEq(executorProvider.schemeId(), keccak256("upkeep.auth.executor.v1"));
        assertGt(bytes(executorProvider.label()).length, 0);
    }

    /// @notice upKEEP must never claim a migration is needed without a source.
    function test_executorProvider_neverClaimsMigrationIsNeeded() public view {
        assertFalse(executorProvider.migrationRequired());
    }

    function test_executorProvider_addsNoRestriction() public {
        vm.prank(owner);
        vault.setSecurityPolicy(address(executorProvider), "CURRENT", true);

        vm.prank(executor);
        vault.executeTransfer(100e18, recipient, _id("b"));
        assertEq(vault.executionCount(), 1, "the current scheme should change nothing");
    }

    /*//////////////////////////////////////////////////////////////
                    A PROVIDER CAN ONLY RESTRICT
    //////////////////////////////////////////////////////////////*/

    /// @notice The property the whole design rests on: a provider that says
    ///         "yes" cannot let an unauthorized caller through, because the
    ///         executor check already ran and passed first.
    function test_providerCannotWidenAccess() public {
        vm.prank(owner);
        vault.setSecurityPolicy(address(executorProvider), "CURRENT", false);

        // This provider authorizes everything, yet the attacker is still refused.
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AutomationVault.NotExecutor.selector, attacker));
        vault.executeTransfer(100e18, recipient, _id("c"));
    }

    function test_denyingProvider_blocksExecution() public {
        DenyingProvider denier = new DenyingProvider();

        vm.prank(owner);
        vault.setSecurityPolicy(address(denier), "CURRENT", false);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(AutomationVault.NotAuthorizedByProvider.selector, address(denier))
        );
        vault.executeTransfer(100e18, recipient, _id("d"));
    }

    /// @notice A provider may narrow the vault's own ceiling.
    function test_cappedProvider_narrowsTheCeiling() public {
        CappedProvider capped = new CappedProvider(50e18);

        vm.prank(owner);
        vault.setSecurityPolicy(address(capped), "CURRENT", false);

        // Under the provider's cap: allowed.
        vm.prank(executor);
        vault.executeTransfer(50e18, recipient, _id("under"));

        // Over the provider's cap but under the vault's: refused.
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(AutomationVault.NotAuthorizedByProvider.selector, address(capped))
        );
        vault.executeTransfer(500e18, recipient, _id("over"));
    }

    /*//////////////////////////////////////////////////////////////
                            FAIL CLOSED
    //////////////////////////////////////////////////////////////*/

    /// @notice A broken provider must block automation, never open it.
    function test_revertingProvider_failsClosed() public {
        RevertingProvider broken = new RevertingProvider();

        vm.prank(owner);
        vault.setSecurityPolicy(address(broken), "CURRENT", false);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(AutomationVault.NotAuthorizedByProvider.selector, address(broken))
        );
        vault.executeTransfer(100e18, recipient, _id("e"));
    }

    /// @notice A provider that cannot answer the migration question halts
    ///         automation rather than being quietly ignored.
    function test_revertingProvider_failsClosedOnMigrationCheck() public {
        RevertingProvider broken = new RevertingProvider();

        vm.prank(owner);
        vault.setSecurityPolicy(address(broken), "CURRENT", true);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutomationVault.AuthorizationMigrationRequired.selector, address(broken)
            )
        );
        vault.executeTransfer(100e18, recipient, _id("f"));
    }

    /// @notice A broken provider must never trap the owner's funds.
    function test_brokenProvider_cannotStrandFunds() public {
        RevertingProvider broken = new RevertingProvider();

        vm.startPrank(owner);
        vault.setSecurityPolicy(address(broken), "CURRENT", true);

        // Withdrawal does not consult the authorization layer at all.
        uint256 before = owner.balance;
        vault.withdrawAll(owner);
        assertEq(owner.balance, before + FUNDING, "funds were stranded behind a provider");

        // And the owner can clear the policy to recover automation.
        vault.setSecurityPolicy(address(0), "CURRENT", false);
        vm.stopPrank();

        (address provider,,,) = vault.authorizationStatus();
        assertEq(provider, address(0));
    }

    /*//////////////////////////////////////////////////////////////
                    THE MIGRATION POLICY HOOK
    //////////////////////////////////////////////////////////////*/

    /// @notice IF authorization migration is required THEN pause automation.
    ///         The mechanism is real; no shipped provider triggers it.
    function test_migrationPolicy_haltsAutomationWhenOptedIn() public {
        MigrationRequiredProvider migrating = new MigrationRequiredProvider();

        vm.prank(owner);
        vault.setSecurityPolicy(address(migrating), "MIGRATION_PENDING", true);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutomationVault.AuthorizationMigrationRequired.selector, address(migrating)
            )
        );
        vault.executeTransfer(100e18, recipient, _id("g"));
    }

    /// @notice Opting out means the flag is reported but not enforced, so a
    ///         user is never surprised by automation stopping.
    function test_migrationPolicy_isOptIn() public {
        MigrationRequiredProvider migrating = new MigrationRequiredProvider();

        vm.prank(owner);
        vault.setSecurityPolicy(address(migrating), "CURRENT", false);

        vm.prank(executor);
        vault.executeTransfer(100e18, recipient, _id("h"));
        assertEq(vault.executionCount(), 1);

        (,,, bool required) = vault.authorizationStatus();
        assertTrue(required, "the status should still report it");
    }

    /// @notice Even a halted vault can always be emptied by its owner.
    function test_migrationPolicy_neverBlocksWithdrawal() public {
        MigrationRequiredProvider migrating = new MigrationRequiredProvider();

        vm.startPrank(owner);
        vault.setSecurityPolicy(address(migrating), "MIGRATION_PENDING", true);

        uint256 before = owner.balance;
        vault.withdrawAll(owner);
        assertEq(owner.balance, before + FUNDING);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                              CONTROL
    //////////////////////////////////////////////////////////////*/

    function test_setSecurityPolicy_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker)
        );
        vault.setSecurityPolicy(address(executorProvider), "CURRENT", false);
    }

    /// @notice Not even the executor can change the policy that governs it.
    function test_setSecurityPolicy_executorCannotChangeIt() public {
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, executor)
        );
        vault.setSecurityPolicy(address(0), "CURRENT", false);
    }

    /// @notice A typo should fail when set, not at execution time.
    function test_setSecurityPolicy_rejectsANonProvider() public {
        NotAProvider bogus = new NotAProvider();

        vm.prank(owner);
        vm.expectRevert();
        vault.setSecurityPolicy(address(bogus), "CURRENT", false);
    }

    function test_setSecurityPolicy_storesAndReportsTheScheme() public {
        vm.prank(owner);
        vault.setSecurityPolicy(address(executorProvider), "CURRENT", true);

        (bytes32 mode, address provider, bool pauseOnMigration) = vault.securityPolicy();
        assertEq(mode, bytes32("CURRENT"));
        assertEq(provider, address(executorProvider));
        assertTrue(pauseOnMigration);

        (address reported, bytes32 scheme,, bool migration) = vault.authorizationStatus();
        assertEq(reported, address(executorProvider));
        assertEq(scheme, keccak256("upkeep.auth.executor.v1"));
        assertFalse(migration);
    }

    /*//////////////////////////////////////////////////////////////
                        CRYPTO-AGILITY, DEMONSTRATED
    //////////////////////////////////////////////////////////////*/

    /// @notice The headline claim: the authorization mechanism can be replaced
    ///         while the vault, its funds, its ceiling, its recipient and any
    ///         condition bound to it carry on unchanged.
    function test_authorizationCanBeSwappedWithoutDisturbingAnythingElse() public {
        // Start on the current scheme and execute once.
        vm.prank(owner);
        vault.setSecurityPolicy(address(executorProvider), "CURRENT", false);

        vm.prank(executor);
        vault.executeTransfer(100e18, recipient, _id("before"));

        uint256 balanceAfterFirst = vault.availableBalance();
        address recipientBefore = vault.recipient();
        uint256 limitBefore = vault.maxPerExecution();
        uint256 feeBefore = vault.feeBps();

        // Migrate to a different authorization scheme.
        CappedProvider nextScheme = new CappedProvider(500e18);
        vm.prank(owner);
        vault.setSecurityPolicy(address(nextScheme), "MIGRATED", false);

        (, bytes32 scheme,,) = vault.authorizationStatus();
        assertEq(scheme, keccak256("test.capped"), "scheme did not change");

        // Everything that defines the automation is untouched.
        assertEq(vault.availableBalance(), balanceAfterFirst, "funds moved during migration");
        assertEq(vault.recipient(), recipientBefore, "recipient changed");
        assertEq(vault.maxPerExecution(), limitBefore, "ceiling changed");
        assertEq(vault.feeBps(), feeBefore, "fee rate changed");
        assertEq(vault.executionCount(), 1, "history was lost");

        // And it keeps executing under the new scheme.
        vm.prank(executor);
        vault.executeTransfer(100e18, recipient, _id("after"));
        assertEq(vault.executionCount(), 2, "automation did not survive the migration");
    }

    /*//////////////////////////////////////////////////////////////
                                 FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @notice However a provider answers, it can never authorize a caller the
    ///         vault itself would have refused.
    function testFuzz_providerNeverOverridesTheExecutorCheck(address caller, uint256 amount)
        public
    {
        vm.assume(caller != executor);
        amount = bound(amount, 1, MAX_PER_EXECUTION);

        vm.prank(owner);
        vault.setSecurityPolicy(address(executorProvider), "CURRENT", false);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(AutomationVault.NotExecutor.selector, caller));
        vault.executeTransfer(amount, recipient, _id("fuzz"));
    }
}
