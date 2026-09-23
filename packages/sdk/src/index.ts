/**
 * @upkeep/sdk
 *
 * Persistent financial conditions for Arc.
 *
 * upKEEP is a condition engine: you describe a financial condition once, bind it
 * to one constrained action, and it keeps evaluating on Arc Mainnet until it is
 * true. Balance Guard - "if USDC balance falls below X, transfer Y to an
 * approved reserve" - is the first condition type built on it, not the product.
 *
 * Quick start:
 *
 *   import { createUpkeepClient } from '@upkeep/sdk';
 *
 *   const upkeep = createUpkeepClient({
 *     addresses: { conditionRegistry, automationExecutor, vaultFactory },
 *     walletClient,
 *   });
 *
 *   // 1. Grant a bounded permission.
 *   const { vault } = await upkeep.vaults.create({
 *     recipient: reserveWallet,
 *     maxPerExecution: '1000',
 *     deposit: '5000',
 *   });
 *
 *   // 2. Describe the condition.
 *   const condition = await upkeep.conditions.create({
 *     wallet: treasury,
 *     type: 'BALANCE_BELOW',
 *     asset: 'USDC',
 *     threshold: '5000',
 *     vault,
 *     action: { type: 'TRANSFER_USDC', amount: '1000', recipient: reserveWallet },
 *   });
 *
 * Note on amounts: pass money as a string ("1000.50") or a bigint of 18-decimal
 * native wei. A JS `number` is rejected, because it cannot represent every USDC
 * amount exactly and money must never round by accident.
 */

/*//////////////////////////////////////////////////////////////
                              CLIENT
//////////////////////////////////////////////////////////////*/

export { createUpkeepClient } from './client.js';
export type { UpkeepClient, UpkeepConfig, UpkeepAddresses, UpkeepContext } from './client.js';

/*//////////////////////////////////////////////////////////////
                               APIS
//////////////////////////////////////////////////////////////*/

export type { ConditionsApi, CreateConditionInput, CreateConditionResult } from './conditions.js';
export type { VaultsApi, CreateVaultInput } from './vaults.js';
export type {
  ExecutionsApi,
  ListExecutionsOptions,
  SimulationResult,
  ExecutionStats,
} from './executions.js';
export { summarizeExecutions } from './executions.js';
export type { UsdcApi } from './usdc-api.js';
export type { NetworkApi } from './network.js';

/*//////////////////////////////////////////////////////////////
                            THE ENGINE
//////////////////////////////////////////////////////////////*/

export {
  CONDITION_TYPES,
  ACTION_TYPES,
  PLANNED_CONDITION_TYPES,
  PLANNED_ACTION_TYPES,
  availableConditionTypes,
  availableActionTypes,
  getConditionType,
  getActionType,
  conditionTypeFor,
  actionTypeFor,
  KIND_BALANCE_THRESHOLD,
  ACTION_TRANSFER_USDC,
  OP_LT,
  OP_GT,
} from './core/kinds.js';
export type {
  ConditionTypeName,
  ActionTypeName,
  ConditionTypeDefinition,
  ActionTypeDefinition,
} from './core/kinds.js';

export {
  evaluateCondition,
  evaluateConditions,
  summarizeDecisions,
} from './core/engine.js';

/*//////////////////////////////////////////////////////////////
                       AUTHORIZATION LAYER
//////////////////////////////////////////////////////////////*/

export {
  AUTHORIZATION_SCHEMES,
  AUTHORIZATION_COPY,
  ARC_PQ,
  EXECUTOR_SCHEME_ID,
  SLH_DSA_SCHEME_ID,
  SMART_ACCOUNT_SCHEME_ID,
  getAuthorizationScheme,
  availableAuthorizationSchemes,
  futureAuthorizationSchemes,
} from './core/authorization.js';
export type {
  AuthorizationScheme,
  AuthorizationSchemeStatus,
  AuthorizationStatus,
  SecurityPolicy,
} from './core/authorization.js';
export { bytes32ToString } from './vaults.js';
export type {
  EngineDecision,
  DecisionKind,
  DecisionCode,
  EvaluationSummary,
} from './core/engine.js';

/*//////////////////////////////////////////////////////////////
                              MONEY
//////////////////////////////////////////////////////////////*/

export { computeFee, computeFeeBreakdown } from './core/fee.js';
export type { FeeBreakdown } from './core/fee.js';

export {
  parseUsdc,
  toUsdcWei,
  formatUsdc,
  formatUsd,
  formatUsdPrecise,
  nativeToErc20,
  erc20ToNative,
  isErc20Representable,
} from './core/units.js';

export {
  DEFAULT_UPKEEP_FEE_BPS,
  BPS_DENOMINATOR,
  UPKEEP_MIN_FEE_WEI,
  UPKEEP_MAX_EFFECTIVE_FEE_BPS,
  UPKEEP_MAX_CONFIGURABLE_FEE_BPS,
} from './config/fees.js';

/*//////////////////////////////////////////////////////////////
                               ARC
//////////////////////////////////////////////////////////////*/

export {
  arcMainnet,
  defineArcChain,
  explorerTxUrl,
  explorerAddressUrl,
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_RPC_URL,
  ARC_MAINNET_WS_URL,
  ARC_MAINNET_EXPLORER_URL,
  ARC_MIN_BASE_FEE_WEI,
  ARC_DEFAULT_PRIORITY_FEE_WEI,
} from './config/chains.js';

export {
  USDC,
  USDC_ERC20_ADDRESS,
  USDC_NATIVE_DECIMALS,
  USDC_ERC20_DECIMALS,
  NATIVE_TO_ERC20_SCALE,
  SUPPORTED_ASSETS,
} from './config/tokens.js';
export type { SupportedAsset } from './config/tokens.js';

export { getUsdcBalance, getUsdcBalances, getUsdcErc20Balance, getDualBalance } from './arc/usdc.js';
export type { DualBalance } from './arc/usdc.js';

export { arcFeeParams, sendArcTransaction } from './tx.js';
export type { ArcTransactionRequest } from './tx.js';

/*//////////////////////////////////////////////////////////////
                          TYPES AND ERRORS
//////////////////////////////////////////////////////////////*/

export type {
  Condition,
  ConditionView,
  ConditionStatus,
  ArmState,
  Action,
  Execution,
  ExecutionStatus,
  VaultInfo,
  NetworkStatus,
} from './core/types.js';
export { CONDITION_STATUS_BY_ORDINAL, ARM_STATE_BY_ORDINAL } from './core/types.js';

export {
  UpkeepError,
  ProtocolNotConfiguredError,
  WalletRequiredError,
  UnsupportedTypeError,
  ValidationError,
} from './errors.js';

export {
  conditionRegistryAbi,
  automationExecutorAbi,
  automationVaultAbi,
  automationVaultFactoryAbi,
  balanceThresholdEvaluatorAbi,
} from './abi.js';
