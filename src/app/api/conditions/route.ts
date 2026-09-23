/**
 * GET /api/conditions?owner=0x...
 *
 * Reads conditions from the on-chain registry, server-side.
 *
 * There is deliberately no POST here. Creating a condition requires a signature
 * from the owner's wallet, and upKEEP does not hold user keys, so a server-side
 * create endpoint could not exist without the custody model this project is
 * built to avoid.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isAddress, type Address } from 'viem';
import { ProtocolNotConfiguredError } from '@upkeep/sdk';
import { getServerUpkeep } from '@/lib/upkeep';
import { missingProtocolAddresses } from '@/config/contracts';

export const dynamic = 'force-dynamic';

/** bigints do not survive JSON.stringify, so they are serialized as strings. */
function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serialize(v)]),
    );
  }
  return value;
}

export async function GET(request: NextRequest) {
  const ownerParam = request.nextUrl.searchParams.get('owner');

  if (ownerParam !== null && !isAddress(ownerParam)) {
    return NextResponse.json({ error: 'owner must be a valid address' }, { status: 400 });
  }
  // Narrowed by the guard above: either a checksummed address or absent.
  const owner = ownerParam === null ? undefined : (ownerParam as Address);

  try {
    const upkeep = getServerUpkeep();
    const conditions = owner
      ? await upkeep.conditions.list(owner)
      : await upkeep.conditions.listAll();

    return NextResponse.json({
      network: 'Arc Mainnet',
      count: conditions.length,
      conditions: serialize(conditions),
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
      { error: error instanceof Error ? error.message : 'Failed to read conditions' },
      { status: 502 },
    );
  }
}
