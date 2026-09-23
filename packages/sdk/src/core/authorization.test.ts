/**
 * Authorization layer tests.
 *
 * Two jobs here. One is ordinary: the scheme ids must match the contracts. The
 * other is unusual but deliberate — several of these tests assert that upKEEP
 * does *not* say certain things. Claiming a security property you do not
 * provide is the specific failure this layer is meant to avoid, so the
 * prohibition is encoded rather than left to reviewer vigilance.
 */
import { describe, it, expect } from 'vitest';
import { keccak256, toHex } from 'viem';
import {
  ARC_PQ,
  AUTHORIZATION_COPY,
  AUTHORIZATION_SCHEMES,
  EXECUTOR_SCHEME_ID,
  SLH_DSA_SCHEME_ID,
  SMART_ACCOUNT_SCHEME_ID,
  availableAuthorizationSchemes,
  futureAuthorizationSchemes,
  getAuthorizationScheme,
} from './authorization.js';

describe('scheme ids match the contracts', () => {
  /**
   * ExecutorAuthorizationProvider.schemeId() returns
   * keccak256("upkeep.auth.executor.v1"). If either side is renamed, this
   * fails rather than silently producing a scheme nothing recognises.
   */
  it('EXECUTOR_SCHEME_ID is keccak256 of the versioned name', () => {
    expect(EXECUTOR_SCHEME_ID).toBe(keccak256(toHex('upkeep.auth.executor.v1')));
  });

  it('the other scheme ids are derived the same way', () => {
    expect(SLH_DSA_SCHEME_ID).toBe(keccak256(toHex('upkeep.auth.slhdsa.v1')));
    expect(SMART_ACCOUNT_SCHEME_ID).toBe(keccak256(toHex('upkeep.auth.smartaccount.v1')));
  });

  it('every catalogued scheme has a unique id', () => {
    const ids = AUTHORIZATION_SCHEMES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('what is actually usable', () => {
  it('exactly one scheme is active today', () => {
    const active = AUTHORIZATION_SCHEMES.filter((s) => s.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('EXECUTOR_V1');
  });

  it('future schemes are never offered as available', () => {
    const available = availableAuthorizationSchemes().map((s) => s.name);
    for (const scheme of futureAuthorizationSchemes()) {
      expect(available).not.toContain(scheme.name);
    }
  });

  it('the post-quantum scheme is marked future, not available', () => {
    const slhDsa = getAuthorizationScheme('SLH_DSA_V1');
    expect(slhDsa?.status).toBe('future');
  });

  it('the smart account scheme is marked future', () => {
    expect(getAuthorizationScheme('SMART_ACCOUNT_V1')?.status).toBe('future');
  });
});

describe('honesty constraints', () => {
  /**
   * The current scheme inherits Arc account security, which is ECDSA. Saying
   * so plainly is the point; a scheme that quietly omitted it would read as
   * reassurance it has not earned.
   */
  it('states plainly that the current scheme is not quantum resistant', () => {
    expect(getAuthorizationScheme('EXECUTOR_V1')?.quantumResistant).toBe(false);
  });

  /**
   * upKEEP has not implemented the SLH-DSA provider, so it cannot assert the
   * property either way. Undefined is the correct answer, not `true`.
   */
  it('does not assert a property for an unimplemented scheme', () => {
    expect(getAuthorizationScheme('SLH_DSA_V1')?.quantumResistant).toBeUndefined();
  });

  it('no scheme claims quantum resistance', () => {
    // Nothing shipped provides it. If that ever changes, this test should be
    // the thing that forces the change to be deliberate.
    for (const scheme of AUTHORIZATION_SCHEMES) {
      expect(scheme.quantumResistant).not.toBe(true);
    }
  });

  const BANNED = [
    'quantum safe',
    'quantum-safe',
    'post-quantum secure',
    'quantum proof',
    'quantum-proof',
    'quantum resistant',
  ];

  it('the approved copy contains no prohibited claim', () => {
    const text = Object.values(AUTHORIZATION_COPY).join(' ').toLowerCase();
    for (const phrase of BANNED) {
      expect(text).not.toContain(phrase);
    }
  });

  it('scheme descriptions contain no prohibited claim', () => {
    const text = AUTHORIZATION_SCHEMES.map((s) => `${s.label} ${s.description}`)
      .join(' ')
      .toLowerCase();
    for (const phrase of BANNED) {
      expect(text).not.toContain(phrase);
    }
  });

  it('the copy carries an explicit disclaimer', () => {
    expect(AUTHORIZATION_COPY.disclaimer.toLowerCase()).toContain('no post-quantum security claim');
  });
});

describe("Arc's post-quantum primitives, as recorded", () => {
  it('records the precompile address verified live on Arc Mainnet', () => {
    expect(ARC_PQ.signatureVerifyPrecompile).toBe(
      '0x1800000000000000000000000000000000000004',
    );
  });

  it('records the scheme Arc states is live for verification', () => {
    expect(ARC_PQ.scheme).toBe('SLH-DSA-SHA2-128s');
  });

  /**
   * Arc's docs are explicit that post-quantum *transaction signing* is a future
   * milestone. An Arc account is therefore not post-quantum secure today, and
   * nothing in upKEEP may imply it is.
   */
  it('records that wallet signing is not available', () => {
    expect(ARC_PQ.walletSigningAvailable).toBe(false);
  });

  /**
   * The reason no provider ships against the precompile. When Arc publishes the
   * encoding, flipping this is the signal that building it is now possible.
   */
  it('records that the calldata encoding is not yet documented', () => {
    expect(ARC_PQ.encodingDocumented).toBe(false);
  });
});
