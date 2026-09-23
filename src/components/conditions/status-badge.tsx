import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ConditionStatus } from '@upkeep/sdk';

const STATUS_META: Record<
  ConditionStatus,
  { label: string; variant: React.ComponentProps<typeof Badge>['variant']; dot: string }
> = {
  active: { label: 'Active', variant: 'success', dot: 'bg-success' },
  triggered: { label: 'Triggered', variant: 'warning', dot: 'bg-warning' },
  paused: { label: 'Paused', variant: 'muted', dot: 'bg-muted-foreground' },
  executed: { label: 'Executed', variant: 'info', dot: 'bg-info' },
  disabled: { label: 'Revoked', variant: 'muted', dot: 'bg-muted-foreground' },
  none: { label: 'Unknown', variant: 'muted', dot: 'bg-muted-foreground' },
};

export function ConditionStatusBadge({
  status,
  className,
  animate = false,
}: {
  status: ConditionStatus;
  className?: string;
  animate?: boolean;
}) {
  const meta = STATUS_META[status] ?? STATUS_META.none;

  return (
    <Badge variant={meta.variant} className={className}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          meta.dot,
          // Only a live, evaluating condition pulses. A paused one must look still.
          animate && status === 'active' && 'animate-pulse-dot',
        )}
      />
      {meta.label}
    </Badge>
  );
}

const EXECUTION_META = {
  confirmed: { label: 'Confirmed', variant: 'success' as const },
  pending: { label: 'Pending', variant: 'warning' as const },
  failed: { label: 'Failed', variant: 'destructive' as const },
  reverted: { label: 'Reverted', variant: 'destructive' as const },
};

export function ExecutionStatusBadge({ status }: { status: keyof typeof EXECUTION_META }) {
  const meta = EXECUTION_META[status] ?? EXECUTION_META.pending;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
