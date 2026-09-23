// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAuthorizationProvider} from "../interfaces/IAuthorizationProvider.sol";

/// @title ExecutorAuthorizationProvider
/// @notice The authorization scheme every upKEEP deployment uses today.
///
/// @dev This provider describes, rather than adds to, the vault's built-in rule:
///      only the vault's authorized executor may move funds. Its security comes
///      from Arc's account model - currently ECDSA - not from anything here.
///
///      It exists for three reasons, none of which is cryptographic:
///
///        1. It names the current scheme, so "which authorization mechanism is
///           this vault using?" has an on-chain answer instead of being implicit.
///        2. It gives the UI and SDK something concrete to display and compare.
///        3. It proves the authorization layer is real by being a working
///           implementation of it, so a future scheme is a second implementation
///           rather than the first.
///
///      `isAuthorized` returns true unconditionally *on purpose*. That is not a
///      hole: the vault has already enforced `msg.sender == executor` before it
///      ever asks a provider, and a provider can only narrow that decision. This
///      one narrows nothing, which is exactly the current policy stated
///      explicitly rather than left unsaid.
contract ExecutorAuthorizationProvider is IAuthorizationProvider {
    /// @inheritdoc IAuthorizationProvider
    function schemeId() external pure override returns (bytes32) {
        return keccak256("upkeep.auth.executor.v1");
    }

    /// @inheritdoc IAuthorizationProvider
    function label() external pure override returns (string memory) {
        return "Executor authorization (Arc account security)";
    }

    /// @inheritdoc IAuthorizationProvider
    /// @dev Adds no constraint beyond the vault's own executor check.
    function isAuthorized(Request calldata) external pure override returns (bool) {
        return true;
    }

    /// @inheritdoc IAuthorizationProvider
    /// @dev Always false, and deliberately not configurable.
    ///
    ///      Arc exposes no on-chain signal that would let this contract know an
    ///      authorization migration had become necessary. Returning anything
    ///      other than false would be upKEEP asserting a security property it
    ///      cannot observe, which is the one thing this architecture is meant
    ///      not to do. A future provider with a real source can report it.
    function migrationRequired() external pure override returns (bool) {
        return false;
    }
}
