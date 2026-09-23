// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AutomationExecutor} from "../../src/AutomationExecutor.sol";
import {IAutomationVault} from "../../src/interfaces/IAutomationVault.sol";

/// @notice A recipient that tries to re-enter the executor while being paid.
/// @dev This is the adversary the checks-effects-interactions ordering, the
///      reentrancy guards and the FIRED latch all exist to defeat.
contract ReentrantRecipient {
    AutomationExecutor public immutable executor;
    uint256 public immutable conditionId;

    uint256 public reentryAttempts;
    bool public reentryReverted;
    bytes public lastRevertData;
    bool public attacking = true;

    constructor(AutomationExecutor executor_, uint256 conditionId_) {
        executor = executor_;
        conditionId = conditionId_;
    }

    function stopAttacking() external {
        attacking = false;
    }

    receive() external payable {
        if (!attacking) return;
        attacking = false; // one attempt per payout, so the test cannot loop forever
        reentryAttempts++;

        try executor.execute(conditionId) {
            reentryReverted = false;
        } catch (bytes memory reason) {
            reentryReverted = true;
            lastRevertData = reason;
        }
    }
}

/// @notice A recipient that tries to re-enter the *vault* directly.
contract VaultReentrantRecipient {
    IAutomationVault public immutable vault;
    uint256 public reentryAttempts;
    bool public reentryReverted;
    bool public attacking = true;

    constructor(IAutomationVault vault_) {
        vault = vault_;
    }

    receive() external payable {
        if (!attacking) return;
        attacking = false;
        reentryAttempts++;

        try vault.executeTransfer(1, address(this), keccak256("replay")) {
            reentryReverted = false;
        } catch {
            reentryReverted = true;
        }
    }
}

/// @notice A recipient that refuses payment, to prove failures surface loudly.
contract RejectingRecipient {
    receive() external payable {
        revert("I reject this payment");
    }
}

/// @notice A plain payable sink, standing in for a normal reserve wallet.
contract PayableSink {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}
