#!/usr/bin/env tsx
/**
 * Set up the first Mainnet demonstration, at deliberately tiny amounts.
 *
 * The point of this script is to remove fat-finger risk. Typing amounts into a
 * form on a live chain is exactly where a $0.01 demo becomes a $1,000 one, so
 * the figures here are fixed, printed for confirmation, and bounded by a hard
 * ceiling the script refuses to exceed.
 *
 *   $0.10  threshold      the monitored wallet must fall below this
 *   $0.01  per execution  what actually moves
 *   $0.05  vault deposit  the total at risk, ever
 *
 * At this size the 1% fee ceiling applies, so upKEEP charges $0.0001 rather
 * than the $0.001 minimum.
 *
 * Usage:
 *   npm run demo:micro -- --recipient 0x... [--wallet 0x...] [--dry-run]
 *
 * Reads DEPLOYER_PRIVATE_KEY (or DEMO_PRIVATE_KEY) to sign. That key owns the
 * vault and can withdraw from it at any time.
 */
import { createWalletClient, http, isAddress, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_RPC_URL,
  createUpkeepClient,
  defineArcChain,
  formatUsd,
  formatUsdPrecise,
  parseUsdc,
} from '../packages/sdk/src/index.js';

/*//////////////////////////////////////////////////////////////
                         THE DEMO NUMBERS
//////////////////////////////////////////////////////////////*/

const THRESHOLD = '0.10';
const AMOUNT = '0.01';
const DEPOSIT = '0.05';

/**
 * A hard ceiling on anything this script will ever authorize.
 *
 * Not a guess at what is affordable - a refusal to be repurposed. If you want
 * to automate real money, use the app, where the permission review shows you
 * exactly what you are signing.
 */
const MAX_TOTAL_AT_RISK = parseUsdc('1');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  console.error(`Set one of: ${names.join(', ')}`);
  process.exit(1);
}

function address(raw: string | undefined, label: string): Address {
  if (!raw || !isAddress(raw)) {
    console.error(`${label} must be a valid address (got: ${raw ?? 'nothing'})`);
    process.exit(1);
  }
  return raw;
}

async function main() {
  const rpcUrl = process.env.ARC_RPC_URL?.trim() || ARC_MAINNET_RPC_URL;
  const chain = defineArcChain({ rpcUrl });

  const registry = address(process.env.NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS, 'Registry address');
  const executor = address(process.env.NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS, 'Executor address');
  const factory = address(process.env.NEXT_PUBLIC_VAULT_FACTORY_ADDRESS, 'Vault factory address');

  const recipient = address(flag('--recipient'), '--recipient');

  const key = requireEnv('DEMO_PRIVATE_KEY', 'DEPLOYER_PRIVATE_KEY');
  const account = privateKeyToAccount(
    (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`,
  );

  // Default to watching the signing wallet, which is the usual demo shape.
  const monitored = flag('--wallet') ? address(flag('--wallet'), '--wallet') : account.address;

  if (monitored.toLowerCase() === recipient.toLowerCase()) {
    console.error('The recipient must differ from the monitored wallet.');
    process.exit(1);
  }

  const deposit = parseUsdc(DEPOSIT);
  if (deposit > MAX_TOTAL_AT_RISK) {
    console.error('Refusing: this script is capped at $1 of total exposure.');
    process.exit(1);
  }

  const upkeep = createUpkeepClient({
    chain,
    rpcUrl,
    addresses: { conditionRegistry: registry, automationExecutor: executor, vaultFactory: factory },
    walletClient: createWalletClient({ account, chain, transport: http(rpcUrl) }),
  });

  /*//////////////////////////////////////////////////////////////
                            PRE-FLIGHT
  //////////////////////////////////////////////////////////////*/

  const status = await upkeep.network.status();
  if (!status.connected) {
    console.error(`Cannot reach ${rpcUrl}: ${status.error}`);
    process.exit(1);
  }

  const balance = await upkeep.usdc.balanceOf(account.address);
  const quote = upkeep.fees.quote(parseUsdc(AMOUNT));

  const onMainnet = status.chainId === ARC_MAINNET_CHAIN_ID;

  console.log('upKEEP first-execution demo');
  console.log('');
  console.log(`  network         : ${chain.name} (chain ${status.chainId})${onMainnet ? '  REAL FUNDS' : ''}`);
  console.log(`  block           : ${status.blockNumber}`);
  console.log(`  signer          : ${account.address}`);
  console.log(`  signer balance  : ${formatUsd(balance)} USDC`);
  console.log('');
  console.log(`  monitored wallet: ${monitored}`);
  console.log(`  threshold       : ${formatUsd(parseUsdc(THRESHOLD))}`);
  console.log(`  transfer amount : ${formatUsd(parseUsdc(AMOUNT))}`);
  console.log(`  recipient       : ${recipient}`);
  console.log(`  vault deposit   : ${formatUsd(deposit)}   <- the most you can lose`);
  console.log('');
  console.log(`  upKEEP fee      : ${formatUsdPrecise(quote.fee)}${quote.capApplied ? '  (1% ceiling applied)' : ''}`);
  console.log(`  recipient gets  : ${formatUsdPrecise(quote.netAmount)}`);
  console.log('');

  if (balance < deposit) {
    console.error(`Signer holds ${formatUsd(balance)} but needs at least ${formatUsd(deposit)} plus gas.`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('Dry run. Nothing was sent. Drop --dry-run to create it.');
    return;
  }

  /*//////////////////////////////////////////////////////////////
                            CREATE IT
  //////////////////////////////////////////////////////////////*/

  console.log('1/2  Deploying and funding the vault...');
  const { vault, transactionHash: vaultTx } = await upkeep.vaults.create({
    recipient,
    maxPerExecution: AMOUNT,
    deposit: DEPOSIT,
  });

  if (!vault) {
    console.error('The vault transaction did not confirm. Nothing further was attempted.');
    process.exit(1);
  }
  console.log(`     vault ${vault}`);
  console.log(`     ${upkeep.explorerUrl}/tx/${vaultTx}`);

  console.log('2/2  Creating the condition...');
  const condition = await upkeep.conditions.create({
    wallet: monitored,
    type: 'BALANCE_BELOW',
    asset: 'USDC',
    threshold: THRESHOLD,
    vault,
    action: { type: 'TRANSFER_USDC', amount: AMOUNT, recipient },
  });

  console.log(`     condition #${condition.conditionId}`);
  console.log(`     ${condition.explorerUrl}`);

  /*//////////////////////////////////////////////////////////////
                             NEXT STEPS
  //////////////////////////////////////////////////////////////*/

  const view = await upkeep.conditions.get(condition.conditionId);

  console.log('');
  console.log(`Condition #${condition.conditionId} is ${view.condition.status}.`);
  console.log(`Monitored balance is ${formatUsd(view.currentValue)}, threshold ${formatUsd(view.condition.threshold)}.`);
  console.log('');

  if (view.executable) {
    console.log('It is already below the threshold and due to fire. Run the keeper:');
  } else {
    console.log(`To trigger it, move USDC out of ${monitored} until it holds under ${formatUsd(parseUsdc(THRESHOLD))}.`);
    console.log('Then run the keeper:');
  }

  console.log('');
  console.log('  KEEPER_DRY_RUN=true npm run keeper:once   # see what it decides');
  console.log('  npm run keeper:once                       # actually execute');
  console.log('');
  console.log(`Withdraw at any time - the deposit stays yours:`);
  console.log(`  the Wallets page, or upkeep.vaults.withdrawAll('${vault}')`);
}

main().catch((error) => {
  console.error('\nDemo setup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
