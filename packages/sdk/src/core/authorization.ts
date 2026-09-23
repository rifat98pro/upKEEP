/**
 * The authorization layer.
 *
 * upKEEP separates four concerns:
 *
 *   Condition     - what financial state is being watched
 *   Policy        - the rules bound to it (amount, recipient, security)
 *   Authorization - how a caller proves it may act
 *   Execution     - the transfer itself
 *
 * This module covers the third. It exists so a condition is never coupled to a
 * signature scheme: replacing how automation is authorized is a vault-level
 * change that leaves the condition, its threshold, its action and its history
 * completely untouched.
 *
 * WHAT THIS IS NOT
 *
 * upKEEP implements no cryptography and provides no post-quantum guarantee. An
 * authorization scheme here is a policy hook. Whatever cryptographic property
 * exists comes from Arc, from the caller's account, or from a precompile a
 * provider delegates to - never from this file.
 */
import type { Address } from 'viem';

/*//////////////////////////////////////////////////////////////
                         KNOWN SCHEMES
//////////////////////////////////////////////////////////////*/

export type AuthorizationSchemeStatus = 'active' | 'available' | 'future';

export interface AuthorizationScheme {
  /** keccak256 of the versioned scheme name, matching the on-chain id. */
  id: string;
  name: string;
  label: string;
  description: string;
  /**
   * Whether upKEEP can use this today.
   *
   *   active    - in use now
   *   available - implemented and selectable
   *   future    - documented direction, NOT implemented
   */
  status: AuthorizationSchemeStatus;
  /**
   * Whether this scheme is believed to resist a cryptographically relevant
   * quantum computer.
   *
   * `false` for the current scheme is a statement of fact, not a warning:
   * Arc accounts use ECDSA today. `undefined` means upKEEP cannot verify the
   * property and therefore will not assert it either way.
   */
  quantumResistant?: boolean;
}

/**
 * On-chain scheme ids: keccak256 of each versioned name.
 *
 * EXECUTOR_SCHEME_ID matches `ExecutorAuthorizationProvider.schemeId()` exactly;
 * there is a test asserting that, so a rename on either side is caught rather
 * than silently producing a scheme nothing recognises.
 */
export const EXECUTOR_SCHEME_ID =
  '0xdc0e01c19c66c50a0424100009f6f66f5b2b861b632cc088a1ce835eef2a28d3' as const;

export const SLH_DSA_SCHEME_ID =
  '0x8693570f080e50bd3baeb0424b7d6396e03dcecdad9ec5ba6f1e86f429fdba57' as const;

export const SMART_ACCOUNT_SCHEME_ID =
  '0x94558736ec20a865e552de053eaf35480fd58a7cd141807d83faf570b6a052fa' as const;

export const AUTHORIZATION_SCHEMES: AuthorizationScheme[] = [
  {
    id: 'upkeep.auth.executor.v1',
    name: 'EXECUTOR_V1',
    label: 'Executor authorization',
    description:
      'The vault authorizes one executor contract. Its security is Arc account security, which is ECDSA today.',
    status: 'active',
    quantumResistant: false,
  },
  {
    id: 'upkeep.auth.slhdsa.v1',
    name: 'SLH_DSA_V1',
    label: 'SLH-DSA-SHA2-128s signature authorization',
    description:
      "Would verify a post-quantum signature through Arc's PQ Signature Verify precompile, which is live on Arc Mainnet. Not implemented: Arc's documentation does not yet publish the precompile's calldata encoding, and upKEEP will not guess at the encoding of a signature verifier.",
    status: 'future',
    // Deliberately undefined. The precompile's property is Arc's to state; a
    // scheme upKEEP has not implemented cannot be asserted to have it.
    quantumResistant: undefined,
  },
  {
    id: 'upkeep.auth.smartaccount.v1',
    name: 'SMART_ACCOUNT_V1',
    label: 'Smart account authorization',
    description:
      'Would delegate the decision to an ERC-4337 smart account, letting the account own its own validation logic. Arc supports ERC-4337; upKEEP does not implement this provider.',
    status: 'future',
  },
];

