'use client';

/** Live Arc Mainnet RPC status for the sidebar indicator. */
import { useQuery } from '@tanstack/react-query';
import type { NetworkStatus } from '@upkeep/sdk';
import { upkeep } from '@/lib/upkeep';

export function useNetworkStatus() {
  return useQuery<NetworkStatus>({
    queryKey: ['network-status'],
    queryFn: () => upkeep.network.status(),
    refetchInterval: 15_000,
    staleTime: 8_000,
    retry: 1,
  });
}
