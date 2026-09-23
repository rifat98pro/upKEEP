/** `upkeep.usdc.*` - balance reads on Arc, where USDC is the native gas token. */
import type { Address } from 'viem';
import type { UpkeepContext } from './client.js';
import { getDualBalance, getUsdcBalance, getUsdcBalances, type DualBalance } from './arc/usdc.js';

export interface UsdcApi {
  /** Authoritative native balance, in 18-decimal wei. */
  balanceOf: (address: Address) => Promise<bigint>;
  balancesOf: (addresses: readonly Address[]) => Promise<Record<Address, bigint>>;
  /** Both views of the same balance, with a reconciliation flag. */
  dualBalanceOf: (address: Address) => Promise<DualBalance>;
}

export function createUsdcApi(ctx: UpkeepContext): UsdcApi {
  return {
    balanceOf: (address) => getUsdcBalance(ctx.publicClient, address),
    balancesOf: (addresses) => getUsdcBalances(ctx.publicClient, addresses),
    dualBalanceOf: (address) => getDualBalance(ctx.publicClient, address),
  };
}
