// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FeeMath} from "./libraries/FeeMath.sol";
import {IAutomationVault} from "./interfaces/IAutomationVault.sol";
import {IAuthorizationProvider} from "./interfaces/IAuthorizationProvider.sol";

/// @title AutomationVault
/// @notice Holds only the USDC a user explicitly set aside for automation, and
///         exposes a deliberately tiny spending surface over it.
///
/// @dev The security model in one paragraph:
///
///      upKEEP never takes custody of a private key and never receives an
///      unlimited approval. Instead the user deploys this vault, funds it with
///      the amount they are willing to automate, and names exactly one
///      destination and one per-execution ceiling. From that point the executor
///      can do precisely one thing: move at most `maxPerExecution` to exactly
///      `recipient`. It cannot change either, cannot withdraw, cannot reach
///      funds outside this vault, and cannot act at all once the owner pauses or
///      revokes. Worst case, a fully compromised executor, is bounded by
///      `maxPerExecution` per armed trigger, sent to an address the user chose.
///
///      Funds are native USDC. On Arc, USDC is the gas token (18 decimals), so
///      value arrives via `receive()` and leaves via `call{value:}`. Every amount
///      here is 18-decimal native wei.
///      https://docs.arc.io/arc/references/evm-differences
contract AutomationVault is IAutomationVault, Ownable2Step, ReentrancyGuard {
    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IAutomationVault
    address public override executor;

    /// @inheritdoc IAutomationVault
    address public override recipient;

    /// @inheritdoc IAutomationVault
    uint256 public override maxPerExecution;

    /// @inheritdoc IAutomationVault
    bool public override paused;

    /// @notice Protocol fee rate, fixed for the life of this vault.
    /// @dev Immutable on purpose: the fee a user agreed to at creation can never
    ///      be raised on them afterwards, by anyone, including protocol admins.
    uint256 public immutable override feeBps;

    /// @notice Destination for protocol fees. Immutable, for the same reason.
    address public immutable treasury;

    /// @notice Replay guard. Each trigger's execution id may be spent once.
    mapping(bytes32 executionId => bool spent) public executed;

    /*//////////////////////////////////////////////////////////////
                            SECURITY POLICY
    //////////////////////////////////////////////////////////////*/

    /// @notice How this vault authorizes automated transfers.
    ///
    /// @dev The policy layer between the condition and execution. It is
    ///      deliberately an *extensibility* surface rather than an enforcement
    ///      mechanism upKEEP invented: the only thing it can do today is add a
    ///      restriction, and the only provider that ships reports no migration
    ///      need because Arc exposes no signal that would justify one.
    struct SecurityPolicy {
        /// @dev Free-form mode tag, e.g. "CURRENT". Metadata for callers.
        bytes32 authorizationMode;
        /// @dev Optional IAuthorizationProvider. Zero means the built-in
        ///      executor check alone, which is the default.
        address provider;
        /// @dev When true, a provider reporting `migrationRequired()` halts
        ///      automated transfers. Withdrawal is never affected.
        bool pauseOnMigrationRequired;
    }

    /// @notice This vault's authorization policy.
    SecurityPolicy public securityPolicy;

    uint256 public totalExecutedGross;
    uint256 public totalFeesPaid;
    uint32 public executionCount;

    /*//////////////////////////////////////////////////////////////
                             DAILY LIMIT
    //////////////////////////////////////////////////////////////*/

    /// @notice Length of the spending window. Fixed at one day.
    /// @dev Windows are anchored to the Unix epoch, so a "day" is midnight UTC
    ///      to midnight UTC rather than a rolling 24 hours from first spend.
    ///      A fixed anchor keeps the accounting O(1): one counter and one index,
    ///      with no list of past transfers to walk or to pay storage for.
    uint64 public constant SPEND_WINDOW = 1 days;

    /// @notice Most that automation may move from this vault per window.
    /// @dev Zero means no daily cap - `maxPerExecution` still applies. This is
    ///      a *limit*, not a condition: it needs no keeper, cannot be raced, and
    ///      is enforced in the same transaction that moves the money.
    uint256 public maxPerDay;

    /// @dev `block.timestamp / SPEND_WINDOW` when `_spentInWindow` was written.
    uint64 private _spendWindowIndex;
    uint256 private _spentInWindow;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event MaxPerDayUpdated(uint256 previous, uint256 current);

    event Deposited(address indexed from, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed to, uint256 amount, uint256 newBalance);
    event AutomationExecuted(
        bytes32 indexed executionId,
        address indexed to,
        uint256 grossAmount,
        uint256 netAmount,
        uint256 fee
    );
    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);
    event RecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event MaxPerExecutionUpdated(uint256 previousMax, uint256 newMax);
    event PausedSet(bool paused);
    event AutomationRevoked(address indexed by);
    event SecurityPolicyUpdated(
        bytes32 authorizationMode,
        address indexed provider,
        bytes32 indexed schemeId,
        bool pauseOnMigrationRequired
    );

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotExecutor(address caller);
    error VaultPaused();
    error RecipientNotApproved(address attempted, address approved);
    error AmountExceedsLimit(uint256 amount, uint256 limit);

    /// @notice This transfer would breach the vault's daily spending cap.
    error DailyLimitExceeded(uint256 requested, uint256 remaining);
    error InsufficientVaultBalance(uint256 requested, uint256 available);
    error ExecutionReplay(bytes32 executionId);
    error ZeroAddress();
    error ZeroAmount();
    error FeeRateTooHigh(uint256 feeBps, uint256 maxFeeBps);
    error TransferFailed(address to, uint256 amount);
    error NotAuthorizedByProvider(address provider);
    error AuthorizationMigrationRequired(address provider);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    /// @param owner_ The user. Sole controller of funds and permissions.
    /// @param executor_ Authorized executor, or address(0) to start disarmed.
    /// @param recipient_ The one approved destination for automated transfers.
    /// @param maxPerExecution_ Ceiling for a single automated transfer, native wei.
    /// @param maxPerDay_ Ceiling for all automated transfers in one day, or 0 for none.
    /// @param feeBps_ Protocol fee rate, fixed forever for this vault.
    /// @param treasury_ Protocol fee destination, fixed forever for this vault.
    constructor(
        address owner_,
        address executor_,
        address recipient_,
        uint256 maxPerExecution_,
        uint256 maxPerDay_,
        uint256 feeBps_,
        address treasury_
    ) payable Ownable(owner_) {
        if (owner_ == address(0) || recipient_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        if (maxPerExecution_ == 0) revert ZeroAmount();
        if (feeBps_ > FeeMath.MAX_CONFIGURABLE_FEE_BPS) {
            revert FeeRateTooHigh(feeBps_, FeeMath.MAX_CONFIGURABLE_FEE_BPS);
        }

        /*
         * A daily cap below the per-execution ceiling would make the ceiling a
         * lie: the first transfer could never reach it. Reject rather than
         * silently letting one number override the other.
         */
        if (maxPerDay_ != 0 && maxPerDay_ < maxPerExecution_) {
            revert DailyLimitExceeded(maxPerExecution_, maxPerDay_);
        }

        executor = executor_;
        recipient = recipient_;
        maxPerExecution = maxPerExecution_;
        maxPerDay = maxPerDay_;
        feeBps = feeBps_;
        treasury = treasury_;

        if (msg.value > 0) emit Deposited(msg.sender, msg.value, address(this).balance);
    }

    /*//////////////////////////////////////////////////////////////
                                FUNDING
    //////////////////////////////////////////////////////////////*/

    /// @notice Fund the vault with native USDC.
    receive() external payable {
        emit Deposited(msg.sender, msg.value, address(this).balance);
    }

    /// @notice Explicit funding entrypoint, for callers that prefer a named function.
    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        emit Deposited(msg.sender, msg.value, address(this).balance);
    }

    /*//////////////////////////////////////////////////////////////
                              AUTOMATION
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IAutomationVault
    /// @dev Checks-effects-interactions, plus a reentrancy guard, plus a spent
    ///      executionId. A recipient that calls back in during the payout hits
    ///      all three.
    function executeTransfer(uint256 amount, address to, bytes32 executionId)
        external
        override
        nonReentrant
        returns (uint256 netAmount, uint256 fee)
    {
        // ---- checks ----
        address currentExecutor = executor;
        if (currentExecutor == address(0) || msg.sender != currentExecutor) {
            revert NotExecutor(msg.sender);
        }
        if (paused) revert VaultPaused();

        address approved = recipient;
        if (to != approved) revert RecipientNotApproved(to, approved);
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 limit = maxPerExecution;
        if (amount > limit) revert AmountExceedsLimit(amount, limit);

        /*
         * The daily cap counts the GROSS amount - what actually leaves the
         * vault - not what the recipient nets after the fee. A cap the fee
         * could slip past would not be a cap.
         */
        uint256 dailyCap = maxPerDay;
        uint64 windowIndex = uint64(block.timestamp / SPEND_WINDOW);
        uint256 spentSoFar = windowIndex == _spendWindowIndex ? _spentInWindow : 0;

        if (dailyCap != 0 && spentSoFar + amount > dailyCap) {
            /*
             * Guard the subtraction. The owner may lower the cap below what has
             * already been spent today, which is a legitimate way to tighten a
             * vault mid-window - but it makes `spentSoFar > dailyCap`, and an
             * unguarded `dailyCap - spentSoFar` would panic instead of
             * reporting plainly that nothing more may move.
             */
            uint256 remaining = spentSoFar >= dailyCap ? 0 : dailyCap - spentSoFar;
            revert DailyLimitExceeded(amount, remaining);
        }

        if (executed[executionId]) revert ExecutionReplay(executionId);

        uint256 available = address(this).balance;
        if (available < amount) revert InsufficientVaultBalance(amount, available);

        // The authorization layer runs last, after every built-in rule has
        // already passed. It can only narrow the decision reached above.
        _checkAuthorizationPolicy(amount, to, executionId);

        // ---- effects ----
        executed[executionId] = true;
        (netAmount, fee) = FeeMath.split(amount, feeBps);

        unchecked {
            // Bounded by the vault balance, which cannot overflow uint256.
            totalExecutedGross += amount;
            totalFeesPaid += fee;
            ++executionCount;
        }

        /*
         * Written whether or not a cap is set, so turning one on later has an
         * accurate figure to work from rather than starting the day blind.
         */
        _spendWindowIndex = windowIndex;
        _spentInWindow = spentSoFar + amount;

        emit AutomationExecuted(executionId, to, amount, netAmount, fee);

        // ---- interactions ----
        _send(to, netAmount);
        if (fee > 0) _send(treasury, fee);
    }

    /*//////////////////////////////////////////////////////////////
                             OWNER CONTROLS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emergency stop. Automated transfers revert; withdrawal still works.
    function pause() external onlyOwner {
        paused = true;
        emit PausedSet(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PausedSet(false);
    }

    /// @notice Hard kill switch: disarms the executor and pauses.
    /// @dev After this, no automated transfer can succeed under any condition
    ///      until the owner explicitly re-authorizes an executor.
    function revokeAutomation() external onlyOwner {
        emit ExecutorUpdated(executor, address(0));
        executor = address(0);
        paused = true;
        emit PausedSet(true);
        emit AutomationRevoked(msg.sender);
    }

    function setExecutor(address newExecutor) external onlyOwner {
        emit ExecutorUpdated(executor, newExecutor);
        executor = newExecutor;
    }

    function setRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit RecipientUpdated(recipient, newRecipient);
        recipient = newRecipient;
    }

    function setMaxPerExecution(uint256 newMax) external onlyOwner {
        if (newMax == 0) revert ZeroAmount();
        if (maxPerDay != 0 && newMax > maxPerDay) {
            revert DailyLimitExceeded(newMax, maxPerDay);
        }
        emit MaxPerExecutionUpdated(maxPerExecution, newMax);
        maxPerExecution = newMax;
    }

    /// @notice Set or clear the daily spending cap. Zero removes it.
    ///
    /// @dev Only the owner, and deliberately only downward-safe in one respect:
    ///      lowering the cap below what has already been spent today simply
    ///      means nothing more moves until tomorrow, rather than reverting. The
    ///      cap constrains automation and never withdrawal, so tightening it can
    ///      strand nothing.
    function setMaxPerDay(uint256 newMax) external onlyOwner {
        // A cap under the per-execution ceiling would make that ceiling
        // unreachable. Keep the two consistent in both directions.
        if (newMax != 0 && newMax < maxPerExecution) {
            revert DailyLimitExceeded(maxPerExecution, newMax);
        }
        emit MaxPerDayUpdated(maxPerDay, newMax);
        maxPerDay = newMax;
    }

    /*//////////////////////////////////////////////////////////////
                           SPENDING VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Gross USDC automation has moved in the current window.
    /// @dev Reports zero once the window rolls over, without needing a write.
    function spentToday() public view returns (uint256) {
        return uint64(block.timestamp / SPEND_WINDOW) == _spendWindowIndex ? _spentInWindow : 0;
    }

    /// @notice How much automation may still move today.
    /// @dev `type(uint256).max` when no cap is set, so callers can compare
    ///      against it without special-casing "unlimited".
    function remainingToday() external view returns (uint256) {
        uint256 cap = maxPerDay;
        if (cap == 0) return type(uint256).max;
        uint256 spent = spentToday();
        return spent >= cap ? 0 : cap - spent;
    }

    /// @notice When the current spending window rolls over, as a Unix timestamp.
    function spendWindowResetsAt() external view returns (uint256) {
        return ((block.timestamp / SPEND_WINDOW) + 1) * SPEND_WINDOW;
    }

    /// @notice Replace this vault's authorization policy.
    ///
    /// @dev This is the migration path, and the reason the condition engine is
    ///      not coupled to a signature scheme. Changing how automation is
    ///      authorized - a new provider, a new executor, a stricter policy -
    ///      touches only this vault. The condition, its threshold, its action,
    ///      its history and its id are all unaffected and keep running.
    ///
    ///      Owner-only, like every other control here. The protocol cannot
    ///      change a user's authorization policy.
    ///
    /// @param provider An IAuthorizationProvider, or address(0) for the
    ///        built-in executor check alone.
    /// @param authorizationMode Free-form tag for callers, e.g. "CURRENT".
    /// @param pauseOnMigrationRequired Halt automated transfers when the
    ///        provider reports a migration is needed. Withdrawal is unaffected.
    function setSecurityPolicy(
        address provider,
        bytes32 authorizationMode,
        bool pauseOnMigrationRequired
    ) external onlyOwner {
        bytes32 scheme;

        if (provider != address(0)) {
            // Confirm the address really is a provider before trusting the
            // policy, so a typo fails here rather than at execution time.
            scheme = IAuthorizationProvider(provider).schemeId();
        }

        securityPolicy = SecurityPolicy({
            authorizationMode: authorizationMode,
            provider: provider,
            pauseOnMigrationRequired: pauseOnMigrationRequired
        });

        emit SecurityPolicyUpdated(authorizationMode, provider, scheme, pauseOnMigrationRequired);
    }

    /// @notice Withdraw funds. Always available to the owner, even while paused.
    function withdraw(uint256 amount, address to) public onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 available = address(this).balance;
        if (available < amount) revert InsufficientVaultBalance(amount, available);

        emit Withdrawn(to, amount, available - amount);
        _send(to, amount);
    }

    /// @notice Withdraw the entire vault balance.
    function withdrawAll(address to) external {
        withdraw(address(this).balance, to);
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IAutomationVault
    /// @dev Disambiguates the identical declarations in Ownable and the interface.
    function owner() public view virtual override(Ownable, IAutomationVault) returns (address) {
        return Ownable.owner();
    }

    /// @notice Native USDC held for automation, in 18-decimal wei.
    function availableBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Preview the split for an amount, using this vault's fixed rate.
    function previewExecution(uint256 amount)
        external
        view
        returns (uint256 netAmount, uint256 fee)
    {
        return FeeMath.split(amount, feeBps);
    }

    /// @notice True when an automated transfer of `amount` would succeed right now.
    function canExecuteAmount(uint256 amount) external view returns (bool) {
        return executor != address(0) && !paused && amount > 0 && amount <= maxPerExecution
            && address(this).balance >= amount;
    }

    /// @notice The authorization scheme in force, for display and comparison.
    /// @return provider The configured provider, or address(0) for the built-in check.
    /// @return scheme The provider's scheme id, or bytes32(0).
    /// @return schemeLabel Human-readable name of the scheme.
    /// @return migrationRequired What the provider reports. False for every
    ///         provider shipped today - Arc exposes no signal that would make
    ///         any other answer honest.
    function authorizationStatus()
        external
        view
        returns (
            address provider,
            bytes32 scheme,
            string memory schemeLabel,
            bool migrationRequired
        )
    {
        provider = securityPolicy.provider;

        if (provider == address(0)) {
            return (address(0), bytes32(0), "Executor authorization (built-in)", false);
        }

        IAuthorizationProvider p = IAuthorizationProvider(provider);

        // Views, so a broken provider degrades to "unknown" rather than making
        // this whole function unreadable.
        try p.schemeId() returns (bytes32 id) {
            scheme = id;
        } catch {}
        try p.label() returns (string memory name) {
            schemeLabel = name;
        } catch {
            schemeLabel = "Unknown provider";
        }
        try p.migrationRequired() returns (bool required) {
            migrationRequired = required;
        } catch {
            migrationRequired = false;
        }
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed(to, amount);
    }

    /// @dev Consult the configured authorization provider, if any.
    ///
    ///      Three properties matter here:
    ///
    ///      1. **It can only restrict.** This runs after `msg.sender == executor`
    ///         and every amount, recipient and balance check. A provider that
    ///         returns true changes nothing; only a false blocks.
    ///      2. **It fails closed.** A provider that reverts, runs out of gas or
    ///         returns malformed data is treated as a refusal rather than a
    ///         pass, so a broken provider cannot become an open door.
    ///      3. **It cannot strand funds.** Withdrawal never calls this, so the
    ///         owner can always exit and clear a misbehaving provider.
    function _checkAuthorizationPolicy(uint256 amount, address to, bytes32 executionId)
        private
        view
    {
        SecurityPolicy memory policy = securityPolicy;
        if (policy.provider == address(0)) return;

        IAuthorizationProvider provider = IAuthorizationProvider(policy.provider);

        if (policy.pauseOnMigrationRequired) {
            // A provider that cannot answer is treated as "migration required",
            // which halts automation rather than quietly ignoring the policy.
            try provider.migrationRequired() returns (bool required) {
                if (required) revert AuthorizationMigrationRequired(policy.provider);
            } catch {
                revert AuthorizationMigrationRequired(policy.provider);
            }
        }

        IAuthorizationProvider.Request memory request = IAuthorizationProvider.Request({
            vault: address(this),
            caller: msg.sender,
            executionId: executionId,
            amount: amount,
            recipient: to,
            proof: ""
        });

        try provider.isAuthorized(request) returns (bool allowed) {
            if (!allowed) revert NotAuthorizedByProvider(policy.provider);
        } catch {
            revert NotAuthorizedByProvider(policy.provider);
        }
    }
}
