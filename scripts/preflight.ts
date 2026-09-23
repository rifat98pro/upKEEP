#!/usr/bin/env tsx
/**
 * Mainnet pre-flight checks (§39).
 *
 * Run this before deploying, and again after, to verify that what this build
 * believes about Arc matches what the chain actually reports. Every check
 * states what it observed, so a failure tells you the real value rather than
 * just "mismatch".
 *
 *   npm run preflight
 */
import { createPublicClient, http, erc20Abi, type PublicClient } from 'viem';
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_EXPLORER_URL,
  ARC_MAINNET_RPC_URL,
  ARC_MIN_BASE_FEE_WEI,
  NATIVE_TO_ERC20_SCALE,
  USDC_ERC20_ADDRESS,
  USDC_ERC20_DECIMALS,
  computeFeeBreakdown,
  defineArcChain,
  formatUsd,
  formatUsdPrecise,
  parseUsdc,
} from '../packages/sdk/src/index.js';

const RPC_URL = process.env.ARC_RPC_URL?.trim() || ARC_MAINNET_RPC_URL;
const EXPLORER_URL =
  process.env.NEXT_PUBLIC_ARC_EXPLORER_URL?.trim() || ARC_MAINNET_EXPLORER_URL;

let failures = 0;
let warnings = 0;

