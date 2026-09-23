/**
 * The upKEEP client.
 *
 * This is the product surface: everything upKEEP can do is reachable from here,
 * and the reference dashboard uses exactly this API rather than a private one.
 *
 *   import { createUpkeepClient } from '@upkeep/sdk';
 *
 *   const upkeep = createUpkeepClient({
 *     addresses: { conditionRegistry, automationExecutor, vaultFactory },
 *     walletClient,               // omit for a read-only client
 *   });
 *
 *   const condition = await upkeep.conditions.create({
 *     wallet: treasury,
 *     type: 'BALANCE_BELOW',
 *     asset: 'USDC',
 *     threshold: '5000',
 *     action: { type: 'TRANSFER_USDC', amount: '1000', recipient: reserveWallet },
 *   });
 */
import {
  createPublicClient,
  http,
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { ARC_MAINNET_EXPLORER_URL, ARC_MAINNET_RPC_URL, arcMainnet } from './config/chains.js';
import { DEFAULT_UPKEEP_FEE_BPS } from './config/fees.js';
import { ProtocolNotConfiguredError } from './errors.js';
import { createConditionsApi, type ConditionsApi } from './conditions.js';
import { createVaultsApi, type VaultsApi } from './vaults.js';
import { createExecutionsApi, type ExecutionsApi } from './executions.js';
import { createUsdcApi, type UsdcApi } from './usdc-api.js';
import { createNetworkApi, type NetworkApi } from './network.js';
import { computeFeeBreakdown, type FeeBreakdown } from './core/fee.js';
import {
  availableActionTypes,
  availableConditionTypes,
  PLANNED_ACTION_TYPES,
  PLANNED_CONDITION_TYPES,
  type ActionTypeDefinition,
  type ConditionTypeDefinition,
} from './core/kinds.js';
import { evaluateCondition, evaluateConditions, summarizeDecisions } from './core/engine.js';

/** Deployed contract addresses for an upKEEP protocol instance. */
export interface UpkeepAddresses {
  conditionRegistry: Address;
  automationExecutor: Address;
  vaultFactory: Address;
}

export interface UpkeepConfig {
  /**
   * Deployed contract addresses.
   *
   * Omit to build a client that can still read Arc (balances, network status)
   * but refuses protocol calls with ProtocolNotConfiguredError, rather than
   * reading address zero and reporting nonsense.
   */
  addresses?: Partial<UpkeepAddresses>;
  /** Defaults to Arc Mainnet. */
  chain?: Chain;
  /** Defaults to the official Arc Mainnet endpoint. */
  rpcUrl?: string;
  /** Supply your own client to control transport, batching or caching. */
  publicClient?: PublicClient;
  /** Required for any write. Without it the client is read-only. */
  walletClient?: WalletClient;
  /** Defaults to the wallet client's account. */
  account?: Account | Address;
  explorerUrl?: string;
  /** Rate used for quotes. The vault's immutable rate is what is actually charged. */
  feeBps?: number;
  /** Block the protocol was deployed at, so log scans start in the right place. */
  deployBlock?: bigint;
}

export interface UpkeepClient {
  readonly chain: Chain;
  readonly publicClient: PublicClient;
  readonly walletClient?: WalletClient;
  readonly account?: Address;
  readonly explorerUrl: string;
  readonly feeBps: number;
  /** Null when the client was built without deployed addresses. */
  readonly addresses: UpkeepAddresses | null;
  /** True when protocol calls are possible. */
  readonly isConfigured: boolean;
  /** True when writes are possible. */
  readonly canWrite: boolean;

  conditions: ConditionsApi;
  vaults: VaultsApi;
  executions: ExecutionsApi;
  usdc: UsdcApi;
  network: NetworkApi;

  /** Fee quoting. Deterministic integer math, identical to the contract. */
  fees: {
    quote: (amount: bigint, feeBps?: number) => FeeBreakdown;
  };

  /**
   * The engine catalog and its pure evaluation logic.
   *
   * `conditionTypes()` lists what V1 enables; `plannedConditionTypes()` lists
   * what is designed for but not implemented, so a UI can show direction
   * without implying any of it works.
   */
  engine: {
    conditionTypes: () => ConditionTypeDefinition[];
    actionTypes: () => ActionTypeDefinition[];
    plannedConditionTypes: () => typeof PLANNED_CONDITION_TYPES;
    plannedActionTypes: () => typeof PLANNED_ACTION_TYPES;
    evaluate: typeof evaluateCondition;
    evaluateAll: typeof evaluateConditions;
    summarize: typeof summarizeDecisions;
  };
}

/** Internal context handed to each API module. */
export interface UpkeepContext {
  chain: Chain;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Address;
  explorerUrl: string;
  feeBps: number;
  deployBlock?: bigint;
  /** Throws ProtocolNotConfiguredError when addresses are missing. */
  requireAddresses: () => UpkeepAddresses;
  addresses: UpkeepAddresses | null;
}

function resolveAddresses(partial?: Partial<UpkeepAddresses>): {
  addresses: UpkeepAddresses | null;
  missing: string[];
} {
  const missing: string[] = [];
  if (!partial?.conditionRegistry) missing.push('conditionRegistry');
  if (!partial?.automationExecutor) missing.push('automationExecutor');
  if (!partial?.vaultFactory) missing.push('vaultFactory');

  if (missing.length > 0) return { addresses: null, missing };

  return {
    addresses: {
      conditionRegistry: partial!.conditionRegistry!,
      automationExecutor: partial!.automationExecutor!,
      vaultFactory: partial!.vaultFactory!,
    },
    missing,
  };
}

export function createUpkeepClient(config: UpkeepConfig = {}): UpkeepClient {
  const chain = config.chain ?? arcMainnet;

  const publicClient =
    config.publicClient ??
    (createPublicClient({
      chain,
      transport: http(config.rpcUrl ?? chain.rpcUrls.default.http[0] ?? ARC_MAINNET_RPC_URL, {
        batch: true,
        retryCount: 2,
        retryDelay: 400,
        timeout: 20_000,
      }),
    }) as PublicClient);

  const account =
    (typeof config.account === 'string' ? config.account : config.account?.address) ??
    config.walletClient?.account?.address;

  const { addresses, missing } = resolveAddresses(config.addresses);

  const context: UpkeepContext = {
    chain,
    publicClient,
    walletClient: config.walletClient,
    account,
    explorerUrl: config.explorerUrl ?? ARC_MAINNET_EXPLORER_URL,
    feeBps: config.feeBps ?? DEFAULT_UPKEEP_FEE_BPS,
    deployBlock: config.deployBlock,
    addresses,
    requireAddresses: () => {
      if (!addresses) throw new ProtocolNotConfiguredError(missing);
      return addresses;
    },
  };

  return {
    chain,
    publicClient,
    walletClient: config.walletClient,
    account,
    explorerUrl: context.explorerUrl,
    feeBps: context.feeBps,
    addresses,
    isConfigured: addresses !== null,
    canWrite: Boolean(config.walletClient && account),

    conditions: createConditionsApi(context),
    vaults: createVaultsApi(context),
    executions: createExecutionsApi(context),
    usdc: createUsdcApi(context),
    network: createNetworkApi(context),

    fees: {
      quote: (amount, feeBps) => computeFeeBreakdown(amount, feeBps ?? context.feeBps),
    },

    engine: {
      conditionTypes: availableConditionTypes,
      actionTypes: availableActionTypes,
      plannedConditionTypes: () => PLANNED_CONDITION_TYPES,
      plannedActionTypes: () => PLANNED_ACTION_TYPES,
      evaluate: evaluateCondition,
      evaluateAll: evaluateConditions,
      summarize: summarizeDecisions,
    },
  };
}
