/**
 * GET /api/executions?conditionId=1&limit=50
 *
 * Execution history, read from the executor's on-chain logs. Every row
 * corresponds to a transaction that actually landed on Arc Mainnet.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ProtocolNotConfiguredError, summarizeExecutions } from '@upkeep/sdk';
import { getServerUpkeep } from '@/lib/upkeep';
import { explorerTxLink } from '@/config/env';
import { missingProtocolAddresses } from '@/config/contracts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const conditionId = params.get('conditionId') ?? undefined;

  const limitRaw = Number(params.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  try {
    const upkeep = getServerUpkeep();
    const executions = await upkeep.executions.list({ conditionId, limit });
    const stats = summarizeExecutions(executions);

    return NextResponse.json({
      network: 'Arc Mainnet',
      count: executions.length,
      stats: {
        totalExecutions: stats.totalExecutions,
        totalAutomatedWei: stats.totalAutomated.toString(),
        totalFeesWei: stats.totalFees.toString(),
      },
      executions: executions.map((execution) => ({
        id: execution.id,
        conditionId: execution.conditionId,
        triggerId: execution.triggerId,
        transactionHash: execution.transactionHash,
        explorerUrl: explorerTxLink(execution.transactionHash),
        status: execution.status,
        amountWei: execution.amount.toString(),
        netAmountWei: execution.netAmount.toString(),
        feeWei: execution.fee.toString(),
        recipient: execution.recipient,
        vault: execution.vault,
        observedValueWei: execution.observedValue.toString(),
        triggerCount: execution.triggerCount,
        blockNumber: execution.blockNumber.toString(),
        createdAt: execution.createdAt,
        confirmedAt: execution.confirmedAt ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof ProtocolNotConfiguredError) {
      return NextResponse.json(
        {
          error: 'upKEEP contracts are not configured for this deployment.',
          missing: missingProtocolAddresses(),
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read executions' },
      { status: 502 },
    );
  }
}
