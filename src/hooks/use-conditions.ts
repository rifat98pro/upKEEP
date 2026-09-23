'use client';

/**
 * Conditions, read through @upkeep/sdk.
 *
 * Note there is no bespoke contract code here: these hooks call exactly the
 * same `upkeep.conditions.*` methods any other Arc builder would.
 */
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import {
  ProtocolNotConfiguredError,
  type AuthorizationStatus,
  type ConditionView,
  type VaultInfo,
} from '@upkeep/sdk';
import { upkeep } from '@/lib/upkeep';
import { isDemoMode, isProtocolDeployed } from '@/config/contracts';
import { demoConditionViews, demoVaultInfo } from '@/lib/mock-data';

const POLL_INTERVAL_MS = 15_000;

export interface ConditionsResult {
  conditions: ConditionView[];
  /** True when this build has no configured deployment. */
  notDeployed: boolean;
  isDemo: boolean;
}

export function useConditions(owner?: Address) {
  return useQuery<ConditionsResult>({
    queryKey: ['conditions', owner, isDemoMode],
    queryFn: async () => {
      if (isDemoMode) {
        return { conditions: demoConditionViews(), notDeployed: false, isDemo: true };
      }
      if (!isProtocolDeployed) {
        return { conditions: [], notDeployed: true, isDemo: false };
      }
      if (!owner) {
        return { conditions: [], notDeployed: false, isDemo: false };
      }

      try {
        return { conditions: await upkeep.conditions.list(owner), notDeployed: false, isDemo: false };
      } catch (error) {
        if (error instanceof ProtocolNotConfiguredError) {
          return { conditions: [], notDeployed: true, isDemo: false };
        }
        throw error;
      }
    },
    enabled: isDemoMode || !isProtocolDeployed || Boolean(owner),
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export function useCondition(conditionId?: string) {
  return useQuery<ConditionView | null>({
    queryKey: ['condition', conditionId, isDemoMode],
    queryFn: async () => {
      if (!conditionId) return null;

      if (isDemoMode) {
        return demoConditionViews().find((view) => view.condition.id === conditionId) ?? null;
      }
      if (!isProtocolDeployed) return null;

      return upkeep.conditions.get(conditionId);
    },
    enabled: Boolean(conditionId),
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export function useVaultInfo(vault?: Address) {
  return useQuery<VaultInfo | null>({
    queryKey: ['vault', vault, isDemoMode],
    queryFn: async () => {
      if (!vault) return null;
      if (isDemoMode) return demoVaultInfo(vault);
      return upkeep.vaults.get(vault);
    },
    enabled: Boolean(vault),
    refetchInterval: POLL_INTERVAL_MS,
  });
}

/** Vaults the connected wallet has created through the factory. */
export function useVaults(owner?: Address) {
  return useQuery<Address[]>({
    queryKey: ['vaults', owner, isDemoMode],
    queryFn: async () => {
      if (isDemoMode) return [demoConditionViews()[0].action.vault];
      if (!owner || !isProtocolDeployed) return [];
      return upkeep.vaults.listFor(owner);
    },
    enabled: isDemoMode || Boolean(owner),
    refetchInterval: 30_000,
  });
}

/**
 * The authorization scheme a vault currently uses.
 *
 * Read through the same SDK as everything else; the dashboard has no privileged
 * view of the authorization layer.
 */
export function useVaultAuthorization(vault?: Address) {
  return useQuery<AuthorizationStatus | null>({
    queryKey: ['vault-authorization', vault, isDemoMode],
    queryFn: async () => {
      if (!vault) return null;
      if (isDemoMode) {
        return {
          label: 'Executor authorization (built-in)',
          migrationRequired: false,
          providerConfigured: false,
        };
      }
      return upkeep.vaults.authorization(vault);
    },
    enabled: Boolean(vault),
    staleTime: 60_000,
  });
}
