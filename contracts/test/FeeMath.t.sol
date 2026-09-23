// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FeeMath} from "../src/libraries/FeeMath.sol";

/// @title FeeMathTest
/// @notice Locks down the money math.
/// @dev The vector table below is duplicated verbatim in src/lib/fee.test.ts.
///      If the two ever disagree, the UI would be quoting a fee the chain does
///      not charge, so both suites assert the same numbers on purpose.
contract FeeMathTest is Test {
    uint256 constant FEE_BPS = 5; // 0.05%
    uint256 constant ONE_USDC = 1e18; // native 18-decimal USDC

    /*//////////////////////////////////////////////////////////////
                             THE HEADLINE CASE
    //////////////////////////////////////////////////////////////*/

    function test_headline_1000UsdcCharges50Cents() public pure {
        (uint256 net, uint256 fee) = FeeMath.split(1000 * ONE_USDC, FEE_BPS);
        assertEq(fee, 0.5e18, "fee on $1,000 must be exactly $0.50");
        assertEq(net, 999.5e18, "recipient must receive exactly $999.50");
        assertEq(net + fee, 1000 * ONE_USDC, "split must conserve value");
    }

    /*//////////////////////////////////////////////////////////////
                              VECTOR TABLE
    //////////////////////////////////////////////////////////////*/

    function test_vectors() public pure {
        // amount, expected fee
        _check(1000 * ONE_USDC, 0.5e18); // rate applies
        _check(5000 * ONE_USDC, 2.5e18); // rate applies
        _check(10_000 * ONE_USDC, 5e18); // rate applies
        _check(2 * ONE_USDC, 1e15); // rate lands exactly on the $0.001 floor
        _check(1 * ONE_USDC, 1e15); // floor applies ($0.001, under the 1% cap)
        _check(0.05e18, 5e14); // cap applies: 1% of $0.05 = $0.0005
        _check(0.01e18, 1e14); // micro demo: 1% of $0.01 = $0.0001
        _check(0.001e18, 1e13); // cap applies
        _check(0, 0); // nothing in, nothing out
        _check(1, 0); // 1 wei: cap floors to zero, fee is waived
    }

    function _check(uint256 amount, uint256 expectedFee) private pure {
        assertEq(FeeMath.computeFee(amount, FEE_BPS), expectedFee);
    }

    /*//////////////////////////////////////////////////////////////
                          ROUNDING BEHAVIOUR (§36)
    //////////////////////////////////////////////////////////////*/

    /// @notice Integer division truncates, and truncation must favour the user.
    function test_rounding_truncatesInUsersFavour() public pure {
        // 1999 wei * 5 / 10000 = 0.9995 -> truncates to 0, then floor, then cap(=19).
        uint256 amount = 1999;
        uint256 fee = FeeMath.computeFee(amount, FEE_BPS);
        assertEq(fee, 19, "cap = floor(1999/100) = 19");
        assertLe(fee, amount / 100, "never above 1%");
    }

    function test_rounding_neverRoundsUpPastTheCap() public pure {
        // Any amount under 100 wei has a 1% cap of zero, so the fee is waived
        // rather than rounded up to 1 wei.
        for (uint256 amount = 1; amount < 100; amount++) {
            assertEq(FeeMath.computeFee(amount, FEE_BPS), 0);
        }
    }

    /*//////////////////////////////////////////////////////////////
                           SMALL-TRANSACTION RULE
    //////////////////////////////////////////////////////////////*/

    /// @notice §20: the fee must never grow larger than the transaction itself.
    function test_feeNeverExceedsOnePercent_smallAmounts() public pure {
        uint256[6] memory amounts =
            [uint256(1), 1e6, 1e12, 1e14, 0.001e18, 0.5e18];
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 fee = FeeMath.computeFee(amounts[i], FEE_BPS);
            assertLe(fee, amounts[i] / 100, "fee exceeded 1% ceiling");
            assertLt(fee, amounts[i] == 0 ? 1 : amounts[i], "fee met or exceeded amount");
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @notice The split always conserves value and never underflows.
    function testFuzz_splitConservesValue(uint256 amount, uint16 bps) public pure {
        amount = bound(amount, 0, type(uint128).max);
        uint256 feeBps = bound(uint256(bps), 0, FeeMath.MAX_CONFIGURABLE_FEE_BPS);

        (uint256 net, uint256 fee) = FeeMath.split(amount, feeBps);

        assertEq(net + fee, amount, "value not conserved");
        assertLe(fee, amount, "fee exceeded amount");
    }

    /// @notice The effective fee never exceeds the 1% ceiling, at any rate.
    function testFuzz_feeNeverExceedsCap(uint256 amount, uint16 bps) public pure {
        amount = bound(amount, 0, type(uint128).max);
        uint256 feeBps = bound(uint256(bps), 0, FeeMath.MAX_CONFIGURABLE_FEE_BPS);

        uint256 fee = FeeMath.computeFee(amount, feeBps);
        assertLe(fee, (amount * FeeMath.MAX_EFFECTIVE_FEE_BPS) / FeeMath.BPS_DENOMINATOR);
    }

    /// @notice A larger transfer is never charged a smaller fee.
    function testFuzz_feeIsMonotonic(uint256 a, uint256 b) public pure {
        a = bound(a, 0, type(uint112).max);
        b = bound(b, 0, type(uint112).max);
        if (a > b) (a, b) = (b, a);

        assertLe(FeeMath.computeFee(a, FEE_BPS), FeeMath.computeFee(b, FEE_BPS));
    }

    /// @notice No amount can ever be charged more than it is worth.
    function testFuzz_recipientAlwaysReceivesSomething(uint256 amount) public pure {
        amount = bound(amount, 1, type(uint128).max);
        (uint256 net, uint256 fee) = FeeMath.split(amount, FEE_BPS);
        assertGt(net, 0, "recipient received nothing");
        assertLt(fee, amount, "fee consumed the entire transfer");
    }
}
