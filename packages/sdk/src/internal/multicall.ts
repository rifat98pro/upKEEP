/**
 * Batched reads with a graceful fallback.
 *
 * Arc Mainnet has Multicall3 at the canonical address, so batching is the right
 * default: one round trip instead of N. But a chain that lacks it - a bare local
 * node, a fresh devnet - fails with `aggregate3 returned no data ("0x")`, which
 * tells a developer nothing about what actually went wrong.
 *
 * So this tries the batch, and on failure falls back to individual reads. The
 * caller gets the same shape either way, and the only difference is latency.
 */
import type { Abi, Address, PublicClient } from 'viem';

export interface BatchedCall {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

/**
 * Read several contract calls, batching through Multicall3 when it is available.
 *
 * @throws whatever the individual read throws, if the fallback also fails.
 *         A failure here is a real problem, not something to swallow.
 */
export async function readBatch(
  client: PublicClient,
  calls: readonly BatchedCall[],
): Promise<unknown[]> {
  if (calls.length === 0) return [];

  try {
    return (await client.multicall({
      contracts: calls as never,
      allowFailure: false,
    })) as unknown[];
  } catch (error) {
    if (!looksLikeMissingMulticall(error)) throw error;

    return Promise.all(
      calls.map((call) =>
        client.readContract({
          address: call.address,
          abi: call.abi as Abi,
          functionName: call.functionName,
          args: call.args as never,
        }),
      ),
    );
  }
}

/**
 * The same, but tolerating individual failures.
 *
 * Used where one bad entry should not blank a whole list - a condition pointing
 * at a self-destructed vault, for example.
 */
export async function readBatchAllowFailure(
  client: PublicClient,
  calls: readonly BatchedCall[],
): Promise<Array<{ status: 'success'; result: unknown } | { status: 'failure' }>> {
  if (calls.length === 0) return [];

  try {
    const results = (await client.multicall({
      contracts: calls as never,
      allowFailure: true,
    })) as Array<{ status: 'success' | 'failure'; result?: unknown }>;

    /*
     * With allowFailure, viem does not throw when Multicall3 is missing: it
     * reports every call as failed instead. That is indistinguishable from a
     * genuinely empty result unless we notice that *nothing* succeeded, which
     * for a batch of independent reads is far more likely to mean the
     * aggregator is absent than that every single call reverted.
     *
     * Getting this wrong is quiet and nasty - a list page simply renders "no
     * conditions yet" while the chain holds plenty - so when all of them fail,
     * re-read individually and trust that answer.
     */
    const allFailed = results.length > 0 && results.every((r) => r.status === 'failure');
    if (!allFailed) {
      return results.map((result) =>
        result.status === 'success'
          ? { status: 'success' as const, result: result.result }
          : { status: 'failure' as const },
      );
    }
  } catch (error) {
    if (!looksLikeMissingMulticall(error)) throw error;
  }

  return individually(client, calls);
}

async function individually(
  client: PublicClient,
  calls: readonly BatchedCall[],
): Promise<Array<{ status: 'success'; result: unknown } | { status: 'failure' }>> {
  return Promise.all(
    calls.map(async (call) => {
      try {
        const result = await client.readContract({
          address: call.address,
          abi: call.abi as Abi,
          functionName: call.functionName,
          args: call.args as never,
        });
        return { status: 'success' as const, result };
      } catch {
        return { status: 'failure' as const };
      }
    }),
  );
}

/**
 * Is this failure "Multicall3 is not deployed here" rather than a real error?
 *
 * Deliberately narrow: a genuine revert inside one of the calls must still
 * propagate, not silently trigger N slower calls that fail the same way.
 */
function looksLikeMissingMulticall(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /aggregate3/i.test(message) ||
    /returned no data/i.test(message) ||
    /Cannot decode zero data/i.test(message) ||
    /multicall3?.*not.*(deployed|configured|exist)/i.test(message)
  );
}
