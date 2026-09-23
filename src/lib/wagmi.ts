/**
 * wagmi configuration.
 *
 * Only the injected connector is registered. WalletConnect would need a real
 * project id, and upKEEP does not ship a placeholder credential that fails at
 * runtime and looks like a bug. Add it deliberately, with your own id, if you
 * want it.
 */
import { http, createConfig, createStorage, cookieStorage } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineArcChain } from '@upkeep/sdk';
import { arcChainId, explorerUrl, publicRpcUrl } from '@/config/env';

export const arcChain = defineArcChain({
  rpcUrl: publicRpcUrl,
  chainId: arcChainId,
  explorerUrl,
});

export const wagmiConfig = createConfig({
  chains: [arcChain],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [arcChain.id]: http(publicRpcUrl, { batch: true, retryCount: 2, timeout: 15_000 }),
  },
  // Cookie storage keeps the connection stable across server rendering.
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
