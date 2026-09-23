'use client';

import { Activity } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatGwei } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { networkName } from '@/config/env';

/**
 * The sidebar's network indicator.
 *
 * Reports what the RPC actually said. If the endpoint is unreachable it says
 * so, rather than showing a reassuring green dot for a connection that is not
 * there.
 */
export function NetworkStatusPanel({ className }: { className?: string }) {
  const { data, isLoading, isError } = useNetworkStatus();

  if (isLoading) {
    return (
      <div className={cn('space-y-2 px-3 py-3', className)}>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    );
  }

  const connected = Boolean(data?.connected) && !isError;
  const mismatch = Boolean(data?.chainMismatch);

  return (
    <div className={cn('px-3 py-3', className)}>
      <div className="label-caps mb-2">Network</div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{networkName}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  mismatch
                    ? 'bg-destructive'
                    : connected
                      ? 'animate-pulse-dot bg-success'
                      : 'bg-destructive',
                )}
              />
              <span
                className={cn(
                  'text-xs',
                  mismatch || !connected ? 'text-destructive' : 'text-success',
                )}
              >
                {mismatch ? 'Wrong chain' : connected ? 'Connected' : 'Offline'}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            {connected ? (
              <div className="space-y-0.5">
                <div>Block {data?.blockNumber?.toString()}</div>
                <div>Gas {formatGwei(data?.gasPrice)}</div>
                <div>{data?.latencyMs}ms round trip</div>
              </div>
            ) : (
              <span>{data?.error ?? 'The Arc RPC endpoint did not respond.'}</span>
            )}
          </TooltipContent>
        </Tooltip>
      </div>

      {connected && !mismatch ? (
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
          <Activity className="size-3" aria-hidden />
          <span className="tabular">#{data?.blockNumber?.toString()}</span>
          <span aria-hidden>·</span>
          <span className="tabular">{formatGwei(data?.gasPrice, 1)}</span>
        </div>
      ) : null}
    </div>
  );
}
