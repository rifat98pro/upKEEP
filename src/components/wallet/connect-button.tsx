'use client';

import * as React from 'react';
import { AlertTriangle, Check, Copy, LogOut, Wallet } from 'lucide-react';
import { useArcWallet } from '@/hooks/use-arc-wallet';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatUsd } from '@upkeep/sdk';
import { cn } from '@/lib/utils';

/**
 * Connect / wrong-network / connected, in one control.
 *
 * Wrong network is treated as its own state rather than an error toast: it is
 * the single most common reason an action would fail, and it is fixable in one
 * click.
 */
export function ConnectButton({ className }: { className?: string }) {
  const wallet = useArcWallet();
  const { data: balance, isLoading: balanceLoading } = useUsdcBalance(wallet.address);
  const [copied, setCopied] = React.useState(false);

  const copyAddress = React.useCallback(() => {
    if (!wallet.address) return;
    navigator.clipboard.writeText(wallet.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, [wallet.address]);

  if (!wallet.isConnected) {
    return (
      <Button onClick={wallet.connect} loading={wallet.isConnecting} className={className}>
        {!wallet.isConnecting ? <Wallet aria-hidden /> : null}
        Connect wallet
      </Button>
    );
  }

  if (wallet.isWrongNetwork) {
    return (
      <Button
        variant="destructive"
        onClick={wallet.switchToArc}
        loading={wallet.isSwitching}
        className={className}
      >
        {!wallet.isSwitching ? <AlertTriangle aria-hidden /> : null}
        Switch to Arc Mainnet
      </Button>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="hidden items-center gap-2 rounded-md border bg-card px-3 py-1.5 sm:flex">
        {balanceLoading ? (
          <Skeleton className="h-4 w-16" />
        ) : (
          <span className="font-mono text-sm font-medium tabular">
            {balance !== null && balance !== undefined ? formatUsd(balance) : '-'}
          </span>
        )}
        <Badge variant="brand" className="px-1.5 py-0 text-2xs">
          USDC
        </Badge>
      </div>

      <Button variant="outline" size="sm" onClick={copyAddress} className="font-mono text-xs">
        {copied ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
        {wallet.shortAddress}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={wallet.disconnect}
        aria-label="Disconnect wallet"
      >
        <LogOut aria-hidden />
      </Button>
    </div>
  );
}
