/** `upkeep.network.*` - Arc RPC health, for status indicators and pre-flight checks. */
import type { UpkeepContext } from './client.js';
import type { NetworkStatus } from './core/types.js';

export interface NetworkApi {
  /**
   * Probe the configured RPC.
   *
   * Reports what it actually observed, including the chain id, so a
   * misconfigured endpoint surfaces as a mismatch rather than quietly serving
   * the wrong network's data.
   */
  status: () => Promise<NetworkStatus>;
  /** Current gas price in wei. */
  gasPrice: () => Promise<bigint>;
}

export function createNetworkApi(ctx: UpkeepContext): NetworkApi {
  return {
    async status() {
      const started = Date.now();
      try {
        const [chainId, blockNumber, gasPrice] = await Promise.all([
          ctx.publicClient.getChainId(),
          ctx.publicClient.getBlockNumber(),
          ctx.publicClient.getGasPrice(),
        ]);

        return {
          connected: true,
          chainId,
          blockNumber,
          gasPrice,
          latencyMs: Date.now() - started,
          chainMismatch: chainId !== ctx.chain.id,
        };
      } catch (error) {
        return {
          connected: false,
          latencyMs: Date.now() - started,
          chainMismatch: false,
          error: error instanceof Error ? error.message : 'RPC unavailable',
        };
      }
    },

    gasPrice: () => ctx.publicClient.getGasPrice(),
  };
}
