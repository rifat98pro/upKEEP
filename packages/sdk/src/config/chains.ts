/**
 * Arc network configuration.
 *
 * Every value here is taken from the official Arc documentation:
 *   https://docs.arc.io/arc/references/connect-to-arc
 *   https://docs.arc.io/arc/references/gas-and-fees
 *
 * Nothing is guessed. Verified live against https://rpc.mainnet.arc.io
 * (eth_chainId returns 0x13b2 = 5042).
 *
 * The SDK takes configuration as parameters rather than reading environment
 * variables, so it works the same inside Next.js, a worker, a script or a test.
 */
import { defineChain, type Chain } from 'viem';

/** Arc Mainnet chain id. */
export const ARC_MAINNET_CHAIN_ID = 5042 as const;

/** Official public endpoints. */
export const ARC_MAINNET_RPC_URL = 'https://rpc.mainnet.arc.io';
export const ARC_MAINNET_WS_URL = 'wss://rpc.quicknode.mainnet.arc.io';
export const ARC_MAINNET_EXPLORER_URL = 'https://explorer.arc.io';

/**
 * Arc's minimum base fee is 20 Gwei. Transactions below this are **silently
 * dropped by the mempool**: they produce no receipt and never appear in a block.
 * Sending without an explicit floor is the easiest way to build something that
 * looks broken for reasons nothing reports.
 */
export const ARC_MIN_BASE_FEE_WEI = 20_000_000_000n;

/** A small tip improves inclusion during congestion (the docs suggest ~1 Gwei). */
export const ARC_DEFAULT_PRIORITY_FEE_WEI = 1_000_000_000n;

/**
 * Arc Mainnet as a viem chain.
 *
 * Note the native currency: Arc uses **USDC as its native gas token**, with 18
 * decimals. It is not ETH. See config/tokens.ts for the full decimal story.
 */
export const arcMainnet: Chain = defineChain({
  id: ARC_MAINNET_CHAIN_ID,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_MAINNET_RPC_URL], webSocket: [ARC_MAINNET_WS_URL] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: ARC_MAINNET_EXPLORER_URL },
  },
  contracts: {
    // Documented at the canonical cross-chain address.
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
});

/** Build an Arc chain object pointed at a custom RPC (a private node, a fork). */
export function defineArcChain(options: {
  rpcUrl?: string;
  chainId?: number;
  explorerUrl?: string;
  name?: string;
}): Chain {
  return defineChain({
    id: options.chainId ?? ARC_MAINNET_CHAIN_ID,
    name: options.name ?? 'Arc Mainnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [options.rpcUrl ?? ARC_MAINNET_RPC_URL] } },
    blockExplorers: {
      default: {
        name: 'Arc Explorer',
        url: options.explorerUrl ?? ARC_MAINNET_EXPLORER_URL,
      },
    },
    contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
  });
}

export function explorerTxUrl(hash: string, explorerUrl = ARC_MAINNET_EXPLORER_URL): string {
  return `${explorerUrl.replace(/\/$/, '')}/tx/${hash}`;
}

export function explorerAddressUrl(
  address: string,
  explorerUrl = ARC_MAINNET_EXPLORER_URL,
): string {
  return `${explorerUrl.replace(/\/$/, '')}/address/${address}`;
}
