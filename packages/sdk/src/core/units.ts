/**
 * USDC unit handling for Arc.
 *
 * Canonical unit everywhere in upKEEP: 18-decimal native wei.
 * The 6-decimal ERC-20 view is derived for display only, never for arithmetic.
 * See config/tokens.ts for why.
 *
 * There is no floating point anywhere in this file. Every conversion is exact
 * integer arithmetic on bigint, and anything that cannot be represented exactly
 * throws rather than rounding silently.
 */
import { NATIVE_TO_ERC20_SCALE, USDC_NATIVE_DECIMALS } from '../config/tokens.js';

const ONE_USDC = 10n ** BigInt(USDC_NATIVE_DECIMALS);

/**
 * Parse a human string ("5000", "1,000.25", "$5,000") into 18-decimal wei.
 * Throws on anything it cannot represent exactly. Never silently rounds.
 */
export function parseUsdc(input: string): bigint {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '') throw new Error('Amount is required');
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') {
    throw new Error('Amount must be a positive number');
  }

  const [whole, frac = ''] = cleaned.split('.');
  if (frac.length > USDC_NATIVE_DECIMALS) {
    throw new Error(`USDC supports at most ${USDC_NATIVE_DECIMALS} decimal places`);
  }

  const padded = frac.padEnd(USDC_NATIVE_DECIMALS, '0');
  return BigInt(whole === '' ? '0' : whole) * ONE_USDC + BigInt(padded === '' ? '0' : padded);
}

/**
 * Accept either a bigint of native wei or a human string.
 *
 * This is what lets the SDK take `threshold: "5000"` from a developer while
 * keeping bigint as the only internal representation.
 */
export function toUsdcWei(value: bigint | string | number): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    // Refused on purpose: a JS number cannot represent every USDC amount
    // exactly, and money must never round by accident.
    throw new Error(
      'Pass USDC amounts as a string ("1000.50") or a bigint of native wei, never a number.',
    );
  }
  return parseUsdc(value);
}

/** Format 18-decimal wei as a plain decimal string, trailing zeros trimmed. */
export function formatUsdc(wei: bigint, maxDecimals = 2): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;

  const whole = abs / ONE_USDC;
  const frac = abs % ONE_USDC;

  let fracStr = frac.toString().padStart(USDC_NATIVE_DECIMALS, '0').slice(0, maxDecimals);
  fracStr = fracStr.replace(/0+$/, '');

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fracStr ? `${wholeStr}.${fracStr}` : wholeStr;
  return negative ? `-${body}` : body;
}

/** Format for money display: always two decimals, thousands separated. */
export function formatUsd(wei: bigint): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / ONE_USDC;
  const frac = abs % ONE_USDC;
  const cents = (frac / (ONE_USDC / 100n)).toString().padStart(2, '0');
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${wholeStr}.${cents}`;
}

/**
 * Format small amounts (fees, gas) without rounding them away to $0.00.
 * Falls back to more precision when the value would otherwise display as zero.
 */
export function formatUsdPrecise(wei: bigint): string {
  if (wei === 0n) return '$0.00';
  const abs = wei < 0n ? -wei : wei;
  if (abs >= ONE_USDC / 100n) return formatUsd(wei);
  const s = formatUsdc(wei, 6);
  return `$${s === '0' ? '0.000001' : s}`;
}

/** Native 18-decimal wei to the 6-decimal ERC-20 view (truncating, as Arc does). */
export function nativeToErc20(wei: bigint): bigint {
  return wei / NATIVE_TO_ERC20_SCALE;
}

/** 6-decimal ERC-20 units to native 18-decimal wei. */
export function erc20ToNative(units: bigint): bigint {
  return units * NATIVE_TO_ERC20_SCALE;
}

/** True when the amount survives a round-trip through the 6-decimal view. */
export function isErc20Representable(wei: bigint): boolean {
  return wei % NATIVE_TO_ERC20_SCALE === 0n;
}
