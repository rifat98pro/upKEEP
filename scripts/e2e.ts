#!/usr/bin/env tsx
/**
 * End-to-end verification of the complete upKEEP flow.
 *
 * Runs the whole product against a local chain pinned to Arc's chain id, through
 * the public SDK - the same API the dashboard and any third party would use.
 * Nothing here reaches past the SDK into contract internals.
 *
 * A local chain rather than a fork, deliberately: the contracts only depend on
 * native USDC balances, which a local node models exactly, and forking the
 * public Arc endpoint hits its rate limit as soon as anvil lazily fetches state
 * for a new account. Use --fork-url against a private endpoint if you want to
 * exercise real Arc state as well.
 *
 * What it proves:
 *   1. a vault can be created and funded
 *   2. a condition can be created and is stored on-chain
 *   3. a healthy balance does not fire
 *   4. a balance below the threshold fires exactly one real transaction
 *   5. the fee split matches the quote exactly
 *   6. polling again does NOT fire a second time (the anti-drain property)
 *   7. recovery re-arms the condition
 *   8. the next dip fires again, with a fresh execution id
 *   9. the owner's pause and revoke controls actually stop execution
 *
 * Setup:
 *   anvil --fork-url https://rpc.mainnet.arc.io --port 8545
 *   cd contracts && forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url http://127.0.0.1:8545 --broadcast
 *
 * Then:
 *   npx tsx scripts/e2e.ts <registry> <executor> <factory>
 */
import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createUpkeepClient,
  defineArcChain,
  formatUsd,
  formatUsdPrecise,
  parseUsdc,
} from '../packages/sdk/src/index.js';

const RPC_URL = process.env.E2E_RPC_URL ?? 'http://127.0.0.1:8545';

// Standard anvil development accounts. These keys are public and well known;
// they exist only in a local fork and control nothing on any real network.
const OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const KEEPER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const TREASURY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

const [registryArg, executorArg, factoryArg, deployBlockArg] = process.argv.slice(2);

if (!registryArg || !executorArg || !factoryArg) {
  console.error('Usage: npx tsx scripts/e2e.ts <registry> <executor> <factory> [deployBlock]');
  process.exit(1);
}

const addresses = {
  conditionRegistry: registryArg as Address,
  automationExecutor: executorArg as Address,
  vaultFactory: factoryArg as Address,
};

/*//////////////////////////////////////////////////////////////
                             HARNESS
//////////////////////////////////////////////////////////////*/

