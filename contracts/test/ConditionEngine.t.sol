// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ConditionRegistry} from "../src/ConditionRegistry.sol";
import {AutomationVault} from "../src/AutomationVault.sol";
import {BalanceThresholdEvaluator} from "../src/evaluators/BalanceThresholdEvaluator.sol";
import {IConditionEvaluator} from "../src/interfaces/IConditionEvaluator.sol";
import {ConditionTypes} from "../src/libraries/ConditionTypes.sol";

/// @notice A second condition kind, existing only to prove the engine's
///         extension point works without touching the registry.
/// @dev Fires when the subject's stored counter exceeds a threshold. It is
///      intentionally unlike a balance check: different data source, different
///      direction, encoded params. If this can be added by registration alone,
///      the abstraction is real.
contract CounterEvaluator is IConditionEvaluator {
    uint8 public constant KIND = 42;

    mapping(address subject => uint256 count) public counts;

    function setCount(address subject, uint256 value) external {
        counts[subject] = value;
    }

    function kind() external pure virtual returns (uint8) {
        return KIND;
    }

    function description() external pure returns (string memory) {
        return "Test counter above a threshold";
    }

    function supportsOperator(uint8 operator) external pure returns (bool) {
        return operator == ConditionTypes.OP_GT;
    }

    function observe(address subject, bytes calldata) external view returns (uint256) {
        return counts[subject];
    }

    function evaluate(address subject, uint256 threshold, uint8, bytes calldata)
        external
        view
        returns (bool)
    {
        return counts[subject] > threshold;
    }

    function canRearm(address subject, uint256 threshold, uint256 buffer, uint8, bytes calldata)
        external
        view
        returns (bool)
    {
        uint256 level = buffer >= threshold ? 0 : threshold - buffer;
        return counts[subject] <= level;
    }
}

/// @notice An evaluator that lies about its own kind, to prove registration
///         checks rather than trusts.
contract MislabelledEvaluator is CounterEvaluator {
    function kind() external pure override returns (uint8) {
        return ConditionTypes.KIND_NONE;
    }
}

