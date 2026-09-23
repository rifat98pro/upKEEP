#!/usr/bin/env tsx
/**
 * Seed a local chain with realistic upKEEP state.
 *
 * Without this, local development only ever shows empty states: you cannot see
 * how a triggered condition, an execution row or a paused vault actually render
 * until something has happened on-chain. This creates one of each, through the
 * public SDK, so the dashboard has real data to display.
 *
 * It is a local development tool. It refuses to run against Arc Mainnet.
 *
 * Usage:
 *   npm run chain                       # terminal 1
 *   npm run contracts:deploy:local      # terminal 2
 *   npm run seed -- <registry> <executor> <factory>
 */
import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ARC_MAINNET_CHAIN_ID,
  createUpkeepClient,
  defineArcChain,
  formatUsd,
  parseUsdc,
} from '../packages/sdk/src/index.js';

const RPC_URL = process.env.SEED_RPC_URL ?? 'http://127.0.0.1:8545';

// Standard anvil development accounts. These keys are public and well known;
// they control nothing on any real network.
const OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const KEEPER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const [registryArg, executorArg, factoryArg] = process.argv.slice(2);

if (!registryArg || !executorArg || !factoryArg) {
  console.error('Usage: npm run seed -- <registry> <executor> <factory>');
  process.exit(1);
}

const chain = defineArcChain({ rpcUrl: RPC_URL });
const raw = createPublicClient({ chain, transport: http(RPC_URL) });

async function setBalance(address: Address, amount: bigint) {
  await raw.request({
    method: 'anvil_setBalance' as never,
    params: [address, `0x${amount.toString(16)}`] as never,
  });
}

async function confirm(hashPromise: Promise<`0x${string}`>) {
  const hash = await hashPromise;
  await raw.waitForTransactionReceipt({ hash });
  return hash;
}