let checks = 0;
let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`);
  }
}

function step(title: string) {
  console.log(`\n${title}`);
}

/**
 * Log scans start here. A fork sits at Arc's real height (~22M), so scanning
 * from block 0 would mean thousands of chunked getLogs calls for nothing.
 */
const deployBlock = deployBlockArg ? BigInt(deployBlockArg) : 0n;

const chain = defineArcChain({ rpcUrl: RPC_URL });
const raw = createPublicClient({ chain, transport: http(RPC_URL) });

/** Await a transaction that the SDK returned as a bare hash. */
async function confirm(hashPromise: Promise<`0x${string}`>) {
  const hash = await hashPromise;
  await raw.waitForTransactionReceipt({ hash });
  return hash;
}

/** Set a balance on the fork, to simulate the treasury moving. */
async function setBalance(address: Address, amount: bigint) {
  await raw.request({
    method: 'anvil_setBalance' as never,
    params: [address, `0x${amount.toString(16)}`] as never,
  });
}

async function main() {
  const ownerAccount = privateKeyToAccount(OWNER_KEY);
  const keeperAccount = privateKeyToAccount(KEEPER_KEY);

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

  // A dedicated wallet to monitor, so the test controls its balance precisely.
  const treasuryWallet = '0x000000000000000000000000000000000000bEEF' as Address;
  const reserveWallet = '0x000000000000000000000000000000000000cafE' as Address;

  const THRESHOLD = '5000';
  const TRANSFER = '1000';
  const REARM_BUFFER = '250';

  console.log('upKEEP end-to-end verification');
  console.log(`RPC     : ${RPC_URL}`);
  console.log(`Owner   : ${ownerAccount.address}`);
  console.log(`Keeper  : ${keeperAccount.address}`);

  const status = await owner.network.status();
  check('Chain id matches Arc Mainnet', status.chainId === 5042, `chain ${status.chainId}`);

  // Fund the actors deterministically so the run is repeatable against a fork
  // that previous runs may already have spent from.
  await setBalance(ownerAccount.address, parseUsdc('100000'));
  await setBalance(keeperAccount.address, parseUsdc('10000'));
  await setBalance(TREASURY, 0n);

  /*//////////////////////////////////////////////////////////////
                      1. GRANT A BOUNDED PERMISSION
  //////////////////////////////////////////////////////////////*/

  step('1. Create and fund the automation vault');

  const { vault, transactionHash: vaultTx } = await owner.vaults.create({
    recipient: reserveWallet,
    maxPerExecution: TRANSFER,
    deposit: '5000',
  });

  check('Vault deployed', Boolean(vault), vault);
  check('Vault creation produced a transaction', Boolean(vaultTx), vaultTx);

  const vaultInfo = await owner.vaults.get(vault!);
  check('Owner is the creator', vaultInfo.owner === ownerAccount.address);
  check('Recipient is pinned', vaultInfo.recipient === reserveWallet);
  check('Ceiling is set', vaultInfo.maxPerExecution === parseUsdc(TRANSFER));
  check('Vault is funded', vaultInfo.balance === parseUsdc('5000'), formatUsd(vaultInfo.balance));
  check('Automation is armed', !vaultInfo.paused && !vaultInfo.revoked);

  /*//////////////////////////////////////////////////////////////
                        2. DEFINE THE CONDITION
  //////////////////////////////////////////////////////////////*/

  step('2. Create the condition');

  // Start the treasury healthy, above the threshold.
  await setBalance(treasuryWallet, parseUsdc('8420'));

  const created = await owner.conditions.create({
    wallet: treasuryWallet,
    type: 'BALANCE_BELOW',
    asset: 'USDC',
    threshold: THRESHOLD,
    rearmBuffer: REARM_BUFFER,
    vault: vault!,
    action: {
      type: 'TRANSFER_USDC',
      amount: TRANSFER,
      recipient: reserveWallet,
    },
  });

  check('Condition created', Boolean(created.conditionId), `id ${created.conditionId}`);
  check('Transaction hash returned', created.transactionHash.startsWith('0x'));

  const view = await owner.conditions.get(created.conditionId);
  check('Status is active', view.condition.status === 'active');
  check('Condition is armed', view.condition.arm === 'armed');
  check('Type resolves to BALANCE_BELOW', view.condition.type === 'BALANCE_BELOW');
  check('Threshold stored exactly', view.condition.threshold === parseUsdc(THRESHOLD));
  check(
    'Live balance read from chain',
    view.currentValue === parseUsdc('8420'),
    formatUsd(view.currentValue),
  );
  check(
    'Distance to trigger is correct',
    view.distanceToTrigger === parseUsdc('3420'),
    formatUsd(view.distanceToTrigger),
  );

  /*//////////////////////////////////////////////////////////////
                    3. A HEALTHY BALANCE MUST NOT FIRE
  //////////////////////////////////////////////////////////////*/

  step('3. A healthy balance does not fire');

  check('Not executable while healthy', !view.executable);

  const healthySim = await keeper.executions.simulate(created.conditionId);
  check('Simulation agrees it is not due', !healthySim.executable);

  const healthyDecision = keeper.engine.evaluate(view, vaultInfo);
  check('Engine decides to skip', healthyDecision.kind === 'skip', healthyDecision.code);

  /*//////////////////////////////////////////////////////////////
                      4. THE CONDITION BECOMES TRUE
  //////////////////////////////////////////////////////////////*/

  step('4. Balance falls below the threshold');

  await setBalance(treasuryWallet, parseUsdc('4200'));

  const dueView = await owner.conditions.get(created.conditionId);
  check('Now executable', dueView.executable, formatUsd(dueView.currentValue));

  const quote = await keeper.executions.simulate(created.conditionId);
  check('Simulation says executable', quote.executable);
  check('Quoted amount', quote.grossAmount === parseUsdc('1000'), formatUsd(quote.grossAmount));
  check('Quoted fee is $0.50', quote.fee === parseUsdc('0.50'), formatUsdPrecise(quote.fee));
  check('Quoted net is $999.50', quote.netAmount === parseUsdc('999.50'));

  const uiQuote = owner.fees.quote(quote.grossAmount);
  check('UI quote matches the chain exactly', uiQuote.fee === quote.fee && uiQuote.netAmount === quote.netAmount);

  /*//////////////////////////////////////////////////////////////
                           5. EXECUTION
  //////////////////////////////////////////////////////////////*/

  step('5. Keeper executes');

  const recipientBefore = await owner.usdc.balanceOf(reserveWallet);
  const treasuryBefore = await owner.usdc.balanceOf(TREASURY);

  const execTx = await keeper.executions.execute(created.conditionId);
  const receipt = await raw.waitForTransactionReceipt({ hash: execTx });

  check('Execution transaction succeeded', receipt.status === 'success', execTx);

  const recipientAfter = await owner.usdc.balanceOf(reserveWallet);
  const treasuryAfter = await owner.usdc.balanceOf(TREASURY);

  check(
    'Recipient received exactly $999.50',
    recipientAfter - recipientBefore === parseUsdc('999.50'),
    formatUsd(recipientAfter - recipientBefore),
  );
  check(
    'Treasury received exactly $0.50',
    treasuryAfter - treasuryBefore === parseUsdc('0.50'),
    formatUsdPrecise(treasuryAfter - treasuryBefore),
  );

  const afterVault = await owner.vaults.get(vault!);
  check(
    'Vault debited by the gross amount',
    vaultInfo.balance - afterVault.balance === parseUsdc('1000'),
  );

  const executions = await owner.executions.list({ fromBlock: deployBlock });
  check('Execution readable from chain logs', executions.length === 1, `${executions.length} found (needs a fresh chain)`);
  check('Logged amount matches', executions[0]?.amount === parseUsdc('1000'));
  check('Logged fee matches', executions[0]?.fee === parseUsdc('0.50'));
  check('Logged tx hash matches', executions[0]?.transactionHash === execTx);

  const firedView = await owner.conditions.get(created.conditionId);
  check('Status moved to triggered', firedView.condition.status === 'triggered');
  check('Condition latched as fired', firedView.condition.arm === 'fired');
  check('Trigger count is 1', firedView.condition.triggerCount === 1);

  /*//////////////////////////////////////////////////////////////
              6. THE ANTI-DRAIN PROPERTY (the headline)
  //////////////////////////////////////////////////////////////*/

  step('6. Repeated polling must NOT execute again');

  const balanceBeforePolling = (await owner.vaults.get(vault!)).balance;
  let secondExecution = false;

  for (let i = 0; i < 5; i++) {
    const sim = await keeper.executions.simulate(created.conditionId);
    if (sim.executable) {
      secondExecution = true;
      break;
    }
    try {
      await keeper.executions.execute(created.conditionId);
      secondExecution = true;
      break;
    } catch {
      // Expected: the chain refuses because the condition is latched.
    }
  }

  const balanceAfterPolling = (await owner.vaults.get(vault!)).balance;

  check('Five more polls did not execute again', !secondExecution);
  check('Vault balance unchanged by polling', balanceBeforePolling === balanceAfterPolling);
  check(
    'Recipient was paid exactly once',
    (await owner.usdc.balanceOf(reserveWallet)) - recipientBefore === parseUsdc('999.50'),
  );

  /*//////////////////////////////////////////////////////////////
                      7. RECOVERY AND RE-ARM
  //////////////////////////////////////////////////////////////*/

  step('7. Recovery re-arms the condition');

  // Inside the hysteresis band: recovered past the threshold but not the buffer.
  await setBalance(treasuryWallet, parseUsdc('5100'));
  const partialView = await owner.conditions.get(created.conditionId);
  check('Not re-armable inside the hysteresis band', !partialView.rearmable);

  // Fully recovered.
  await setBalance(treasuryWallet, parseUsdc('9000'));
  const recoveredView = await owner.conditions.get(created.conditionId);
  check('Re-armable after full recovery', recoveredView.rearmable);

  await confirm(keeper.conditions.rearm(created.conditionId));
  const rearmedView = await owner.conditions.get(created.conditionId);
  check('Status back to active', rearmedView.condition.status === 'active');
  check('Armed again', rearmedView.condition.arm === 'armed');
  check('Not executable while healthy', !rearmedView.executable);

  /*//////////////////////////////////////////////////////////////
                        8. IT FIRES AGAIN
  //////////////////////////////////////////////////////////////*/

  step('8. The next dip fires again');

  await setBalance(treasuryWallet, parseUsdc('3000'));
  const secondTx = await keeper.executions.execute(created.conditionId);
  await raw.waitForTransactionReceipt({ hash: secondTx });

  check('Second execution succeeded', secondTx !== execTx, secondTx);
  check(
    'Recipient paid twice in total',
    (await owner.usdc.balanceOf(reserveWallet)) - recipientBefore === parseUsdc('1999.00'),
  );

  const twiceView = await owner.conditions.get(created.conditionId);
  check('Trigger count is 2', twiceView.condition.triggerCount === 2);

  const allExecutions = await owner.executions.list({ fromBlock: deployBlock });
  check('Two executions in the log', allExecutions.length === 2);
  check(
    'Execution ids are distinct',
    allExecutions[0].id !== allExecutions[1].id,
  );

  /*//////////////////////////////////////////////////////////////
       9. THE OTHER DIRECTION, ON THE SAME EVALUATOR

     The reuse claim, proven on-chain: a second condition type that
     fires when a balance rises, running on the evaluator already
     deployed. No new contract, no new deployment.
  //////////////////////////////////////////////////////////////*/

  step('9. The opposite direction runs on the same deployed evaluator');

  const payoutSource = '0x000000000000000000000000000000000000ABcD' as Address;
  const payoutDest = '0x000000000000000000000000000000000000FEeD' as Address;

  const payoutVault = await owner.vaults.create({
    recipient: payoutDest,
    maxPerExecution: '500',
    deposit: '2000',
  });
  check('Payout vault deployed', Boolean(payoutVault.vault));

  // Start below the threshold, so an "above" condition is not yet true.
  await setBalance(payoutSource, parseUsdc('4000'));

  const payout = await owner.conditions.create({
    wallet: payoutSource,
    type: 'BALANCE_ABOVE',
    asset: 'USDC',
    threshold: '10000',
    rearmBuffer: '500',
    vault: payoutVault.vault!,
    action: { type: 'TRANSFER_USDC', amount: '500', recipient: payoutDest },
  });
  check('Above-threshold condition created', Boolean(payout.conditionId));

  const payoutView = await owner.conditions.get(payout.conditionId);
  check('Type resolves to BALANCE_ABOVE', payoutView.condition.type === 'BALANCE_ABOVE');
  check(
    'Uses the same evaluator kind as the below condition',
    payoutView.condition.kind === view.condition.kind,
    `kind ${payoutView.condition.kind}`,
  );
  check('Not executable while under the threshold', !payoutView.executable);

  // Rise above the threshold: now it is due.
  await setBalance(payoutSource, parseUsdc('12000'));
  const risenView = await owner.conditions.get(payout.conditionId);
  check('Executable once the balance rises above', risenView.executable, formatUsd(risenView.currentValue));

  const payoutBefore = await owner.usdc.balanceOf(payoutDest);
  const payoutTx = await keeper.executions.execute(payout.conditionId);
  await raw.waitForTransactionReceipt({ hash: payoutTx });

  const payoutQuote = owner.fees.quote(parseUsdc('500'));
  check(
    'Payout recipient received the net amount',
    (await owner.usdc.balanceOf(payoutDest)) - payoutBefore === payoutQuote.netAmount,
    formatUsd(payoutQuote.netAmount),
  );

  // Recovery inverts: an "above" condition re-arms by falling back under
  // threshold - buffer, which the evaluator handles without the caller knowing.
  const firedPayout = await owner.conditions.get(payout.conditionId);
  check('Latched after firing', firedPayout.condition.arm === 'fired');

  await setBalance(payoutSource, parseUsdc('9600')); // inside the hysteresis band
  check(
    'Not re-armable inside the inverted hysteresis band',
    !(await owner.conditions.get(payout.conditionId)).rearmable,
  );

  await setBalance(payoutSource, parseUsdc('9000')); // under threshold - buffer
  check(
    'Re-armable once it falls back under threshold minus buffer',
    (await owner.conditions.get(payout.conditionId)).rearmable,
  );

  /*//////////////////////////////////////////////////////////////
                      10. THE OWNER'S CONTROLS
  //////////////////////////////////////////////////////////////*/

  step('10. Owner controls actually stop execution');

  // Re-arm so the condition is live again.
  await setBalance(treasuryWallet, parseUsdc('9000'));
  await confirm(keeper.conditions.rearm(created.conditionId));

  // Pause the condition, then make it true.
  await confirm(owner.conditions.pause(created.conditionId));
  await setBalance(treasuryWallet, parseUsdc('1000'));

  const pausedSim = await keeper.executions.simulate(created.conditionId);
  check('Paused condition is not executable', !pausedSim.executable);

  let pausedExecuted = false;
  try {
    await keeper.executions.execute(created.conditionId);
    pausedExecuted = true;
  } catch {
    // Expected.
  }
  check('Execution refused while paused', !pausedExecuted);

  /*
   * Resume, then revoke the vault instead.
   *
   * No re-arm is needed here: pausing never consumed the trigger, so the
   * condition resumes still ARMED. (Calling rearm on an armed condition
   * correctly reverts - the contract refuses to re-arm what never fired.)
   */
  await confirm(owner.conditions.resume(created.conditionId));
  await setBalance(treasuryWallet, parseUsdc('9000'));

  const resumedView = await owner.conditions.get(created.conditionId);
  check('Resumes still armed, not re-fired', resumedView.condition.arm === 'armed');

  await confirm(owner.vaults.revoke(vault!));
  await setBalance(treasuryWallet, parseUsdc('1000'));

  let revokedExecuted = false;
  try {
    await keeper.executions.execute(created.conditionId);
    revokedExecuted = true;
  } catch {
    // Expected.
  }
  check('Execution refused after vault revocation', !revokedExecuted);

  // Withdrawal must still work after revocation.
  const beforeWithdraw = await owner.usdc.balanceOf(ownerAccount.address);
  await confirm(owner.vaults.withdrawAll(vault!));
  const afterWithdraw = await owner.usdc.balanceOf(ownerAccount.address);

  check('Owner can still withdraw after revoking', afterWithdraw > beforeWithdraw);
  check('Vault is empty', (await owner.vaults.get(vault!)).balance === 0n);

  /*//////////////////////////////////////////////////////////////
                             REPORT
  //////////////////////////////////////////////////////////////*/

  console.log('');
  if (failures === 0) {
    console.log(`End-to-end verification PASSED: ${checks}/${checks} checks.`);
    process.exit(0);
  } else {
    console.log(`End-to-end verification FAILED: ${failures}/${checks} checks failed.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nE2E run crashed:', error);
  process.exit(1);
});
