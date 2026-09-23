/**
 * Batched-read fallback tests.
 *
 * These exist because of a real bug: when Multicall3 is absent, viem's
 * `multicall` with `allowFailure: true` does not throw - it reports every call
 * as failed. A list page then renders "nothing here yet" while the chain holds
 * plenty, with no error anywhere. That is a silent, data-losing failure, so the
 * behaviour is pinned down here.
 */
import { describe, it, expect, vi } from 'vitest';
import { readBatch, readBatchAllowFailure } from './multicall.js';

const CALLS = [
  { address: '0x1111111111111111111111111111111111111111' as const, abi: [], functionName: 'a' },
  { address: '0x2222222222222222222222222222222222222222' as const, abi: [], functionName: 'b' },
];

function makeClient(overrides: {
  multicall?: ReturnType<typeof vi.fn>;
  readContract?: ReturnType<typeof vi.fn>;
}) {
  return {
    multicall: overrides.multicall ?? vi.fn(),
    readContract: overrides.readContract ?? vi.fn(),
  } as never;
}

describe('readBatch', () => {
  it('uses multicall when it works', async () => {
    const multicall = vi.fn().mockResolvedValue(['alpha', 'beta']);
    const readContract = vi.fn();

    const result = await readBatch(makeClient({ multicall, readContract }), CALLS);

    expect(result).toEqual(['alpha', 'beta']);
    expect(multicall).toHaveBeenCalledTimes(1);
    expect(readContract).not.toHaveBeenCalled();
  });

  it('falls back to individual reads when Multicall3 is missing', async () => {
    const multicall = vi
      .fn()
      .mockRejectedValue(new Error('The contract function "aggregate3" returned no data ("0x").'));
    const readContract = vi.fn().mockResolvedValueOnce('alpha').mockResolvedValueOnce('beta');

    const result = await readBatch(makeClient({ multicall, readContract }), CALLS);

    expect(result).toEqual(['alpha', 'beta']);
    expect(readContract).toHaveBeenCalledTimes(2);
  });

  it('propagates a genuine revert instead of silently retrying', async () => {
    // A real revert must surface. Retrying N times would just fail N times and
    // obscure the actual reason.
    const multicall = vi.fn().mockRejectedValue(new Error('execution reverted: NotConditionOwner'));
    const readContract = vi.fn();

    await expect(readBatch(makeClient({ multicall, readContract }), CALLS)).rejects.toThrow(
      /NotConditionOwner/,
    );
    expect(readContract).not.toHaveBeenCalled();
  });

  it('short-circuits on an empty batch', async () => {
    const multicall = vi.fn();
    expect(await readBatch(makeClient({ multicall }), [])).toEqual([]);
    expect(multicall).not.toHaveBeenCalled();
  });
});

describe('readBatchAllowFailure', () => {
  it('passes through a mix of successes and failures', async () => {
    const multicall = vi.fn().mockResolvedValue([
      { status: 'success', result: 'alpha' },
      { status: 'failure' },
    ]);
    const readContract = vi.fn();

    const result = await readBatchAllowFailure(makeClient({ multicall, readContract }), CALLS);

    expect(result).toEqual([{ status: 'success', result: 'alpha' }, { status: 'failure' }]);
    // A partial failure is real data, not a missing aggregator: do not re-read.
    expect(readContract).not.toHaveBeenCalled();
  });

  /** The regression this file exists for. */
  it('re-reads individually when every call failed', async () => {
    const multicall = vi
      .fn()
      .mockResolvedValue([{ status: 'failure' }, { status: 'failure' }]);
    const readContract = vi.fn().mockResolvedValueOnce('alpha').mockResolvedValueOnce('beta');

    const result = await readBatchAllowFailure(makeClient({ multicall, readContract }), CALLS);

    expect(result).toEqual([
      { status: 'success', result: 'alpha' },
      { status: 'success', result: 'beta' },
    ]);
    expect(readContract).toHaveBeenCalledTimes(2);
  });

  it('still reports genuine failures after falling back', async () => {
    const multicall = vi
      .fn()
      .mockResolvedValue([{ status: 'failure' }, { status: 'failure' }]);
    const readContract = vi
      .fn()
      .mockResolvedValueOnce('alpha')
      .mockRejectedValueOnce(new Error('reverted'));

    const result = await readBatchAllowFailure(makeClient({ multicall, readContract }), CALLS);

    expect(result).toEqual([{ status: 'success', result: 'alpha' }, { status: 'failure' }]);
  });

  it('falls back when multicall throws outright', async () => {
    const multicall = vi
      .fn()
      .mockRejectedValue(new Error('Cannot decode zero data ("0x") with ABI parameters.'));
    const readContract = vi.fn().mockResolvedValue('alpha');

    const result = await readBatchAllowFailure(makeClient({ multicall, readContract }), CALLS);

    expect(result.every((r) => r.status === 'success')).toBe(true);
  });

  it('short-circuits on an empty batch', async () => {
    const multicall = vi.fn();
    expect(await readBatchAllowFailure(makeClient({ multicall }), [])).toEqual([]);
    expect(multicall).not.toHaveBeenCalled();
  });
});
