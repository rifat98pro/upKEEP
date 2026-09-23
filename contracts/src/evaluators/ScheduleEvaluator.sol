// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IConditionEvaluator} from "../interfaces/IConditionEvaluator.sol";
import {ConditionTypes} from "../libraries/ConditionTypes.sol";

/// @title ScheduleEvaluator
/// @notice The second condition kind on the upKEEP engine: fire on wall-clock
///         time rather than on a financial state change.
///
/// @dev This contract exists to be added to a *live* protocol without touching
///      anything that holds money. The registry, the executor and every vault
///      are unchanged; this is deployed and registered, and a new condition type
///      exists. That is the engine claim, demonstrated rather than asserted.
///
///      Two shapes, chosen by whether `params` is empty:
///
///      **Deadline** (`params` empty). Fires once when `block.timestamp` reaches
///      `threshold`. Pair it with `recurring = false` so the registry retires it
///      afterwards. `canRearm` is always false: a moment in time does not recur.
///
///      **Repeating window** (`params = abi.encode(interval, window)`). Fires
///      when `block.timestamp % interval < window`, and re-arms once outside
///      that window. `threshold` is the earliest time it may ever fire, so a
///      schedule can be created now and start next month.
///
///      The repeating form is deliberately **stateless**. An evaluator is a
///      `view` function reached by `staticcall`; it cannot record when it last
///      fired, and `canRearm` is not told either. Anchoring to
///      `block.timestamp % interval` sidesteps that entirely - the window itself
///      is the memory. The latch does the rest: once fired, the condition cannot
///      fire again until `canRearm` reports the window has passed, so a keeper
///      polling every 30 seconds inside a 5-minute window still executes once.
///
///      The cost of that choice is that windows are anchored to the Unix epoch,
///      i.e. `interval = 1 days` means midnight UTC. Arbitrary phase would need
///      a third parameter; it is left out rather than half-supported.
///
///      Timestamps are seconds. Miners can nudge `block.timestamp` by a few
///      seconds, which is immaterial at these scales - a window is minutes wide
///      and a deadline is a date. Do not use this to order events finely.
contract ScheduleEvaluator is IConditionEvaluator {
    error UnsupportedOperator(uint8 operator);

    /// @notice `params` was neither empty nor a well-formed (interval, window).
    error MalformedParams(uint256 length);

    /// @notice A repeating schedule needs a positive interval.
    error ZeroInterval();

    /// @notice A window of zero would never fire; a window covering the whole
    ///         interval would fire and then never re-arm, latching forever.
    error InvalidWindow(uint256 window, uint256 interval);

    /// @inheritdoc IConditionEvaluator
    function kind() external pure override returns (uint8) {
        return ConditionTypes.KIND_SCHEDULE;
    }

    /// @inheritdoc IConditionEvaluator
    function description() external pure override returns (string memory) {
        return "Wall-clock time compared against a deadline or repeating window";
    }

    /// @inheritdoc IConditionEvaluator
    /// @dev Only GTE. "The time has arrived" is the only sensible reading of a
    ///      schedule; `<` would mean "fires until the deadline, then stops",
    ///      which is a different feature and not this one.
    function supportsOperator(uint8 operator) public pure override returns (bool) {
        return operator == ConditionTypes.OP_GTE;
    }

    /// @inheritdoc IConditionEvaluator
    /// @dev The observed value is the current time. `subject` is unused - the
    ///      registry rejects the zero address, so callers pass their own wallet
    ///      and it is simply ignored here.
    function observe(address, bytes calldata) external view override returns (uint256) {
        return block.timestamp;
    }

    /// @notice Decode `params` into a repeating schedule, validating as it goes.
    /// @dev Returns `repeating = false` for empty params, which is the deadline
    ///      form. Anything that is neither empty nor exactly two words is a
    ///      caller mistake and reverts rather than being silently treated as a
    ///      deadline.
    function _schedule(bytes calldata params)
        private
        pure
        returns (bool repeating, uint256 interval, uint256 window)
    {
        if (params.length == 0) return (false, 0, 0);
        if (params.length != 64) revert MalformedParams(params.length);

        (interval, window) = abi.decode(params, (uint256, uint256));

        if (interval == 0) revert ZeroInterval();
        if (window == 0 || window >= interval) revert InvalidWindow(window, interval);

        return (true, interval, window);
    }

    /// @notice Decode a schedule without reverting, for UI preview.
    /// @dev `view`-only helper so a front end can show "every 24h for 5 minutes"
    ///      without reimplementing the encoding.
    function describeSchedule(bytes calldata params)
        external
        pure
        returns (bool repeating, uint256 interval, uint256 window)
    {
        return _schedule(params);
    }

    /// @inheritdoc IConditionEvaluator
    function evaluate(address, uint256 threshold, uint8 operator, bytes calldata params)
        external
        view
        override
        returns (bool)
    {
        if (!supportsOperator(operator)) revert UnsupportedOperator(operator);

        // Nothing fires before its start time, in either shape.
        if (block.timestamp < threshold) return false;

        (bool repeating, uint256 interval, uint256 window) = _schedule(params);
        if (!repeating) return true;

        return (block.timestamp % interval) < window;
    }

    /// @inheritdoc IConditionEvaluator
    /// @dev A deadline never re-arms: it is one moment, and the registry moves a
    ///      one-shot condition to EXECUTED anyway. A repeating schedule re-arms
    ///      as soon as the current window has passed, which is what stops a
    ///      single window from firing on every poll inside it.
    ///
    ///      `rearmBuffer` is unused. Hysteresis is inherent here - the gap
    ///      between windows is the buffer - so there is nothing for a caller to
    ///      tune and nothing to get wrong.
    function canRearm(address, uint256, uint256, uint8 operator, bytes calldata params)
        external
        view
        override
        returns (bool)
    {
        if (!supportsOperator(operator)) revert UnsupportedOperator(operator);

        (bool repeating, uint256 interval, uint256 window) = _schedule(params);
        if (!repeating) return false;

        return (block.timestamp % interval) >= window;
    }
}
