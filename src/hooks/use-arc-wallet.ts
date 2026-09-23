'use client';

/**
 * Wallet connection state for Arc Mainnet.
 *
 * Wraps wagmi so components ask "is this wallet on the right network?" rather
 * than reassembling that answer from four different hooks each time.
 */
import { useCallback, useMemo } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain, useChainId } from 'wagmi';
import { arcChainId } from '@/config/env';
import { shortenAddress } from '@/lib/utils';

export interface ArcWallet {
  address?: `0x${string}`;
  shortAddress: string;
  isConnected: boolean;
  isConnecting: boolean;
  /** Connected, but the wallet is pointed at some other chain. */
  isWrongNetwork: boolean;
  /** Connected and on Arc Mainnet. The only state where actions are allowed. */
  isReady: boolean;
  chainId: number;
  /** True when the browser exposes an injected wallet at all. */
  hasInjectedWallet: boolean;
  connect: () => void;
  disconnect: () => void;
  switchToArc: () => void;
  isSwitching: boolean;
  error?: string;
}

export function useArcWallet(): ArcWallet {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: isConnectPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();

  const injectedConnector = useMemo(
    () => connectors.find((connector) => connector.id === 'injected') ?? connectors[0],
    [connectors],
  );

  const handleConnect = useCallback(() => {
    if (injectedConnector) connect({ connector: injectedConnector });
  }, [connect, injectedConnector]);

  const switchToArc = useCallback(() => {
    switchChain({ chainId: arcChainId });
  }, [switchChain]);

  const isWrongNetwork = isConnected && chainId !== arcChainId;

  return {
    address,
    shortAddress: shortenAddress(address),
    isConnected,
    isConnecting: isConnecting || isConnectPending || isReconnecting,
    isWrongNetwork,
    isReady: isConnected && !isWrongNetwork,
    chainId,
    hasInjectedWallet:
      typeof window !== 'undefined' && typeof (window as { ethereum?: unknown }).ethereum !== 'undefined',
    connect: handleConnect,
    disconnect,
    switchToArc,
    isSwitching,
    error: normalizeWalletError(connectError ?? switchError),
  };
}

/** Turn wallet library errors into something a person can act on (§30). */
function normalizeWalletError(error: unknown): string | undefined {
  if (!error) return undefined;

  const message = error instanceof Error ? error.message : String(error);

  if (/user rejected|denied|rejected the request/i.test(message)) {
    return 'Request rejected in your wallet.';
  }
  if (/already pending|already processing/i.test(message)) {
    return 'Your wallet already has a pending request. Open it to continue.';
  }
  if (/unrecognized chain|chain.*not.*added|4902/i.test(message)) {
    return 'Arc Mainnet is not yet added to your wallet. Approve the prompt to add it.';
  }
  if (/no injected|not found|no provider/i.test(message)) {
    return 'No browser wallet detected. Install a wallet extension to continue.';
  }
  return message.split('\n')[0];
}
