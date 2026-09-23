/**
 * USDC reads on Arc.
 *
 * On Arc, USDC is the native gas token: the authoritative balance is what
 * `eth_getBalance` returns, in 18 decimals. The 6-decimal ERC-20 view at
 * 0x3600... reads the same underlying balance but truncates, so it is used here
 * only to cross-check, never as the number recorded.
 *
 * https://docs.arc.io/arc/references/evm-differences
 */
import { erc20Abi, type Address, type PublicClient } from 'viem';
import { NATIVE_TO_ERC20_SCALE, USDC_ERC20_ADDRESS } from '../config/tokens.js';

/**
 * Native USDC balance of an address, in 18-decimal wei.
 * This is the number conditions are evaluated against.
 */
export async function getUsdcBalance(client: PublicClient, address: Address): Promise<bigint> {
  return client.getBalance({ address });
}

/** Balances for several addresses at once. */
export async function getUsdcBalances(
  client: PublicClient,
  addresses: readonly Address[],
): Promise<Record<Address, bigint>> {
  const balances = await Promise.all(addresses.map((address) => client.getBalance({ address })));
  return Object.fromEntries(addresses.map((address, i) => [address, balances[i]])) as Record<
    Address,
    bigint
  >;
}

/** Read the same balance through the ERC-20 interface, in 6-decimal units. */
export async function getUsdcErc20Balance(
  client: PublicClient,
  address: Address,
): Promise<bigint> {
  return client.readContract({
    address: USDC_ERC20_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
}

export interface DualBalance {
  /** Authoritative, 18-decimal. */
  native: bigint;
  /** ERC-20 view, 6-decimal units. */
  erc20: bigint;
  /** True when the two views agree exactly after scaling. */
  consistent: boolean;
  /** Value lost to 6-decimal truncation, in native wei. */
  truncated: bigint;
}

/**
 * Read both views and report whether they reconcile.
 *
 * They differ whenever the balance holds sub-0.000001 USDC dust, which is
 * expected rather than an error - hence `truncated` rather than a warning.
 */
export async function getDualBalance(
  client: PublicClient,
  address: Address,
): Promise<DualBalance> {
  const [native, erc20] = await Promise.all([
    getUsdcBalance(client, address),
    getUsdcErc20Balance(client, address),
  ]);

  const scaled = native / NATIVE_TO_ERC20_SCALE;
  return {
    native,
    erc20,
    consistent: scaled === erc20,
    truncated: native - scaled * NATIVE_TO_ERC20_SCALE,
  };
}
