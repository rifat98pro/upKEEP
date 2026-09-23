// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ScheduleEvaluator} from "../src/evaluators/ScheduleEvaluator.sol";
import {ConditionRegistry} from "../src/ConditionRegistry.sol";
import {ConditionTypes} from "../src/libraries/ConditionTypes.sol";

/// @notice Tests for the second condition kind.
///
/// @dev Two things are under test and they matter for different reasons.
///
///      The predicate itself is ordinary. The part worth care is the *latch*
///      behaviour of a repeating window: the evaluator holds no state, so if
///      `canRearm` were true inside its own firing window, a keeper polling
///      every 30 seconds would drain a vault one authorized amount at a time
///      over a five-minute window. Several tests below exist only to pin that
///      down.
contract ScheduleEvaluatorTest is Test {
    ScheduleEvaluator internal evaluator;

    uint256 internal constant DAY = 1 days;
    uint256 internal constant WINDOW = 5 minutes;

    function setUp() public {
        evaluator = new ScheduleEvaluator();
        // Start well clear of the epoch so the modular arithmetic is realistic.
        vm.warp(1_700_000_000);
    }

    function _repeating(uint256 interval, uint256 window) internal pure returns (bytes memory) {
        return abi.encode(interval, window);
    }

    /// @dev Move to a timestamp that is `offset` seconds into its interval.
    function _warpToOffsetInDay(uint256 offset) internal {
        uint256 dayStart = (block.timestamp / DAY) * DAY;
        vm.warp(dayStart + DAY + offset);
    }

    /*//////////////////////////////////////////////////////////////
                              IDENTITY
    //////////////////////////////////////////////////////////////*/

    function test_kind_isSchedule() public view {
        assertEq(evaluator.kind(), ConditionTypes.KIND_SCHEDULE);
        assertEq(evaluator.kind(), 2);
    }

    function test_supportsOperator_onlyGte() public view {
        assertTrue(evaluator.supportsOperator(ConditionTypes.OP_GTE));
        assertFalse(evaluator.supportsOperator(ConditionTypes.OP_LT));
        assertFalse(evaluator.supportsOperator(ConditionTypes.OP_GT));
        assertFalse(evaluator.supportsOperator(ConditionTypes.OP_LTE));
        assertFalse(evaluator.supportsOperator(ConditionTypes.OP_NONE));
    }

    function test_observe_returnsCurrentTime() public {
        assertEq(evaluator.observe(address(this), ""), block.timestamp);
        vm.warp(block.timestamp + 1234);
        assertEq(evaluator.observe(address(this), ""), block.timestamp);
    }

    function test_rejectsAnUnsupportedOperator() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                ScheduleEvaluator.UnsupportedOperator.selector, ConditionTypes.OP_LT
            )
        );
        evaluator.evaluate(address(this), block.timestamp, ConditionTypes.OP_LT, "");
    }

    /*//////////////////////////////////////////////////////////////
                               DEADLINE
    //////////////////////////////////////////////////////////////*/

    function test_deadline_falseBeforeTheMoment() public view {
        assertFalse(
            evaluator.evaluate(address(this), block.timestamp + 1, ConditionTypes.OP_GTE, "")
        );
    }

    function test_deadline_trueAtTheMoment() public view {
        assertTrue(evaluator.evaluate(address(this), block.timestamp, ConditionTypes.OP_GTE, ""));
    }

    function test_deadline_trueAfterTheMoment() public {
        uint256 deadline = block.timestamp;
        vm.warp(block.timestamp + 365 days);
        assertTrue(evaluator.evaluate(address(this), deadline, ConditionTypes.OP_GTE, ""));
    }

    function test_deadline_neverRearms() public {
        uint256 deadline = block.timestamp;
        assertFalse(evaluator.canRearm(address(this), deadline, 0, ConditionTypes.OP_GTE, ""));

        // A moment in time does not come round again, however long you wait.
        vm.warp(block.timestamp + 3650 days);
        assertFalse(evaluator.canRearm(address(this), deadline, 0, ConditionTypes.OP_GTE, ""));
    }

    /*//////////////////////////////////////////////////////////////
                           REPEATING WINDOW
    //////////////////////////////////////////////////////////////*/

    function test_repeating_firesInsideTheWindow() public {
        _warpToOffsetInDay(60);
        assertTrue(
            evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, _repeating(DAY, WINDOW))
        );
    }

    function test_repeating_silentOutsideTheWindow() public {
        _warpToOffsetInDay(WINDOW + 1);
        assertFalse(
            evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, _repeating(DAY, WINDOW))
        );
    }

    function test_repeating_windowIsHalfOpen() public {
        // Exactly at the boundary is outside the window.
        _warpToOffsetInDay(WINDOW);
        assertFalse(
            evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, _repeating(DAY, WINDOW))
        );
        _warpToOffsetInDay(WINDOW - 1);
        assertTrue(
            evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, _repeating(DAY, WINDOW))
        );
    }

    /// @dev The anti-drain property. Inside its own window the condition must
    ///      NOT be re-armable, or a keeper polling every 30s executes ten times
    ///      across a five-minute window.
    function test_repeating_cannotRearmInsideItsOwnWindow() public {
        bytes memory params = _repeating(DAY, WINDOW);

        for (uint256 offset = 0; offset < WINDOW; offset += 30) {
            _warpToOffsetInDay(offset);
            assertTrue(
                evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, params),
                "should be firing"
            );
            assertFalse(
                evaluator.canRearm(address(this), 1, 0, ConditionTypes.OP_GTE, params),
                "must not re-arm while still inside the window"
            );
        }
    }

    function test_repeating_rearmsOnceTheWindowHasPassed() public {
        bytes memory params = _repeating(DAY, WINDOW);

        _warpToOffsetInDay(WINDOW);
        assertTrue(evaluator.canRearm(address(this), 1, 0, ConditionTypes.OP_GTE, params));
    }

    function test_repeating_firesAgainTheFollowingInterval() public {
        bytes memory params = _repeating(DAY, WINDOW);

        _warpToOffsetInDay(10);
        assertTrue(evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, params));

        // Same offset, one interval later.
        vm.warp(block.timestamp + DAY);
        assertTrue(evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, params));
    }

    function test_repeating_respectsItsStartTime() public {
        bytes memory params = _repeating(DAY, WINDOW);

        _warpToOffsetInDay(10);
        uint256 startsLater = block.timestamp + 30 days;

        // Inside a window, but the schedule has not begun.
        assertFalse(evaluator.evaluate(address(this), startsLater, ConditionTypes.OP_GTE, params));
    }

    /// @dev `rearmBuffer` is meaningless for a schedule: the gap between windows
    ///      is the hysteresis. Passing one must not change anything.
    function test_repeating_ignoresRearmBuffer() public {
        bytes memory params = _repeating(DAY, WINDOW);
        _warpToOffsetInDay(WINDOW + 1);

        assertTrue(evaluator.canRearm(address(this), 1, 0, ConditionTypes.OP_GTE, params));
        assertTrue(evaluator.canRearm(address(this), 1, 999 ether, ConditionTypes.OP_GTE, params));
    }

    /*//////////////////////////////////////////////////////////////
                          MALFORMED SCHEDULES
    //////////////////////////////////////////////////////////////*/

    function test_rejectsParamsThatAreNeitherEmptyNorASchedule() public {
        vm.expectRevert(abi.encodeWithSelector(ScheduleEvaluator.MalformedParams.selector, 3));
        evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, hex"aabbcc");
    }

    function test_rejectsZeroInterval() public {
        vm.expectRevert(ScheduleEvaluator.ZeroInterval.selector);
        evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, _repeating(0, 1));
    }

    function test_rejectsZeroWindow() public {
        vm.expectRevert(abi.encodeWithSelector(ScheduleEvaluator.InvalidWindow.selector, 0, DAY));
        evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, _repeating(DAY, 0));
    }

    /// @dev A window as wide as its interval would fire and then never re-arm,
    ///      latching the condition permanently. Reject it at the door.
    function test_rejectsWindowCoveringTheWholeInterval() public {
        vm.expectRevert(abi.encodeWithSelector(ScheduleEvaluator.InvalidWindow.selector, DAY, DAY));
        evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, _repeating(DAY, DAY));
    }

    function test_describeSchedule_roundTrips() public view {
        (bool repeating, uint256 interval, uint256 window) =
            evaluator.describeSchedule(_repeating(DAY, WINDOW));
        assertTrue(repeating);
        assertEq(interval, DAY);
        assertEq(window, WINDOW);

        (bool oneShot,,) = evaluator.describeSchedule("");
        assertFalse(oneShot);
    }

    /*//////////////////////////////////////////////////////////////
                    FUZZ: THE WINDOW IS NEVER BOTH
    //////////////////////////////////////////////////////////////*/

    /// @dev The safety property, stated once and checked everywhere: at no
    ///      instant may a schedule be simultaneously firing and re-armable.
    ///      If that ever held, the latch would be a no-op.
    function testFuzz_neverFiringAndRearmableAtOnce(uint64 time, uint32 interval, uint32 window)
        public
    {
        interval = uint32(bound(interval, 2, 365 days));
        window = uint32(bound(window, 1, interval - 1));
        vm.warp(bound(time, 1, type(uint64).max));

        bytes memory params = _repeating(interval, window);

        bool firing = evaluator.evaluate(address(this), 1, ConditionTypes.OP_GTE, params);
        bool rearmable = evaluator.canRearm(address(this), 1, 0, ConditionTypes.OP_GTE, params);

        assertTrue(firing != rearmable, "a schedule is either firing or re-armable, never both");
    }

    /*//////////////////////////////////////////////////////////////
                        REGISTRATION ON A LIVE ENGINE
    //////////////////////////////////////////////////////////////*/

    /// @dev The point of the whole exercise: a new condition kind reaches a
    ///      deployed registry by registration alone.
    function test_registersOnAnExistingRegistryWithoutChangingIt() public {
        ConditionRegistry registry = new ConditionRegistry(address(this));

        uint8 registeredKind = registry.registerEvaluator(address(evaluator));

        assertEq(registeredKind, ConditionTypes.KIND_SCHEDULE);
        assertEq(registry.evaluatorFor(ConditionTypes.KIND_SCHEDULE), address(evaluator));

        uint8[] memory kinds = registry.registeredKinds();
        assertEq(kinds.length, 1);
        assertEq(kinds[0], ConditionTypes.KIND_SCHEDULE);
    }
}
