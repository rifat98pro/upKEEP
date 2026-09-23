// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IAutomationVault
/// @notice The constrained spending surface upKEEP is granted over user funds.
interface IAutomationVault {
    /// @notice The user who funded and controls this vault.
    function owner() external view returns (address);

    /// @notice The only address allowed to trigger a transfer out of this vault.
    /// @dev Set and revocable by the owner alone. Zero means automation is off.
    function executor() external view returns (address);

    /// @notice The single destination automation may ever send funds to.
    function recipient() external view returns (address);

    /// @notice Hard ceiling on a single automated transfer, in native wei.
    function maxPerExecution() external view returns (uint256);

    /// @notice Owner's emergency stop. True halts all automated transfers.
    function paused() external view returns (bool);

    /// @notice Immutable protocol fee rate for this vault, in basis points.
    function feeBps() external view returns (uint256);

    /// @notice Native USDC held for automation, in 18-decimal wei.
    function availableBalance() external view returns (uint256);

    /// @notice Preview the recipient/fee split for an amount at this vault's rate.
    function previewExecution(uint256 amount)
        external
        view
        returns (uint256 netAmount, uint256 fee);

    /// @notice Release funds for a triggered condition.
    /// @dev Callable only by `executor`. Enforces recipient, ceiling, pause and
    ///      replay protection independently of whatever the caller claims.
    /// @param amount Gross amount to release, in 18-decimal native wei.
    /// @param to Destination; must equal `recipient()`.
    /// @param executionId Unique id for this trigger; replays revert.
    /// @return netAmount Amount delivered to `to`.
    /// @return fee Protocol fee taken.
    function executeTransfer(uint256 amount, address to, bytes32 executionId)
        external
        returns (uint256 netAmount, uint256 fee);
}
