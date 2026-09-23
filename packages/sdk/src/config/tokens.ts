/**
 * Token configuration for Arc.
 *
 * THE DECIMAL STORY (the single most important detail in this codebase):
 *
 * On Arc, USDC is the **native gas token**, and it exposes two interfaces over
 * *one* balance:
 *
 *   - native interface : 18 decimals  (eth_getBalance, msg.value, address.balance)
 *   - ERC-20 interface :  6 decimals  (balanceOf/transfer at the address below)
 *
 * To display a native value as USDC you divide by 10^12.
 *
 * The Arc docs give an explicit warning that this SDK follows:
 *
 *   "Don't use the 6-decimal value when crediting or recording balances;
 *    truncation at the 6-decimal boundary records less than was transferred."
 *
 * So upKEEP accounts for **everything** in 18-decimal native wei: thresholds,
 * amounts, fees, vault balances, on-chain storage. The 6-decimal ERC-20 view is
 * only ever used for display parity, never for arithmetic.
 *
 * Source: https://docs.arc.io/arc/references/evm-differences
 *         https://docs.arc.io/arc/references/contract-addresses
 */
import type { Address } from 'viem';

/**
 * Optional ERC-20 interface over the native USDC balance on Arc.
 * Same address on Arc Mainnet and Arc Testnet, per the official contract list.
 * Verified live: decimals() returns 6, symbol() returns "USDC".
 */
export const USDC_ERC20_ADDRESS: Address = '0x3600000000000000000000000000000000000000';

/** Decimals of the native USDC balance (eth_getBalance / msg.value). */
export const USDC_NATIVE_DECIMALS = 18 as const;

/** Decimals reported by the ERC-20 interface at USDC_ERC20_ADDRESS. */
export const USDC_ERC20_DECIMALS = 6 as const;

/** 10^(18-6). Native wei to ERC-20 units. Verified against a live Arc account. */
export const NATIVE_TO_ERC20_SCALE = 10n ** 12n;

export const USDC = {
  symbol: 'USDC',
  name: 'USD Coin',
  /** The canonical unit upKEEP uses for all arithmetic. */
  decimals: USDC_NATIVE_DECIMALS,
  erc20Address: USDC_ERC20_ADDRESS,
  erc20Decimals: USDC_ERC20_DECIMALS,
  isNativeGasToken: true,
} as const;

/** Assets upKEEP can monitor. Only USDC is supported in V1. */
export const SUPPORTED_ASSETS = [USDC] as const;

export type SupportedAsset = 'USDC';
