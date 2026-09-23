/**
 * Environment configuration for the reference dashboard.
 *
 * The SDK takes configuration as parameters and reads no environment variables
 * of its own. This file is where the app turns env vars into those parameters,
 * with the official Arc Mainnet values as documented defaults.
 *
 * Sources for the defaults:
 *   https://docs.arc.io/arc/references/connect-to-arc
 */
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_EXPLORER_URL,
  ARC_MAINNET_RPC_URL,
  ARC_MAINNET_WS_URL,
} from '@upkeep/sdk';

function envOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/** Read by the browser bundle. NEXT_PUBLIC_* only. */
export const publicRpcUrl = envOr(process.env.NEXT_PUBLIC_ARC_RPC_URL, ARC_MAINNET_RPC_URL);

/** Read by server code; falls back to the public var, then the documented default. */
export const serverRpcUrl = envOr(process.env.ARC_RPC_URL, publicRpcUrl);

export const explorerUrl = envOr(
  process.env.NEXT_PUBLIC_ARC_EXPLORER_URL,
  ARC_MAINNET_EXPLORER_URL,
);

export const wsRpcUrl = envOr(process.env.NEXT_PUBLIC_ARC_WS_URL, ARC_MAINNET_WS_URL);

/**
 * The configured chain id. Defaults to Arc Mainnet.
 *
 * This is deliberately not a testnet switch in the UI: upKEEP targets Arc
 * Mainnet. The variable exists so an operator can point a local build at their
 * own node without editing source.
 */
export const arcChainId = Number(
  envOr(process.env.NEXT_PUBLIC_ARC_CHAIN_ID, String(ARC_MAINNET_CHAIN_ID)),
);

/** True when the app is pointed at Arc Mainnet proper. */
export const isArcMainnet = arcChainId === ARC_MAINNET_CHAIN_ID;

/** Arc Testnet, per https://docs.arc.io/arc/references/connect-to-arc */
export const ARC_TESTNET_CHAIN_ID = 5042002;

/**
 * The network this build is actually pointed at.
 *
 * Derived from the chain id rather than hardcoded. A build aimed at testnet
 * for a deployment rehearsal must not tell the user it is on Mainnet - showing
 * a network you are not on is the same class of dishonesty as showing demo data
 * as real.
 */
export const networkName =
  arcChainId === ARC_MAINNET_CHAIN_ID
    ? 'Arc Mainnet'
    : arcChainId === ARC_TESTNET_CHAIN_ID
      ? 'Arc Testnet'
      : `Arc (chain ${arcChainId})`;

/** True for anything that is not Arc Mainnet, so the UI can say so plainly. */
export const isRehearsalNetwork = arcChainId !== ARC_MAINNET_CHAIN_ID;

export function explorerTxLink(hash: string): string {
  return `${explorerUrl.replace(/\/$/, '')}/tx/${hash}`;
}

export function explorerAddressLink(address: string): string {
  return `${explorerUrl.replace(/\/$/, '')}/address/${address}`;
}
