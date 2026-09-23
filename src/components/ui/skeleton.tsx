import * as React from 'react';
import { cn } from '@/lib/utils';

/** Skeleton placeholder. Never leave a blank screen while loading (§32). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton', className)} aria-hidden {...props} />;
}