async function main() {
  /*
   * Refuse to touch Mainnet. This script mints balances out of thin air with
   * anvil_setBalance, which is meaningless on a real chain, and it would create
   * live automations with real money if the addresses happened to resolve.
   */
  const liveChainId = await raw.getChainId();
  const isLocal = /127\.0\.0\.1|localhost/.test(RPC_URL);
  if (!isLocal) {
    console.error(`Refusing to seed a non-local RPC (${RPC_URL}). This is a development tool.`);
    process.exit(1);
  }
  if (liveChainId !== ARC_MAINNET_CHAIN_ID) {
    console.warn(`Note: chain id is ${liveChainId}, not ${ARC_MAINNET_CHAIN_ID}.`);
  }

  const ownerAccount = privateKeyToAccount(OWNER_KEY);
  const keeperAccount = privateKeyToAccount(KEEPER_KEY);

  const addresses = {
    conditionRegistry: registryArg as Address,
    automationExecutor: executorArg as Address,
    vaultFactory: factoryArg as Address,
  };

  const owner = createUpkeepClient({
    chain,
    rpcUrl: RPC_URL,
    addresses,
    walletClient: createWalletClient({ account: ownerAccount, chain, transport: http(RPC_URL) }),
  });

  const keeper = createUpkeepClient({
    chain,
    rpcUrl: RPC_URL,
    addresses,
    walletClient: createWalletClient({ account: keeperAccount, chain, transport: http(RPC_URL) }),
  });

  await setBalance(ownerAccount.address, parseUsdc('250000'));
  await setBalance(keeperAccount.address, parseUsdc('10000'));

  const reserve = '0x000000000000000000000000000000000000cafE' as Address;
  const opsWallet = '0x000000000000000000000000000000000000bEEF' as Address;
  const payouts = '0x000000000000000000000000000000000000dEaD' as Address;

  console.log('Seeding upKEEP state');
  console.log(`  rpc   : ${RPC_URL}`);
  console.log(`  owner : ${ownerAccount.address}`);
  console.log('');

  /*//////////////////////////////////////////////////////////////
     1. A healthy, active condition - the ordinary steady state
  //////////////////////////////////////////////////////////////*/

  await setBalance(ownerAccount.address, parseUsdc('250000'));
  const treasuryVault = await owner.vaults.create({
    recipient: reserve,
    maxPerExecution: '1000',
    deposit: '5000',
  });

  await setBalance(opsWallet, parseUsdc('8420'));

  const healthy = await owner.conditions.create({
    wallet: opsWallet,
    type: 'BALANCE_BELOW',
    asset: 'USDC',
    threshold: '5000',
    rearmBuffer: '250',
    vault: treasuryVault.vault!,
    action: { type: 'TRANSFER_USDC', amount: '1000', recipient: reserve },
  });
  console.log(`  condition ${healthy.conditionId}  active, healthy   ($8,420 vs $5,000)`);

  /*//////////////////////////////////////////////////////////////
     2. A condition that has actually fired - gives us a real
        execution row, and a TRIGGERED card awaiting recovery
  //////////////////////////////////////////////////////////////*/

  const firedVault = await owner.vaults.create({
    recipient: payouts,
    maxPerExecution: '500',
    deposit: '2500',
  });

  const settlement = '0x000000000000000000000000000000000000FEeD' as Address;
  await setBalance(settlement, parseUsdc('3000'));

  const fired = await owner.conditions.create({
    wallet: settlement,
    type: 'BALANCE_BELOW',
    asset: 'USDC',
    threshold: '2000',
    rearmBuffer: '100',
    vault: firedVault.vault!,
    action: { type: 'TRANSFER_USDC', amount: '500', recipient: payouts },
  });

  // Drop it below the threshold and let the keeper act, exactly as it would in
  // production - no shortcut that writes state directly.
  await setBalance(settlement, parseUsdc('1740'));
  const execHash = await confirm(keeper.executions.execute(fired.conditionId));
  console.log(`  condition ${fired.conditionId}  triggered         (executed ${execHash.slice(0, 12)}...)`);

  /*//////////////////////////////////////////////////////////////
     3. The opposite direction - same evaluator, different operator,
        so the dashboard shows both balance directions side by side
  //////////////////////////////////////////////////////////////*/

  const payoutVault = await owner.vaults.create({
    recipient: payouts,
    maxPerExecution: '500',
    deposit: '2000',
  });

  const sweepSource = '0x000000000000000000000000000000000000ABcD' as Address;
  await setBalance(sweepSource, parseUsdc('12400'));

  const payout = await owner.conditions.create({
    wallet: sweepSource,
    type: 'BALANCE_ABOVE',
    asset: 'USDC',
    threshold: '10000',
    rearmBuffer: '500',
    vault: payoutVault.vault!,
    action: { type: 'TRANSFER_USDC', amount: '500', recipient: payouts },
  });
  console.log(`  condition ${payout.conditionId}  active, above    ($12,400 vs $10,000)`);

  /*//////////////////////////////////////////////////////////////
     4. A paused condition - so the paused state is visible too
  //////////////////////////////////////////////////////////////*/

  const pausedVault = await owner.vaults.create({
    recipient: reserve,
    maxPerExecution: '2500',
    deposit: '2500',
  });

  const paused = await owner.conditions.create({
    wallet: opsWallet,
    type: 'BALANCE_BELOW',
    asset: 'USDC',
    threshold: '10000',
    recurring: false,
    vault: pausedVault.vault!,
    action: { type: 'TRANSFER_USDC', amount: '2500', recipient: reserve },
  });
  await confirm(owner.conditions.pause(paused.conditionId));
  console.log(`  condition ${paused.conditionId}  paused, one-shot`);

  /*//////////////////////////////////////////////////////////////
                              REPORT
  //////////////////////////////////////////////////////////////*/

  const conditions = await owner.conditions.list(ownerAccount.address);
  const executions = await owner.executions.list({ fromBlock: 0n });

  console.log('');
  console.log(`  ${conditions.length} conditions, ${executions.length} execution(s) on chain`);
  for (const view of conditions) {
    console.log(
      `    #${view.condition.id}  ${view.condition.status.padEnd(9)}  ` +
        `balance ${formatUsd(view.currentValue).padStart(10)}  ` +
        `threshold ${formatUsd(view.condition.threshold)}`,
    );
  }

  console.log('');
  console.log('Point the app at this deployment in .env.local:');
  console.log(`  NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS=${addresses.conditionRegistry}`);
  console.log(`  NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS=${addresses.automationExecutor}`);
  console.log(`  NEXT_PUBLIC_VAULT_FACTORY_ADDRESS=${addresses.vaultFactory}`);
  console.log(`  NEXT_PUBLIC_ARC_RPC_URL=${RPC_URL}`);
  console.log(`  NEXT_PUBLIC_DEPLOY_BLOCK=0`);
  console.log('');
  console.log(`Connect wallet ${ownerAccount.address} to see these conditions.`);
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
