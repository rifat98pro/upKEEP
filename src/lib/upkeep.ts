/**
 * The app's bridge to @upkeep/sdk.
 *
 * The dashboard is a *consumer* of the SDK, not a privileged insider. Every
 * chain read and write on these pages goes through the same client any other
 * Arc builder would construct. This file exists only to turn environment
 * variables into SDK configuration - that is the whole difference between the
 * reference implementation and a third-party one.
 */
import { createUpkeepClient, defineArcChain, type UpkeepClient } from '@upkeep/sdk';
import type { WalletClient } from 'viem';
import {
  arcChainId,
  explorerUrl,
  publicRpcUrl,
  serverRpcUrl,
} from '@/config/env';
import { getProtocolAddresses, upkeepFeeBps, deployBlock } from '@/config/contracts';

const chain = defineArcChain({
  rpcUrl: publicRpcUrl,
  chainId: arcChainId,
  explorerUrl,
});

function baseConfig() {
  const addresses = getProtocolAddresses();
  return {
    chain,
    addresses: addresses ?? undefined,
    explorerUrl,
    feeBps: upkeepFeeBps,
    deployBlock,
  };
}

/** Read-only client for browser code. */
export const upkeep: UpkeepClient = createUpkeepClient({
  ...baseConfig(),
  rpcUrl: publicRpcUrl,
});

let serverClient: UpkeepClient | undefined;

/**
 * Read-only client for server code (API routes, the keeper's read path).
 * Uses ARC_RPC_URL when set, so the backend can point at a private endpoint
 * while the browser keeps the public one.
 */
export function getServerUpkeep(): UpkeepClient {
  if (!serverClient) {
    serverClient = createUpkeepClient({ ...baseConfig(), rpcUrl: serverRpcUrl });
  }
  return serverClient;
}

/**
 * A client that can send transactions, built from the connected wallet.
 *
 * Created per call rather than memoized: the wallet client changes when the
 * user switches account or chain, and a stale one would sign from the wrong
 * address.
 */
export function getWritableUpkeep(walletClient: WalletClient): UpkeepClient {
  return createUpkeepClient({
    ...baseConfig(),
    rpcUrl: publicRpcUrl,
    walletClient,
    account: walletClient.account?.address,
  });
}
