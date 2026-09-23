'use client';

/**
 * Live USDC balance for an address on Arc Mainnet.
 *
 * On Arc, USDC is the native gas token, so this is `eth_getBalance` in 18
 * decimals, not an ERC-20 read. The SDK handles that distinction.
 */
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { DualBalance } from '@upkeep/sdk';
import { upkeep } from '@/lib/upkeep';

const POLL_INTERVAL_MS = 12_000;

export function useUsdcBalance(address?: Address, options?: { refetchInterval?: number }) {
  return useQuery<bigint | null>({
    queryKey: ['usdc-balance', address],
    queryFn: async () => (address ? upkeep.usdc.balanceOf(address) : null),
    enabled: Boolean(address),
    refetchInterval: options?.refetchInterval ?? POLL_INTERVAL_MS,
    staleTime: 6_000,
  });
}

/**
 * Both views of the same balance: the authoritative 18-decimal native figure
 * and the 6-decimal ERC-20 view. Shown side by side on the Wallets page to make
 * Arc's dual-interface USDC legible rather than surprising.
 */
export function useDualUsdcBalance(address?: Address) {
  return useQuery<DualBalance | null>({
    queryKey: ['usdc-dual-balance', address],
    queryFn: async () => (address ? upkeep.usdc.dualBalanceOf(address) : null),
    enabled: Boolean(address),
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: 6_000,
  });
}
