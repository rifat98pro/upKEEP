/**
 * Fee math tests.
 *
 * The vector table below is the same one in contracts/test/FeeMath.t.sol. If
 * these two suites ever disagree, the UI is quoting a fee the chain would not
 * charge, which is exactly the bug this duplication exists to catch.
 */
import { describe, it, expect } from 'vitest';
import { computeFee, computeFeeBreakdown } from './fee.js';
import { parseUsdc } from './units.js';

const FEE_BPS = 5; // 0.05%
const ONE_USDC = 10n ** 18n;

describe('computeFee', () => {
  it('charges exactly $0.50 on a $1,000 execution', () => {
    const breakdown = computeFeeBreakdown(1000n * ONE_USDC, FEE_BPS);

    expect(breakdown.fee).toBe(parseUsdc('0.50'));
    expect(breakdown.netAmount).toBe(parseUsdc('999.50'));
    expect(breakdown.netAmount + breakdown.fee).toBe(1000n * ONE_USDC);
  });

  // [amount, expected fee] - identical to the Solidity vector table.
  const vectors: Array<[bigint, bigint, string]> = [
    [1000n * ONE_USDC, 5n * 10n ** 17n, 'rate applies'],
    [5000n * ONE_USDC, 25n * 10n ** 17n, 'rate applies'],
    [10_000n * ONE_USDC, 5n * ONE_USDC, 'rate applies'],
    [2n * ONE_USDC, 10n ** 15n, 'rate lands exactly on the $0.001 floor'],
    [1n * ONE_USDC, 10n ** 15n, 'floor applies'],
    [parseUsdc('0.05'), 5n * 10n ** 14n, 'cap applies: 1% of $0.05'],
    [parseUsdc('0.01'), 10n ** 14n, 'micro demo: 1% of $0.01'],
    [parseUsdc('0.001'), 10n ** 13n, 'cap applies'],
    [0n, 0n, 'nothing in, nothing out'],
    [1n, 0n, '1 wei: cap floors to zero, fee waived'],
  ];

  it.each(vectors)('amount %s -> fee %s (%s)', (amount, expectedFee) => {
    expect(computeFee(amount, FEE_BPS)).toBe(expectedFee);
  });
});

describe('rounding behaviour', () => {
  it('truncates in the user favour', () => {
    // 1999 * 5 / 10000 = 0.9995 -> 0, then the floor, then the 1% cap of 19.
    expect(computeFee(1999n, FEE_BPS)).toBe(19n);
  });

  it('never rounds up past the cap on tiny amounts', () => {
    for (let amount = 1n; amount < 100n; amount++) {
      expect(computeFee(amount, FEE_BPS)).toBe(0n);
    }
  });

  it('never lets the fee outgrow the transaction', () => {
    const amounts = [1n, 10n ** 6n, 10n ** 12n, 10n ** 14n, parseUsdc('0.001'), parseUsdc('0.5')];
    for (const amount of amounts) {
      const fee = computeFee(amount, FEE_BPS);
      expect(fee).toBeLessThanOrEqual(amount / 100n);
      expect(fee).toBeLessThan(amount);
    }
  });
});

describe('breakdown flags', () => {
  it('reports when the minimum fee set the price', () => {
    const breakdown = computeFeeBreakdown(parseUsdc('1'), FEE_BPS);
    expect(breakdown.minimumApplied).toBe(true);
    expect(breakdown.capApplied).toBe(false);
    expect(breakdown.fee).toBe(parseUsdc('0.001'));
  });

  it('reports when the 1% ceiling clamped the fee', () => {
    const breakdown = computeFeeBreakdown(parseUsdc('0.01'), FEE_BPS);
    expect(breakdown.capApplied).toBe(true);
    expect(breakdown.fee).toBe(parseUsdc('0.0001'));
  });

  it('reports a plain rate calculation', () => {
    const breakdown = computeFeeBreakdown(parseUsdc('1000'), FEE_BPS);
    expect(breakdown.minimumApplied).toBe(false);
    expect(breakdown.capApplied).toBe(false);
  });
});

describe('invariants', () => {
  const samples = [
    0n, 1n, 99n, 100n, 10n ** 6n, 10n ** 12n, 10n ** 15n, ONE_USDC, 7n * ONE_USDC,
    1234n * ONE_USDC, 10n ** 24n,
  ];

  it('always conserves value', () => {
    for (const amount of samples) {
      const { fee, netAmount } = computeFeeBreakdown(amount, FEE_BPS);
      expect(netAmount + fee).toBe(amount);
    }
  });

  it('never exceeds the 1% ceiling', () => {
    for (const amount of samples) {
      expect(computeFee(amount, FEE_BPS)).toBeLessThanOrEqual((amount * 100n) / 10_000n);
    }
  });

  it('is monotonic in the amount', () => {
    const sorted = [...samples].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 1; i < sorted.length; i++) {
      expect(computeFee(sorted[i], FEE_BPS)).toBeGreaterThanOrEqual(
        computeFee(sorted[i - 1], FEE_BPS),
      );
    }
  });

  it('always leaves the recipient something', () => {
    for (const amount of samples.filter((a) => a > 0n)) {
      expect(computeFeeBreakdown(amount, FEE_BPS).netAmount).toBeGreaterThan(0n);
    }
  });
});