/// @title ConditionEngineTest
/// @notice upKEEP is a condition engine; Balance Guard is its first evaluator.
///         These tests exercise the engine itself rather than that one example.
contract ConditionEngineTest is Test {
    ConditionRegistry registry;
    AutomationVault vault;
    BalanceThresholdEvaluator balanceEvaluator;
    CounterEvaluator counterEvaluator;

    address admin = makeAddr("admin");
    address user = makeAddr("user");
    address attacker = makeAddr("attacker");
    address executor = makeAddr("executor");
    address treasury = makeAddr("treasury");
    address recipient = makeAddr("reserveWallet");
    address subject = makeAddr("subject");

    function setUp() public {
        vm.startPrank(admin);
        registry = new ConditionRegistry(admin);
        balanceEvaluator = new BalanceThresholdEvaluator();
        registry.registerEvaluator(address(balanceEvaluator));
        registry.setExecutor(executor);
        vm.stopPrank();

        counterEvaluator = new CounterEvaluator();

        vm.deal(user, 10_000e18);
        vm.prank(user);
        vault = new AutomationVault{value: 5000e18}(user, executor, recipient, 1000e18, 0, 5, treasury);

        vm.deal(subject, 8000e18);
    }

    function _params(uint8 kind, uint8 operator, uint128 threshold)
        private
        view
        returns (ConditionRegistry.CreateParams memory)
    {
        return ConditionRegistry.CreateParams({
            kind: kind,
            operator: operator,
            subject: subject,
            threshold: threshold,
            rearmBuffer: 0,
            recurring: true,
            params: "",
            actionKind: ConditionTypes.ACTION_TRANSFER_USDC,
            vault: address(vault),
            recipient: recipient,
            amount: 1000e18,
            maxAmount: 1000e18
        });
    }

    /*//////////////////////////////////////////////////////////////
                          EVALUATOR REGISTRATION
    //////////////////////////////////////////////////////////////*/

    function test_registry_startsWithOnlyTheBalanceEvaluator() public view {
        uint8[] memory kinds = registry.registeredKinds();
        assertEq(kinds.length, 1);
        assertEq(kinds[0], ConditionTypes.KIND_BALANCE_THRESHOLD);
        assertEq(registry.evaluatorFor(ConditionTypes.KIND_BALANCE_THRESHOLD), address(balanceEvaluator));
    }

    /// @notice The headline claim: a brand new condition kind is added by
    ///         registration alone. No registry change, no executor change, no
    ///         redeployment, no migration of existing conditions.
    function test_newConditionKind_addedByRegistrationAlone() public {
        vm.prank(admin);
        uint8 kind = registry.registerEvaluator(address(counterEvaluator));
        assertEq(kind, counterEvaluator.KIND());

        counterEvaluator.setCount(subject, 10);

        // Read KIND() before the prank: an external call in the argument list
        // would otherwise consume it and the condition would be created by the
        // test contract rather than by `user`.
        ConditionRegistry.CreateParams memory p = _params(kind, ConditionTypes.OP_GT, 5);

        vm.prank(user);
        (uint256 id,) = registry.createCondition(p);

        // The engine evaluates a kind it knew nothing about at deployment.
        assertTrue(registry.isConditionTrue(id), "new kind did not evaluate");
        assertTrue(registry.canExecute(id));
        assertEq(registry.observedValue(id), 10);

        // And it latches and re-arms through exactly the same state machine.
        vm.prank(executor);
        registry.markTriggered(id);
        assertFalse(registry.canExecute(id), "new kind bypassed the latch");

        // Recovery: the counter falls back under the threshold, so the condition
        // re-arms. It is not executable at this point precisely because the
        // predicate is false again - that is what recovery means.
        counterEvaluator.setCount(subject, 1);
        assertTrue(registry.canRearm(id));
        registry.rearm(id);
        assertFalse(registry.canExecute(id), "armed and firing at the same time");

        // Crossing the threshold again fires a second trigger.
        counterEvaluator.setCount(subject, 10);
        assertTrue(registry.canExecute(id), "re-armed condition did not fire again");

        vm.prank(executor);
        registry.markTriggered(id);
        assertEq(registry.getCondition(id).triggerCount, 2);
    }

    function test_registerEvaluator_onlyAdmin() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        registry.registerEvaluator(address(counterEvaluator));
    }

    function test_registerEvaluator_rejectsZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(ConditionRegistry.ZeroAddress.selector);
        registry.registerEvaluator(address(0));
    }

    /// @notice Registration asks the evaluator what it implements and checks the
    ///         answer, rather than trusting a kind supplied by the caller.
    function test_registerEvaluator_rejectsUnlabelledEvaluator() public {
        MislabelledEvaluator bad = new MislabelledEvaluator();

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(ConditionRegistry.NoEvaluatorForKind.selector, uint8(0))
        );
        registry.registerEvaluator(address(bad));
    }

    function test_registerEvaluator_replacingAKindDoesNotDuplicateIt() public {
        BalanceThresholdEvaluator replacement = new BalanceThresholdEvaluator();

        vm.prank(admin);
        registry.registerEvaluator(address(replacement));

        assertEq(registry.registeredKinds().length, 1, "kind was double-counted");
        assertEq(
            registry.evaluatorFor(ConditionTypes.KIND_BALANCE_THRESHOLD), address(replacement)
        );
    }

    /*//////////////////////////////////////////////////////////////
                            ENGINE VALIDATION
    //////////////////////////////////////////////////////////////*/

    function test_createCondition_rejectsUnregisteredKind() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(ConditionRegistry.NoEvaluatorForKind.selector, uint8(99)));
        registry.createCondition(_params(99, ConditionTypes.OP_LT, 5000e18));
    }

    /// @notice The evaluator decides which operators it can honour, and the
    ///         registry refuses a condition it could not evaluate.
    function test_createCondition_rejectsOperatorTheEvaluatorDoesNotSupport() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConditionRegistry.OperatorNotSupported.selector,
                ConditionTypes.KIND_BALANCE_THRESHOLD,
                ConditionTypes.OP_LTE
            )
        );
        registry.createCondition(_params(ConditionTypes.KIND_BALANCE_THRESHOLD, ConditionTypes.OP_LTE, 5000e18));
    }

    function test_createCondition_rejectsUnsupportedActionKind() public {
        ConditionRegistry.CreateParams memory p =
            _params(ConditionTypes.KIND_BALANCE_THRESHOLD, ConditionTypes.OP_LT, 5000e18);
        p.actionKind = 77;

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(ConditionRegistry.UnsupportedActionKind.selector, uint8(77)));
        registry.createCondition(p);
    }

    /*//////////////////////////////////////////////////////////////
                    THE BALANCE EVALUATOR, BOTH DIRECTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice One evaluator already covers "balance below" and "balance above".
    ///         V1 only exposes the below direction in the UI and SDK.
    function test_balanceEvaluator_supportsBothDirections() public {
        assertTrue(balanceEvaluator.supportsOperator(ConditionTypes.OP_LT));
        assertTrue(balanceEvaluator.supportsOperator(ConditionTypes.OP_GT));
        assertFalse(balanceEvaluator.supportsOperator(ConditionTypes.OP_LTE));

        vm.deal(subject, 4000e18);
        assertTrue(balanceEvaluator.evaluate(subject, 5000e18, ConditionTypes.OP_LT, ""));
        assertFalse(balanceEvaluator.evaluate(subject, 5000e18, ConditionTypes.OP_GT, ""));

        vm.deal(subject, 9000e18);
        assertFalse(balanceEvaluator.evaluate(subject, 5000e18, ConditionTypes.OP_LT, ""));
        assertTrue(balanceEvaluator.evaluate(subject, 5000e18, ConditionTypes.OP_GT, ""));
    }

    /// @notice Recovery is directional, and the evaluator owns that knowledge.
    function test_balanceEvaluator_rearmIsDirectional() public {
        // "Below" condition: recovery means clearing threshold + buffer.
        vm.deal(subject, 5099e18);
        assertFalse(balanceEvaluator.canRearm(subject, 5000e18, 100e18, ConditionTypes.OP_LT, ""));
        vm.deal(subject, 5100e18);
        assertTrue(balanceEvaluator.canRearm(subject, 5000e18, 100e18, ConditionTypes.OP_LT, ""));

        // "Above" condition: recovery means falling under threshold - buffer.
        vm.deal(subject, 4901e18);
        assertFalse(balanceEvaluator.canRearm(subject, 5000e18, 100e18, ConditionTypes.OP_GT, ""));
        vm.deal(subject, 4900e18);
        assertTrue(balanceEvaluator.canRearm(subject, 5000e18, 100e18, ConditionTypes.OP_GT, ""));
    }

    /// @notice A buffer larger than the threshold must not underflow.
    function test_balanceEvaluator_handlesOversizedBuffer() public {
        vm.deal(subject, 0);
        assertTrue(balanceEvaluator.canRearm(subject, 100e18, 500e18, ConditionTypes.OP_GT, ""));
    }

    function test_balanceEvaluator_rejectsUnsupportedOperator() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                BalanceThresholdEvaluator.UnsupportedOperator.selector, ConditionTypes.OP_GTE
            )
        );
        balanceEvaluator.evaluate(subject, 1, ConditionTypes.OP_GTE, "");
    }

    /*//////////////////////////////////////////////////////////////
                                 FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @notice The engine's predicate must match a plain comparison at any balance.
    function testFuzz_balanceEvaluatorMatchesComparison(uint256 balance, uint128 threshold)
        public
    {
        balance = bound(balance, 0, type(uint128).max);
        vm.assume(threshold > 0);
        vm.deal(subject, balance);

        assertEq(
            balanceEvaluator.evaluate(subject, threshold, ConditionTypes.OP_LT, ""),
            balance < threshold
        );
        assertEq(
            balanceEvaluator.evaluate(subject, threshold, ConditionTypes.OP_GT, ""),
            balance > threshold
        );
    }
}
