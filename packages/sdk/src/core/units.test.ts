import { describe, it, expect } from 'vitest';
import {
  parseUsdc,
  formatUsdc,
  formatUsd,
  formatUsdPrecise,
  nativeToErc20,
  erc20ToNative,
  isErc20Representable,
} from './units.js';

const ONE_USDC = 10n ** 18n;

describe('parseUsdc', () => {
  it('parses whole amounts into 18-decimal wei', () => {
    expect(parseUsdc('1')).toBe(ONE_USDC);
    expect(parseUsdc('5000')).toBe(5000n * ONE_USDC);
    expect(parseUsdc('0')).toBe(0n);
  });

  it('parses fractional amounts exactly', () => {
    expect(parseUsdc('0.5')).toBe(ONE_USDC / 2n);
    expect(parseUsdc('999.50')).toBe(9995n * 10n ** 17n);
    expect(parseUsdc('0.000001')).toBe(10n ** 12n);
  });

  it('accepts formatted input', () => {
    expect(parseUsdc('$5,000')).toBe(5000n * ONE_USDC);
    expect(parseUsdc('1,234.56')).toBe(123456n * 10n ** 16n);
    expect(parseUsdc(' 42 ')).toBe(42n * ONE_USDC);
  });

  it('rejects anything it cannot represent exactly', () => {
    expect(() => parseUsdc('')).toThrow();
    expect(() => parseUsdc('abc')).toThrow();
    expect(() => parseUsdc('1.2.3')).toThrow();
    expect(() => parseUsdc('-5')).toThrow();
    expect(() => parseUsdc('.')).toThrow();
  });

  it('rejects more precision than USDC has', () => {
    expect(() => parseUsdc('1.0000000000000000001')).toThrow(/decimal places/);
  });

  it('round-trips through formatUsdc', () => {
    // formatUsdc groups thousands for display, so compare without separators.
    for (const value of ['1', '5000', '0.5', '1234.56', '0.01']) {
      expect(formatUsdc(parseUsdc(value), 18).replace(/,/g, '')).toBe(value);
    }
  });

  it('round-trips any parsed value back to the same wei', () => {
    for (const value of ['1', '5000', '0.5', '1234.56', '0.01', '0.000001']) {
      expect(parseUsdc(formatUsdc(parseUsdc(value), 18))).toBe(parseUsdc(value));
    }
  });
});

describe('formatUsd', () => {
  it('always shows two decimals with separators', () => {
    expect(formatUsd(parseUsdc('8420'))).toBe('$8,420.00');
    expect(formatUsd(parseUsdc('999.5'))).toBe('$999.50');
    expect(formatUsd(0n)).toBe('$0.00');
    expect(formatUsd(parseUsdc('1234567.89'))).toBe('$1,234,567.89');
  });

  it('truncates rather than rounds up', () => {
    // $0.999 must not display as $1.00 - that would overstate the balance.
    expect(formatUsd(parseUsdc('0.999'))).toBe('$0.99');
  });

  it('handles negative values', () => {
    expect(formatUsd(-parseUsdc('10.5'))).toBe('-$10.50');
  });
});

describe('formatUsdPrecise', () => {
  it('does not round small fees away to zero', () => {
    expect(formatUsdPrecise(parseUsdc('0.001'))).toBe('$0.001');
    expect(formatUsdPrecise(parseUsdc('0.0001'))).toBe('$0.0001');
    expect(formatUsdPrecise(parseUsdc('0.5'))).toBe('$0.50');
    expect(formatUsdPrecise(0n)).toBe('$0.00');
  });
});

describe('Arc dual-decimal conversion', () => {
  it('scales native 18-decimal wei to the 6-decimal ERC-20 view', () => {
    expect(nativeToErc20(parseUsdc('1'))).toBe(1_000_000n);
    expect(nativeToErc20(parseUsdc('8420'))).toBe(8_420_000_000n);
  });

  it('matches the live Arc account this was verified against', () => {
    // Observed on Arc Mainnet: eth_getBalance vs USDC.balanceOf for the
    // GatewayWallet, which must agree exactly after scaling by 1e12.
    const native = 638_398_806_625_000_000_000_000n;
    expect(nativeToErc20(native)).toBe(638_398_806_625n);
  });

  it('round-trips representable amounts', () => {
    const amount = parseUsdc('1234.56');
    expect(erc20ToNative(nativeToErc20(amount))).toBe(amount);
    expect(isErc20Representable(amount)).toBe(true);
  });

  it('detects amounts that the 6-decimal view would truncate', () => {
    const dusty = parseUsdc('1') + 1n; // one wei of sub-cent dust
    expect(isErc20Representable(dusty)).toBe(false);
    expect(erc20ToNative(nativeToErc20(dusty))).toBe(parseUsdc('1'));
  });
});
