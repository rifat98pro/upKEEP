// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ConditionRegistry} from "../src/ConditionRegistry.sol";
import {ScheduleEvaluator} from "../src/evaluators/ScheduleEvaluator.sol";
import {ConditionTypes} from "../src/libraries/ConditionTypes.sol";

/// @notice Add the schedule condition kind to an already-deployed upKEEP.
///
/// @dev This script is the architectural claim made executable. It deploys one
///      `view` contract and calls `registerEvaluator`. It does not touch the
///      registry's code, the executor, or any vault - existing conditions keep
///      their ids, thresholds, actions and history, and keep running while this
///      happens.
///
///      Run against a live protocol:
///
///        arc-forge script script/RegisterScheduleEvaluator.s.sol:RegisterScheduleEvaluator \
///          --rpc-url https://rpc.mainnet.arc.io \
///          --private-key $DEPLOYER_PRIVATE_KEY \
///          --broadcast --slow --with-gas-price 25000000000
///
///      The caller must be the registry owner; `registerEvaluator` is onlyOwner.
contract RegisterScheduleEvaluator is Script {
    function run() external {
        address registryAddress = vm.envAddress("NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        ConditionRegistry registry = ConditionRegistry(registryAddress);

        // Fail early and legibly rather than reverting inside the call.
        address owner = registry.owner();
        require(owner == deployer, "caller is not the registry owner");

        address existing = registry.evaluatorFor(ConditionTypes.KIND_SCHEDULE);
        if (existing != address(0)) {
            console2.log("Schedule evaluator already registered at:", existing);
            console2.log("Re-running would replace it. Nothing was sent.");
            return;
        }

        console2.log("Registry :", registryAddress);
        console2.log("Owner    :", owner);

        vm.startBroadcast(deployerKey);

        ScheduleEvaluator evaluator = new ScheduleEvaluator();
        uint8 kind = registry.registerEvaluator(address(evaluator));

        vm.stopBroadcast();

        require(kind == ConditionTypes.KIND_SCHEDULE, "registered under the wrong kind");

        console2.log("");
        console2.log("ScheduleEvaluator deployed at:", address(evaluator));
        console2.log("Registered as kind           :", kind);
        console2.log("");
        console2.log("Add to .env.local:");
        console2.log(string.concat("UPKEEP_SCHEDULE_EVALUATOR=", vm.toString(address(evaluator))));
    }
}
