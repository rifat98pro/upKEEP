'use client';

/** Execution history, read from Arc Mainnet logs through the SDK. */
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { summarizeExecutions, type Execution } from '@upkeep/sdk';
import { upkeep } from '@/lib/upkeep';
import { isDemoMode, isProtocolDeployed } from '@/config/contracts';
import { demoExecutions } from '@/lib/mock-data';

export interface ExecutionsResult {
  executions: Execution[];
  notDeployed: boolean;
  isDemo: boolean;
  stats: ReturnType<typeof summarizeExecutions>;
}

export function useExecutions(options: { conditionId?: string; recipient?: Address } = {}) {
  return useQuery<ExecutionsResult>({
    queryKey: ['executions', options.conditionId, options.recipient, isDemoMode],
    queryFn: async () => {
      if (isDemoMode) {
        const all = demoExecutions();
        const executions = options.conditionId
          ? all.filter((execution) => execution.conditionId === options.conditionId)
          : all;
        return {
          executions,
          notDeployed: false,
          isDemo: true,
          stats: summarizeExecutions(executions),
        };
      }

      if (!isProtocolDeployed) {
        return { executions: [], notDeployed: true, isDemo: false, stats: summarizeExecutions([]) };
      }

      const executions = await upkeep.executions.list({
        conditionId: options.conditionId,
        recipient: options.recipient,
        limit: 100,
      });

      return {
        executions,
        notDeployed: false,
        isDemo: false,
        stats: summarizeExecutions(executions),
      };
    },
    // Log scans are heavier than a balance read, so poll far less aggressively.
    refetchInterval: 45_000,
    staleTime: 20_000,
  });
}
