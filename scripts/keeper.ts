#!/usr/bin/env tsx
/**
 * The upKEEP keeper.
 *
 * A scheduler, not an oracle. Its whole job is to decide *when* to ask the chain
 * whether a condition is due, and to pay the gas for the transaction if it is.
 * It cannot fabricate a trigger: the predicate is evaluated on-chain by the
 * registry inside the same transaction that moves the funds, so the worst a
 * broken or malicious keeper can do is waste its own gas or fail to act.
 *
 * Usage:
 *   npm run keeper          # poll forever
 *   npm run keeper:once     # a single sweep, for cron or CI
 *
 * Required environment:
 *   KEEPER_PRIVATE_KEY                       the keeper's signing key
 *   NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS
 *   NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS
 *   NEXT_PUBLIC_VAULT_FACTORY_ADDRESS
 *
 * Optional:
 *   ARC_RPC_URL              defaults to the official Arc Mainnet endpoint
 *   UPKEEP_POLL_INTERVAL_MS  defaults to 30000
 *   KEEPER_DRY_RUN=true      evaluate and report, never send a transaction
 *
 * The keeper's key is an operational key that pays gas. It is never given
 * custody of user funds: the vault authorizes the *executor contract*, not this
 * account, and the executor can only perform the one action a user authorized.
 */
import { createWalletClient, http, formatEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createUpkeepClient,
  defineArcChain,
  formatUsd,
  formatUsdPrecise,
  ARC_MAINNET_RPC_URL,
  type EngineDecision,
  type UpkeepClient,
  type VaultInfo,
} from '../packages/sdk/src/index.js';

/*//////////////////////////////////////////////////////////////
                           CONFIGURATION
//////////////////////////////////////////////////////////////*/

const RPC_URL = process.env.ARC_RPC_URL?.trim() || ARC_MAINNET_RPC_URL;
const POLL_INTERVAL_MS = Number(process.env.UPKEEP_POLL_INTERVAL_MS ?? 30_000);
const DRY_RUN = process.env.KEEPER_DRY_RUN === 'true';
const RUN_ONCE = process.argv.includes('--once');

/** Back off after consecutive RPC failures rather than hammering a sick endpoint. */
const MAX_BACKOFF_MS = 5 * 60_000;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalAddress(name: string): Address | undefined {
  const value = process.env[name]?.trim();
  return value && value.startsWith('0x') ? (value as Address) : undefined;
}

/*//////////////////////////////////////////////////////////////
                             LOGGING
//////////////////////////////////////////////////////////////*/

