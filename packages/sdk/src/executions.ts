/**
 * `upkeep.executions.*`
 *
 * Executions are not stored in a database and then displayed as facts. They are
 * read back from the chain's own `ExecutionCompleted` logs, so every row
 * corresponds to a transaction that really landed and can be opened in the Arc
 * explorer.
 */
import { parseAbiItem, type Address, type Hash, type PublicClient } from 'viem';
import { automationExecutorAbi } from './abi.js';
import type { UpkeepContext } from './client.js';
import { WalletRequiredError } from './errors.js';
import type { Execution } from './core/types.js';
import { sendArcTransaction } from './tx.js';

const EXECUTION_COMPLETED = parseAbiItem(
  'event ExecutionCompleted(uint256 indexed conditionId, bytes32 indexed executionId, address indexed recipient, address vault, uint256 grossAmount, uint256 netAmount, uint256 fee, uint256 observedValue, uint32 triggerCount)',
);

/**
 * How far back to look when no deploy block is configured.
 *
 * Arc produces blocks roughly every 0.5s, so this is about 12 hours. Modest on
 * purpose: a huge speculative range is exactly the kind of aggressive RPC use
 * that gets an endpoint to start refusing requests.
 */
const DEFAULT_LOOKBACK_BLOCKS = 86_400n;

/** Public endpoints commonly cap eth_getLogs ranges; stay well inside that. */
const CHUNK_SIZE = 10_000n;

export interface ListExecutionsOptions {
  conditionId?: string | bigint;
  recipient?: Address;
  fromBlock?: bigint;
  /** Cap on rows returned, newest first. */
  limit?: number;
}

export interface SimulationResult {
  executable: boolean;
  grossAmount: bigint;
  netAmount: bigint;
  fee: bigint;
  observedValue: bigint;
  vaultBalance: bigint;
}

export interface ExecutionStats {
  totalExecutions: number;
  /** Gross USDC moved by automation, in native wei. */
  totalAutomated: bigint;
  /** Protocol fees paid, in native wei. */
  totalFees: bigint;
}

export interface ExecutionsApi {
  list: (options?: ListExecutionsOptions) => Promise<Execution[]>;
  /** Dry-run an execution without sending a transaction. */
  simulate: (conditionId: string | bigint) => Promise<SimulationResult>;
  /** Execute a due condition. Requires keeper authorization on the executor. */
  execute: (conditionId: string | bigint) => Promise<Hash>;
  stats: (executions: readonly Execution[]) => ExecutionStats;
}

export function summarizeExecutions(executions: readonly Execution[]): ExecutionStats {
  return executions.reduce<ExecutionStats>(
    (acc, execution) => ({
      totalExecutions: acc.totalExecutions + 1,
      totalAutomated: acc.totalAutomated + execution.amount,
      totalFees: acc.totalFees + execution.fee,
    }),
    { totalExecutions: 0, totalAutomated: 0n, totalFees: 0n },
  );
}

async function attachBlockTimestamps(
  executions: Execution[],
  client: PublicClient,
): Promise<Execution[]> {
  const uniqueBlocks = Array.from(new Set(executions.map((e) => e.blockNumber)));
  const timestamps = new Map<bigint, string>();

  await Promise.all(
    uniqueBlocks.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        timestamps.set(blockNumber, new Date(Number(block.timestamp) * 1000).toISOString());
      } catch {
        // Leave the placeholder rather than invent a time.
      }
    }),
  );

  return executions.map((execution) => {
    const timestamp = timestamps.get(execution.blockNumber);
    return timestamp ? { ...execution, createdAt: timestamp, confirmedAt: timestamp } : execution;
  });
}

export function createExecutionsApi(ctx: UpkeepContext): ExecutionsApi {
  return {
    /**
     * Read executions from chain logs, newest first.
     *
     * Ranges are chunked, and a chunk that fails is skipped rather than failing
     * the whole read: a partial history is more useful than an error page, and
     * the caller can tell because rows simply stop.
     */
    async list(options = {}) {
      const addresses = ctx.requireAddresses();
      const latest = await ctx.publicClient.getBlockNumber();

      const from =
        options.fromBlock ??
        ctx.deployBlock ??
        (latest > DEFAULT_LOOKBACK_BLOCKS ? latest - DEFAULT_LOOKBACK_BLOCKS : 0n);

      const executions: Execution[] = [];

      for (let start = from; start <= latest; start += CHUNK_SIZE) {
        const end = start + CHUNK_SIZE - 1n > latest ? latest : start + CHUNK_SIZE - 1n;

        let logs;
        try {
          logs = await ctx.publicClient.getLogs({
            address: addresses.automationExecutor,
            event: EXECUTION_COMPLETED,
            args: {
              ...(options.conditionId !== undefined
                ? { conditionId: BigInt(options.conditionId) }
                : {}),
              ...(options.recipient ? { recipient: options.recipient } : {}),
            },
            fromBlock: start,
            toBlock: end,
          });
        } catch {
          continue;
        }

        for (const log of logs) {
          const args = log.args as {
            conditionId?: bigint;
            executionId?: `0x${string}`;
            recipient?: Address;
            vault?: Address;
            grossAmount?: bigint;
            netAmount?: bigint;
            fee?: bigint;
            observedValue?: bigint;
            triggerCount?: number;
          };

          if (!args.executionId || args.conditionId === undefined) continue;

          executions.push({
            id: args.executionId,
            conditionId: args.conditionId.toString(),
            triggerId: args.executionId,
            transactionHash: log.transactionHash,
            // A log exists only because its transaction succeeded and was mined.
            status: 'confirmed',
            amount: args.grossAmount ?? 0n,
            netAmount: args.netAmount ?? 0n,
            fee: args.fee ?? 0n,
            recipient: args.recipient ?? '0x0000000000000000000000000000000000000000',
            vault: args.vault ?? '0x0000000000000000000000000000000000000000',
            observedValue: args.observedValue ?? 0n,
            triggerCount: Number(args.triggerCount ?? 0),
            blockNumber: log.blockNumber,
            createdAt: new Date().toISOString(), // replaced below with the block time
          });
        }
      }

      executions.sort((a, b) =>
        b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0,
      );

      const limited = options.limit ? executions.slice(0, options.limit) : executions;
      return attachBlockTimestamps(limited, ctx.publicClient);
    },

    async simulate(conditionId) {
      const addresses = ctx.requireAddresses();

      const result = (await ctx.publicClient.readContract({
        address: addresses.automationExecutor,
        abi: automationExecutorAbi,
        functionName: 'simulate',
        args: [BigInt(conditionId)],
      })) as unknown as [boolean, bigint, bigint, bigint, bigint, bigint];

      return {
        executable: result[0],
        grossAmount: result[1],
        netAmount: result[2],
        fee: result[3],
        observedValue: result[4],
        vaultBalance: result[5],
      };
    },

    async execute(conditionId) {
      if (!ctx.walletClient || !ctx.account) throw new WalletRequiredError('executions.execute');
      const addresses = ctx.requireAddresses();

      return sendArcTransaction(ctx, {
        address: addresses.automationExecutor,
        abi: automationExecutorAbi,
        functionName: 'execute',
        args: [BigInt(conditionId)],
      });
    },

    stats: summarizeExecutions,
  };
}
