/**
 * Deployed upKEEP contract addresses.
 *
 * Intentionally empty by default. upKEEP will not invent an address and will
 * not pretend to be deployed when it is not: with nothing configured here, the
 * UI shows an explicit "protocol not deployed" state instead of fabricating
 * conditions or executions.
 *
 * Populate after running contracts/script/Deploy.s.sol against Arc Mainnet.
 * The deploy script prints these lines ready to paste.
 */
import { isAddress, type Address } from 'viem';
import { DEFAULT_UPKEEP_FEE_BPS, type UpkeepAddresses } from '@upkeep/sdk';

function readAddress(raw: string | undefined, name: string): Address | undefined {
  const value = raw?.trim();
  if (!value || value === '' || value === '0x') return undefined;
  if (!isAddress(value)) {
    // A malformed address is a configuration error, not something to paper over.
    console.warn(`[upKEEP] Ignoring malformed address in ${name}: ${value}`);
    return undefined;
  }
  return value;
}

export const conditionRegistryAddress = readAddress(
  process.env.NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS,
  'NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS',
);

export const automationExecutorAddress = readAddress(
  process.env.NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS,
  'NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS',
);

export const vaultFactoryAddress = readAddress(
  process.env.NEXT_PUBLIC_VAULT_FACTORY_ADDRESS,
  'NEXT_PUBLIC_VAULT_FACTORY_ADDRESS',
);

/** True only when every contract the app needs has a real configured address. */
export const isProtocolDeployed =
  Boolean(conditionRegistryAddress) &&
  Boolean(automationExecutorAddress) &&
  Boolean(vaultFactoryAddress);

/** The deployed addresses, or null when the protocol is not configured. */
export function getProtocolAddresses(): UpkeepAddresses | null {
  if (!conditionRegistryAddress || !automationExecutorAddress || !vaultFactoryAddress) {
    return null;
  }
  return {
    conditionRegistry: conditionRegistryAddress,
    automationExecutor: automationExecutorAddress,
    vaultFactory: vaultFactoryAddress,
  };
}

/** Which specific variables are missing, for a useful error message. */
export function missingProtocolAddresses(): string[] {
  const missing: string[] = [];
  if (!conditionRegistryAddress) missing.push('NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS');
  if (!automationExecutorAddress) missing.push('NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS');
  if (!vaultFactoryAddress) missing.push('NEXT_PUBLIC_VAULT_FACTORY_ADDRESS');
  return missing;
}

/** Fee rate used for quotes. The vault's immutable rate is what is charged. */
export const upkeepFeeBps = (() => {
  const raw = Number((process.env.NEXT_PUBLIC_UPKEEP_FEE_BPS ?? '').trim());
  return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_UPKEEP_FEE_BPS;
})();

/** Block the protocol was deployed at, so log scans start in the right place. */
export const deployBlock = (() => {
  const raw = process.env.NEXT_PUBLIC_DEPLOY_BLOCK?.trim();
  if (!raw) return undefined;
  try {
    return BigInt(raw);
  } catch {
    return undefined;
  }
})();

/**
 * Demo mode. Off unless explicitly enabled.
 *
 * When on, the UI renders a deterministic sample dataset so the interface can
 * be reviewed without a deployment - and every surface carries a DEMO MODE
 * marker, because demo data must never be mistakable for Arc Mainnet activity.
 */
export const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
