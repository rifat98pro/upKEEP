// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AutomationVault} from "./AutomationVault.sol";
import {FeeMath} from "./libraries/FeeMath.sol";

/// @title AutomationVaultFactory
/// @notice Deploys one AutomationVault per user automation, and is the single
///         place the protocol's fee rate and treasury are read from.
///
/// @dev Admins can change the fee for *future* vaults only. Each vault copies
///      the rate into an immutable at construction, so a user's agreed fee can
///      never be changed after the fact. That is the entire reason this indirection
///      exists rather than vaults reading a live global.
contract AutomationVaultFactory is Ownable2Step {
    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Fee rate applied to vaults created from now on, in basis points.
    uint256 public feeBps;

    /// @notice Protocol fee destination for vaults created from now on.
    address public treasury;

    /// @notice Default executor suggested to new vaults.
    address public defaultExecutor;

    mapping(address owner => address[] vaults) private _vaultsOf;
    mapping(address vault => bool created) public isVault;
    address[] private _allVaults;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event VaultCreated(
        address indexed vault,
        address indexed owner,
        address indexed recipient,
        address executor,
        uint256 maxPerExecution,
        uint256 feeBps,
        uint256 initialDeposit
    );
    event FeeConfigUpdated(uint256 previousFeeBps, uint256 newFeeBps);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event DefaultExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error FeeRateTooHigh(uint256 feeBps, uint256 maxFeeBps);

    constructor(address admin, address treasury_, uint256 feeBps_, address defaultExecutor_)
        Ownable(admin)
    {
        if (admin == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (feeBps_ > FeeMath.MAX_CONFIGURABLE_FEE_BPS) {
            revert FeeRateTooHigh(feeBps_, FeeMath.MAX_CONFIGURABLE_FEE_BPS);
        }

        treasury = treasury_;
        feeBps = feeBps_;
        defaultExecutor = defaultExecutor_;
    }

    /*//////////////////////////////////////////////////////////////
                              VAULT CREATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Deploy a vault owned by the caller, optionally funding it.
    /// @param recipient The single approved destination for automated transfers.
    /// @param maxPerExecution Ceiling for one automated transfer, in native wei.
    /// @param executor Executor to authorize, or address(0) to use the default.
    /// @return vault The newly deployed vault.
    function createVault(address recipient, uint256 maxPerExecution, address executor)
        external
        payable
        returns (address vault)
    {
        return _create(recipient, maxPerExecution, 0, executor);
    }

    /// @notice Create a vault with a daily spending cap as well as a per-execution one.
    /// @dev The cap is part of the permission, not a condition: it needs no
    ///      keeper and is enforced in the same transaction that moves funds.
    /// @param maxPerDay Ceiling for all automated transfers in one UTC day.
    function createVault(
        address recipient,
        uint256 maxPerExecution,
        uint256 maxPerDay,
        address executor
    ) external payable returns (address vault) {
        return _create(recipient, maxPerExecution, maxPerDay, executor);
    }

    function _create(
        address recipient,
        uint256 maxPerExecution,
        uint256 maxPerDay,
        address executor
    ) private returns (address vault) {
        address chosenExecutor = executor == address(0) ? defaultExecutor : executor;

        AutomationVault deployed = new AutomationVault{value: msg.value}(
            msg.sender, chosenExecutor, recipient, maxPerExecution, maxPerDay, feeBps, treasury
        );

        vault = address(deployed);
        _vaultsOf[msg.sender].push(vault);
        _allVaults.push(vault);
        isVault[vault] = true;

        emit VaultCreated(
            vault, msg.sender, recipient, chosenExecutor, maxPerExecution, feeBps, msg.value
        );
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsOf[owner];
    }

    function vaultCountOf(address owner) external view returns (uint256) {
        return _vaultsOf[owner].length;
    }

    function totalVaults() external view returns (uint256) {
        return _allVaults.length;
    }

    /*//////////////////////////////////////////////////////////////
                             PROTOCOL ADMIN
    //////////////////////////////////////////////////////////////*/

    /// @notice Change the fee rate for vaults created after this call.
    /// @dev Existing vaults are unaffected; their rate is immutable.
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > FeeMath.MAX_CONFIGURABLE_FEE_BPS) {
            revert FeeRateTooHigh(newFeeBps, FeeMath.MAX_CONFIGURABLE_FEE_BPS);
        }
        emit FeeConfigUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setDefaultExecutor(address newExecutor) external onlyOwner {
        emit DefaultExecutorUpdated(defaultExecutor, newExecutor);
        defaultExecutor = newExecutor;
    }
}