export function getAuthorizationScheme(name: string): AuthorizationScheme | undefined {
  return AUTHORIZATION_SCHEMES.find((scheme) => scheme.name === name || scheme.id === name);
}

/** Schemes upKEEP can actually use right now. */
export function availableAuthorizationSchemes(): AuthorizationScheme[] {
  return AUTHORIZATION_SCHEMES.filter((s) => s.status !== 'future');
}

/** Schemes documented as direction only. Never presented as usable. */
export function futureAuthorizationSchemes(): AuthorizationScheme[] {
  return AUTHORIZATION_SCHEMES.filter((s) => s.status === 'future');
}

/*//////////////////////////////////////////////////////////////
                        ARC PQ PRIMITIVES
//////////////////////////////////////////////////////////////*/

/**
 * Arc's post-quantum primitives, as documented and verified.
 *
 * Recorded here so the roadmap is concrete rather than aspirational, and so
 * nobody has to re-derive what is actually available.
 */
export const ARC_PQ = {
  /**
   * PQ Signature Verify precompile.
   *
   * Verified live on Arc Mainnet: calling it returns structured errors
   * ("Input too short" under 4 bytes, "Invalid selector" at or above 4), which
   * confirms an active precompile expecting an ABI-encoded call.
   *
   * Source: https://docs.arc.io/arc/concepts/execution-layer
   */
  signatureVerifyPrecompile: '0x1800000000000000000000000000000000000004' as Address,

  /** The scheme Arc states is live for verification. */
  scheme: 'SLH-DSA-SHA2-128s',

  /**
   * Verification only. Arc's docs are explicit that post-quantum *transaction
   * signing* is a future milestone, likely via EIP-8141 once finalized. So an
   * Arc account is not post-quantum secure today, and upKEEP does not suggest
   * otherwise anywhere in the product.
   */
  walletSigningAvailable: false,

  /**
   * Why no provider ships against it yet: the calldata encoding is not in
   * Arc's published documentation. Getting the argument order of a signature
   * verifier wrong is worse than not having one, so this waits for the spec.
   */
  encodingDocumented: false,
} as const;

/*//////////////////////////////////////////////////////////////
                        SECURITY POLICY
//////////////////////////////////////////////////////////////*/

/**
 * A vault's security policy.
 *
 * An extensibility surface, not an enforcement mechanism upKEEP invented. The
 * only thing it can do today is add a restriction.
 */
export interface SecurityPolicy {
  /** Free-form mode tag stored on-chain, e.g. "CURRENT". */
  authorizationMode: string;
  /** Configured provider, or undefined for the built-in executor check. */
  provider?: Address;
  /**
   * When true, a provider reporting that migration is required halts automated
   * transfers. Withdrawal is never affected.
   */
  pauseOnMigrationRequired: boolean;
}

/** What a vault reports about its authorization, for display. */
export interface AuthorizationStatus {
  provider?: Address;
  /** On-chain scheme id, if a provider is configured. */
  schemeId?: string;
  /** Human-readable scheme name. */
  label: string;
  /**
   * What the provider reports. False for every provider upKEEP ships - Arc
   * exposes no signal that would make another answer honest.
   */
  migrationRequired: boolean;
  /** True when a provider is configured rather than the built-in check. */
  providerConfigured: boolean;
}

/**
 * The phrasing the product is allowed to use.
 *
 * Centralised so no screen can drift into a claim the implementation does not
 * support. "Quantum safe", "post-quantum secure" and "quantum proof" are absent
 * on purpose: upKEEP does not provide that property and must not imply it.
 */
export const AUTHORIZATION_COPY = {
  architectureClaim: 'Designed for future cryptographic migration',
  migrationReady: 'Ready for authorization upgrade',
  configured: 'Configured for future authorization migration',
  currentSchemeNote:
    'Authorization inherits Arc account security, which uses ECDSA today.',
  disclaimer:
    'upKEEP does not implement cryptography and makes no post-quantum security claim. This describes how authorization can be replaced, not what protects it.',
} as const;
