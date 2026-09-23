/**
 * GET /api/network
 *
 * Live Arc Mainnet status, read server-side. Useful for uptime checks and for
 * clients that should not talk to an RPC directly.
 */
import { NextResponse } from 'next/server';
import { getServerUpkeep } from '@/lib/upkeep';
import { arcChainId, explorerUrl, serverRpcUrl } from '@/config/env';
import { isProtocolDeployed, missingProtocolAddresses } from '@/config/contracts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const upkeep = getServerUpkeep();
  const status = await upkeep.network.status();

  return NextResponse.json(
    {
      network: 'Arc Mainnet',
      expectedChainId: arcChainId,
      rpcUrl: serverRpcUrl,
      explorerUrl,
      connected: status.connected,
      observedChainId: status.chainId ?? null,
      chainMismatch: status.chainMismatch,
      blockNumber: status.blockNumber?.toString() ?? null,
      gasPriceWei: status.gasPrice?.toString() ?? null,
      latencyMs: status.latencyMs,
      error: status.error ?? null,
      protocol: {
        deployed: isProtocolDeployed,
        missing: missingProtocolAddresses(),
        addresses: upkeep.addresses,
      },
    },
    { status: status.connected && !status.chainMismatch ? 200 : 503 },
  );
}