function pass(label: string, detail?: string) {
  console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`);
}

function fail(label: string, detail: string) {
  failures++;
  console.log(`  FAIL  ${label}  ${detail}`);
}

function warn(label: string, detail: string) {
  warnings++;
  console.log(`  WARN  ${label}  ${detail}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  console.log('upKEEP pre-flight');
  console.log(`RPC: ${RPC_URL}`);

  const chain = defineArcChain({ rpcUrl: RPC_URL });
  const client = createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient;

  /*//////////////////////////////////////////////////////////////
                              NETWORK
  //////////////////////////////////////////////////////////////*/

  section('Network');

  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (error) {
    fail('RPC reachable', error instanceof Error ? error.message : String(error));
    report();
    return;
  }
  pass('RPC reachable');

  if (chainId === ARC_MAINNET_CHAIN_ID) {
    pass('Chain ID is Arc Mainnet', `(${chainId})`);
  } else {
    fail('Chain ID', `expected ${ARC_MAINNET_CHAIN_ID}, got ${chainId}`);
  }

  const blockNumber = await client.getBlockNumber();
  if (blockNumber > 0n) {
    pass('Chain has history', `block ${blockNumber}`);
  } else {
    fail('Chain has history', 'block number is zero');
  }

  /*//////////////////////////////////////////////////////////////
                                GAS
  //////////////////////////////////////////////////////////////*/

  section('Gas');

  const gasPrice = await client.getGasPrice();
  const gwei = Number(gasPrice) / 1e9;
  pass('Gas price readable', `${gwei.toFixed(2)} Gwei`);

  if (gasPrice >= ARC_MIN_BASE_FEE_WEI) {
    pass('Gas price at or above the 20 Gwei floor');
  } else {
    // Not fatal: the SDK clamps to the floor regardless. Worth knowing though.
    warn(
      'Gas price below the documented floor',
      `${gwei.toFixed(2)} Gwei; transactions under 20 Gwei are silently dropped by Arc`,
    );
  }

  /*//////////////////////////////////////////////////////////////
                                USDC
  //////////////////////////////////////////////////////////////*/

  section('USDC');

  try {
    const decimals = await client.readContract({
      address: USDC_ERC20_ADDRESS,
      abi: erc20Abi,
      functionName: 'decimals',
    });

    if (decimals === USDC_ERC20_DECIMALS) {
      pass('USDC ERC-20 decimals', `${decimals} at ${USDC_ERC20_ADDRESS}`);
    } else {
      fail('USDC ERC-20 decimals', `expected ${USDC_ERC20_DECIMALS}, got ${decimals}`);
    }

    const symbol = await client.readContract({
      address: USDC_ERC20_ADDRESS,
      abi: erc20Abi,
      functionName: 'symbol',
    });

    if (symbol === 'USDC') {
      pass('USDC symbol', symbol);
    } else {
      fail('USDC symbol', `expected USDC, got ${symbol}`);
    }
  } catch (error) {
    fail('USDC contract readable', error instanceof Error ? error.message : String(error));
  }

  /*
   * The decimal relationship is the assumption the whole codebase rests on, so
   * verify it against a real account rather than trusting the documentation.
   */
  try {
    const probe = '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE' as const; // Circle Gateway wallet
    const [native, erc20] = await Promise.all([
      client.getBalance({ address: probe }),
      client.readContract({
        address: USDC_ERC20_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [probe],
      }),
    ]);

    if (native === 0n) {
      warn('Dual-decimal check', 'the probe account holds no USDC; skipped');
    } else if (native / NATIVE_TO_ERC20_SCALE === erc20) {
      pass('Native and ERC-20 views reconcile', `1e12 scale confirmed (${formatUsd(native)})`);
    } else {
      fail(
        'Native and ERC-20 views reconcile',
        `native/1e12 = ${native / NATIVE_TO_ERC20_SCALE}, erc20 = ${erc20}`,
      );
    }
  } catch (error) {
    warn('Dual-decimal check', error instanceof Error ? error.message : String(error));
  }

  /*//////////////////////////////////////////////////////////////
                             FEE MATH
  //////////////////////////////////////////////////////////////*/

  section('Fee math');

  const headline = computeFeeBreakdown(parseUsdc('1000'));
  if (headline.fee === parseUsdc('0.50') && headline.netAmount === parseUsdc('999.50')) {
    pass('$1,000 execution', `fee ${formatUsdPrecise(headline.fee)}, recipient ${formatUsd(headline.netAmount)}`);
  } else {
    fail('$1,000 execution', `got fee ${headline.fee}, net ${headline.netAmount}`);
  }

  const micro = computeFeeBreakdown(parseUsdc('0.01'));
  if (micro.fee === parseUsdc('0.0001') && micro.fee < parseUsdc('0.01')) {
    pass('$0.01 micro execution', `fee capped at ${formatUsdPrecise(micro.fee)} (1%)`);
  } else {
    fail('$0.01 micro execution', `fee ${micro.fee} is not the 1% cap`);
  }

  /*//////////////////////////////////////////////////////////////
                           CONFIGURATION
  //////////////////////////////////////////////////////////////*/

  section('Configuration');

  if (EXPLORER_URL.startsWith('https://')) {
    pass('Explorer URL', EXPLORER_URL);
  } else {
    fail('Explorer URL', `does not look like a URL: ${EXPLORER_URL}`);
  }

  const contracts: Array<[string, string | undefined]> = [
    ['ConditionRegistry', process.env.NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS],
    ['AutomationExecutor', process.env.NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS],
    ['AutomationVaultFactory', process.env.NEXT_PUBLIC_VAULT_FACTORY_ADDRESS],
  ];

  let deployed = true;
  for (const [name, address] of contracts) {
    if (!address) {
      deployed = false;
      warn(name, 'not configured');
      continue;
    }

    const code = await client.getCode({ address: address as `0x${string}` });
    if (code && code !== '0x') {
      pass(name, address);
    } else {
      fail(name, `no contract code at ${address}`);
    }
  }

  if (!deployed) {
    console.log(
      '\n  Contracts are not deployed yet. Reading Arc works; creating and executing conditions does not.',
    );
  }

  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    warn('Demo mode', 'NEXT_PUBLIC_DEMO_MODE=true: the UI will show sample data, not Mainnet data');
  }

  report();
}

function report() {
  console.log('');
  if (failures === 0) {
    console.log(`Pre-flight passed${warnings > 0 ? ` with ${warnings} warning(s)` : ''}.`);
    process.exit(0);
  } else {
    console.log(`Pre-flight FAILED: ${failures} failure(s), ${warnings} warning(s).`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Pre-flight crashed:', error);
  process.exit(1);
});