function log(message: string, extra?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  if (extra && Object.keys(extra).length > 0) {
    console.log(`[${timestamp}] ${message}`, extra);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

/*//////////////////////////////////////////////////////////////
                              SWEEP
//////////////////////////////////////////////////////////////*/

interface SweepResult {
  evaluated: number;
  executed: number;
  rearmed: number;
  failed: number;
}

/**
 * One evaluation pass over every condition in the registry.
 *
 * Vault state is fetched once per distinct vault rather than once per condition,
 * because several conditions commonly share one, and an unnecessary RPC round
 * trip per condition is how a poller becomes an abusive client.
 */
async function sweep(upkeep: UpkeepClient, keeper: Address): Promise<SweepResult> {
  const result: SweepResult = { evaluated: 0, executed: 0, rearmed: 0, failed: 0 };

  const views = await upkeep.conditions.listAll();
  result.evaluated = views.length;

  if (views.length === 0) {
    log('No conditions in the registry yet.');
    return result;
  }

  const vaultAddresses = Array.from(
    new Set(views.map((view) => view.action.vault.toLowerCase())),
  ) as Address[];

  const vaults = new Map<string, VaultInfo>();
  await Promise.all(
    vaultAddresses.map(async (address) => {
      try {
        vaults.set(address.toLowerCase(), await upkeep.vaults.get(address));
      } catch (error) {
        log(`Could not read vault ${address}`, { error: describe(error) });
      }
    }),
  );

  const decisions = upkeep.engine.evaluateAll(views, vaults);
  const summary = upkeep.engine.summarize(decisions);

  log(
    `Evaluated ${summary.evaluated} condition(s): ${summary.toExecute.length} due, ${summary.toRearm.length} to re-arm, ${summary.skipped.length} skipped.`,
  );

  // Skips are only interesting when they explain something actionable.
  for (const decision of summary.skipped) {
    if (
      decision.code === 'vault-underfunded' ||
      decision.code === 'vault-paused' ||
      decision.code === 'vault-revoked' ||
      decision.code === 'recipient-mismatch'
    ) {
      log(`  condition ${decision.conditionId}: ${decision.reason}`);
    }
  }

  for (const decision of summary.toRearm) {
    if (await handleRearm(upkeep, decision)) result.rearmed++;
    else result.failed++;
  }

  for (const decision of summary.toExecute) {
    if (await handleExecute(upkeep, decision, keeper)) result.executed++;
    else result.failed++;
  }

  return result;
}

async function handleRearm(upkeep: UpkeepClient, decision: EngineDecision): Promise<boolean> {
  log(`Re-arming condition ${decision.conditionId}: ${decision.reason}`);

  if (DRY_RUN) {
    log('  dry run, not sending');
    return true;
  }

  try {
    const hash = await upkeep.conditions.rearm(decision.conditionId);
    await upkeep.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    log(`  re-armed`, { tx: hash });
    return true;
  } catch (error) {
    log(`  re-arm failed`, { error: describe(error) });
    return false;
  }
}

async function handleExecute(
  upkeep: UpkeepClient,
  decision: EngineDecision,
  keeper: Address,
): Promise<boolean> {
  log(`Condition ${decision.conditionId} is due: ${decision.reason}`);

  /*
   * Simulate against the executor before spending gas. This is the authoritative
   * check - it runs the same on-chain predicate the real call will - so a
   * disagreement between the off-chain engine and this result means the chain
   * wins and we skip.
   */
  let simulation;
  try {
    simulation = await upkeep.executions.simulate(decision.conditionId);
  } catch (error) {
    log(`  simulation failed`, { error: describe(error) });
    return false;
  }

  if (!simulation.executable) {
    log('  the chain says it is not executable right now; skipping.');
    return false;
  }

  log(
    // All three use the precise formatter: at micro amounts formatUsd rounds a
    // real $0.0099 payout to "$0.00", which reads like nothing was sent.
    `  transferring ${formatUsdPrecise(simulation.grossAmount)} (fee ${formatUsdPrecise(simulation.fee)}, recipient receives ${formatUsdPrecise(simulation.netAmount)})`,
  );

  if (DRY_RUN) {
    log('  dry run, not sending');
    return true;
  }

  try {
    const hash = await upkeep.executions.execute(decision.conditionId);
    log(`  submitted`, { tx: hash });

    const receipt = await upkeep.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    if (receipt.status === 'reverted') {
      log(`  REVERTED on-chain`, { tx: hash });
      return false;
    }

    log(`  confirmed in block ${receipt.blockNumber}`, {
      tx: `${upkeep.explorerUrl}/tx/${hash}`,
    });
    return true;
  } catch (error) {
    log(`  execution failed`, { error: describe(error) });
    return false;
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0];
}

/*//////////////////////////////////////////////////////////////
                              MAIN
//////////////////////////////////////////////////////////////*/

async function main() {
  const privateKey = requireEnv('KEEPER_PRIVATE_KEY');
  const account = privateKeyToAccount(
    privateKey.startsWith('0x') ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`),
  );

  const conditionRegistry = optionalAddress('NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS');
  const automationExecutor = optionalAddress('NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS');
  const vaultFactory = optionalAddress('NEXT_PUBLIC_VAULT_FACTORY_ADDRESS');

  if (!conditionRegistry || !automationExecutor || !vaultFactory) {
    console.error('upKEEP contract addresses are not configured. Deploy first, then set:');
    console.error('  NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS');
    console.error('  NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS');
    console.error('  NEXT_PUBLIC_VAULT_FACTORY_ADDRESS');
    process.exit(1);
  }

  const chain = defineArcChain({ rpcUrl: RPC_URL });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  });

  const upkeep = createUpkeepClient({
    chain,
    rpcUrl: RPC_URL,
    addresses: { conditionRegistry, automationExecutor, vaultFactory },
    walletClient,
    account: account.address,
    deployBlock: process.env.NEXT_PUBLIC_DEPLOY_BLOCK
      ? BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK)
      : undefined,
  });

  // Pre-flight: report what we are actually connected to before doing anything.
  const status = await upkeep.network.status();
  if (!status.connected) {
    console.error(`Could not reach the Arc RPC at ${RPC_URL}: ${status.error}`);
    process.exit(1);
  }
  if (status.chainMismatch) {
    console.error(
      `RPC reports chain ${status.chainId}, but this keeper expects ${chain.id}. Refusing to run.`,
    );
    process.exit(1);
  }

  const balance = await upkeep.usdc.balanceOf(account.address);

  log('upKEEP keeper starting');
  log(`  network   : ${chain.name} (${status.chainId})`);
  log(`  rpc       : ${RPC_URL}`);
  log(`  block     : ${status.blockNumber}`);
  log(`  keeper    : ${account.address}`);
  log(`  gas budget: ${formatUsd(balance)} USDC`);
  log(`  registry  : ${conditionRegistry}`);
  log(`  executor  : ${automationExecutor}`);
  log(`  interval  : ${POLL_INTERVAL_MS}ms`);
  if (DRY_RUN) log('  MODE      : DRY RUN, no transactions will be sent');

  if (balance === 0n && !DRY_RUN) {
    log('WARNING: the keeper holds no USDC and cannot pay gas on Arc.');
  }

  if (RUN_ONCE) {
    const result = await sweep(upkeep, account.address);
    log(
      `Sweep complete: ${result.executed} executed, ${result.rearmed} re-armed, ${result.failed} failed.`,
    );
    return;
  }

  let consecutiveFailures = 0;

  // A plain loop rather than setInterval: this way one slow sweep can never
  // overlap the next, which would double-submit while a transaction is pending.
  for (;;) {
    try {
      await sweep(upkeep, account.address);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures++;
      log(`Sweep failed (${consecutiveFailures} in a row)`, { error: describe(error) });
    }

    const backoff =
      consecutiveFailures > 0
        ? Math.min(POLL_INTERVAL_MS * 2 ** consecutiveFailures, MAX_BACKOFF_MS)
        : POLL_INTERVAL_MS;

    if (consecutiveFailures > 0) log(`Backing off for ${backoff}ms`);

    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
}

// Keep the process alive on unexpected rejections; a keeper that dies silently
// is worse than one that logs and retries.
process.on('unhandledRejection', (reason) => {
  log('Unhandled rejection', { error: describe(reason) });
});

main().catch((error) => {
  console.error('Keeper failed to start:', error);
  process.exit(1);
});
