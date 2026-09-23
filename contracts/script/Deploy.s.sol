// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ConditionRegistry} from "../src/ConditionRegistry.sol";
import {AutomationExecutor} from "../src/AutomationExecutor.sol";
import {AutomationVaultFactory} from "../src/AutomationVaultFactory.sol";
import {BalanceThresholdEvaluator} from "../src/evaluators/BalanceThresholdEvaluator.sol";
import {ExecutorAuthorizationProvider} from "../src/authorization/ExecutorAuthorizationProvider.sol";
import {FeeMath} from "../src/libraries/FeeMath.sol";

/// @title Deploy
/// @notice Deploys the upKEEP protocol to Arc.
///
/// @dev Run against Arc Mainnet with:
///
///        forge script script/Deploy.s.sol:Deploy \
///          --rpc-url $ARC_RPC_URL \
///          --broadcast \
///          --private-key $DEPLOYER_PRIVATE_KEY
///
///      Arc's mempool silently drops transactions whose maxFeePerGas is under
///      20 Gwei - no receipt, no error, the transaction simply never appears.
///      If a broadcast seems to hang, that is the first thing to check.
///      https://docs.arc.io/arc/references/gas-and-fees
contract Deploy is Script {
    /// @notice Arc Mainnet, per https://docs.arc.io/arc/references/connect-to-arc
    uint256 constant ARC_MAINNET_CHAIN_ID = 5042;

    function run() external {
        // ---- configuration ----
        address admin = vm.envOr("UPKEEP_ADMIN", address(0));
        address treasury = vm.envAddress("UPKEEP_TREASURY");
        address keeper = vm.envOr("UPKEEP_KEEPER", address(0));
        uint256 feeBps = vm.envOr("UPKEEP_FEE_BPS", uint256(5));

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        if (admin == address(0)) admin = deployer;

        // ---- pre-flight ----
        require(treasury != address(0), "UPKEEP_TREASURY must be set");
        require(feeBps <= FeeMath.MAX_CONFIGURABLE_FEE_BPS, "UPKEEP_FEE_BPS above safety bound");

        console2.log("== upKEEP deployment ==");
        console2.log("chain id  :", block.chainid);
        console2.log("deployer  :", deployer);
        console2.log("admin     :", admin);
        console2.log("treasury  :", treasury);
        console2.log("keeper    :", keeper);
        console2.log("fee (bps) :", feeBps);
        console2.log("balance   :", deployer.balance, "wei (native USDC, 18dp)");

        if (block.chainid == ARC_MAINNET_CHAIN_ID) {
            console2.log("network   : ARC MAINNET - real funds");
        } else {
            console2.log("network   : chain", block.chainid);
        }

        require(deployer.balance > 0, "deployer has no USDC for gas");

        // ---- deploy ----
        vm.startBroadcast(deployerKey);

        ConditionRegistry registry = new ConditionRegistry(admin);
        AutomationExecutor executor = new AutomationExecutor(address(registry), admin);
        AutomationVaultFactory factory =
            new AutomationVaultFactory(admin, treasury, feeBps, address(executor));

        // Balance Guard: the first condition kind registered onto the engine.
        // Further kinds are added later by deploying an IConditionEvaluator and
        // calling registerEvaluator - no redeployment of anything here.
        BalanceThresholdEvaluator balanceEvaluator = new BalanceThresholdEvaluator();

        // The authorization layer's first scheme. Vaults use the built-in
        // executor check by default; pointing one at this provider makes the
        // scheme explicit and is what a future scheme would replace.
        ExecutorAuthorizationProvider authProvider = new ExecutorAuthorizationProvider();

        // Wire everything up. Only possible if the deployer is also the admin;
        // otherwise the admin must do this themselves afterwards.
        if (admin == deployer) {
            registry.registerEvaluator(address(balanceEvaluator));
            registry.setExecutor(address(executor));
            if (keeper != address(0)) {
                executor.setKeeper(keeper, true);
            }
        }

        vm.stopBroadcast();

        // ---- report ----
        console2.log("");
        console2.log("ConditionRegistry        :", address(registry));
        console2.log("AutomationExecutor       :", address(executor));
        console2.log("AutomationVaultFactory   :", address(factory));
        console2.log("BalanceThresholdEvaluator:", address(balanceEvaluator));
        console2.log("ExecutorAuthProvider     :", address(authProvider));
        console2.log("");
        console2.log("Add these to .env.local:");
        console2.log("NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS=%s", address(registry));
        console2.log("NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS=%s", address(executor));
        console2.log("NEXT_PUBLIC_VAULT_FACTORY_ADDRESS=%s", address(factory));
        console2.log("NEXT_PUBLIC_AUTH_PROVIDER_ADDRESS=%s", address(authProvider));
        console2.log("NEXT_PUBLIC_DEPLOY_BLOCK=%s", block.number);

        if (admin != deployer) {
            console2.log("");
            console2.log("ACTION REQUIRED (admin is not the deployer):");
            console2.log("  registry.registerEvaluator(%s)", address(balanceEvaluator));
            console2.log("  registry.setExecutor(%s)", address(executor));
            console2.log("  executor.setKeeper(<keeper>, true)");
        }
    }
}
