// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IAuthorizationProvider
/// @notice The authorization layer of the upKEEP engine.
///
/// @dev upKEEP separates four concerns on purpose:
///
///        Condition  - what financial state is being watched
///        Policy     - the rules bound to that condition (amount, recipient, security)
///        Authorization - how a caller proves it may act
///        Execution  - the transfer itself
///
///      This interface is the third layer. It exists so the condition engine is
///      not coupled to any one signature scheme. Today every deployment uses
///      the executor model, which inherits Arc's current ECDSA account
///      security. If and when a different authorization mechanism becomes
///      available - a post-quantum scheme, a smart account, a threshold signer -
///      it is added by deploying a provider and pointing a vault at it. The
///      condition, its threshold and its action are untouched.
///
///      A NOTE ON WHAT THIS IS NOT:
///
///      upKEEP does not implement cryptography and does not claim to provide
///      post-quantum security. A provider is a *policy hook*, not a cipher.
///      Whatever cryptographic guarantee exists comes from Arc, from the caller's
///      account, or from a precompile a provider delegates to - never from here.
///
///      Arc does expose a post-quantum primitive today: an SLH-DSA-SHA2-128s
///      verification precompile, live on Arc Mainnet at
///      0x1800000000000000000000000000000000000004 (verified responding). Arc's
///      published documentation does not yet specify its calldata encoding, so
///      upKEEP ships no provider that calls it. That provider is a future
///      addition, and this interface is what makes it an addition rather than a
///      rewrite.
///
///      SECURITY MODEL: a provider can only ever *restrict*.
///
///      The vault checks its own executor first and consults a provider only as
///      an additional condition. A provider therefore cannot widen access, and
///      the worst a broken or hostile provider can do is block the owner's own
///      automation - which the owner can clear by removing it. Withdrawal never
///      consults a provider, so funds can never be stranded behind one.
interface IAuthorizationProvider {
    /// @notice Everything a provider is allowed to make a decision from.
    /// @dev Passed as a struct so new fields can be added without changing every
    ///      implementation's signature.
    struct Request {
        /// @dev The vault asking. A provider may be shared across many vaults.
        address vault;
        /// @dev Who called the executor chain. Never trusted on its own.
        address caller;
        /// @dev Unique id for this trigger; usable as a signature nonce.
        bytes32 executionId;
        /// @dev Gross amount about to move, in 18-decimal native wei.
        uint256 amount;
        /// @dev The vault's one approved destination.
        address recipient;
        /// @dev Scheme-specific material, e.g. a signature. Empty for V1.
        bytes proof;
    }

    /// @notice Stable identifier for the authorization scheme.
    /// @dev A hash of a versioned name, e.g. keccak256("upkeep.auth.executor.v1"),
    ///      so schemes are comparable on-chain and legible off-chain.
    function schemeId() external view returns (bytes32);

    /// @notice Human-readable scheme name, surfaced in the SDK and UI.
    function label() external view returns (string memory);

    /// @notice Whether this request may proceed.
    /// @dev Called in addition to, never instead of, the vault's own executor
    ///      check. Must be a view: an authorization decision may not have side
    ///      effects, and staticcall guarantees it cannot re-enter.
    function isAuthorized(Request calldata request) external view returns (bool);

    /// @notice Whether holders of this scheme should migrate to a newer one.
    ///
    /// @dev The honest answer for every provider shipped today is `false`.
    ///      There is no on-chain signal on Arc that would justify returning
    ///      true, and upKEEP will not fabricate one. This exists so that a
    ///      future provider - one with an actual authoritative source - can
    ///      report it, and so vaults can already opt in to reacting when it
    ///      does. See AutomationVault.SecurityPolicy.pauseOnMigrationRequired.
    function migrationRequired() external view returns (bool);
}
