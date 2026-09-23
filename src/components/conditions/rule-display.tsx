import { ArrowDown } from 'lucide-react';
import { formatUsd, type ConditionView } from '@upkeep/sdk';
import { cn, shortenAddress } from '@/lib/utils';

/**
 * The IF / THEN / TO rule, rendered the way upKEEP talks about conditions
 * everywhere else: a sentence you can read at a glance, with the numbers
 * carrying the emphasis rather than the chrome.
 */
export function RuleDisplay({
  view,
  className,
  compact = false,
}: {
  view: ConditionView;
  className?: string;
  compact?: boolean;
}) {
  const { condition, action } = view;
  const firesWhenBelow = condition.operator === 1;

  return (
    <div className={cn('space-y-3', className)}>
      <RuleRow
        label="If"
        compact={compact}
        primary={`${condition.asset} balance`}
        operator={firesWhenBelow ? 'falls below' : 'rises above'}
        value={formatUsd(condition.threshold)}
      />

      <Connector compact={compact} />

      <RuleRow
        label="Then"
        compact={compact}
        primary="Transfer"
        value={formatUsd(action.amount)}
        suffix="USDC"
      />

      <Connector compact={compact} />

      <RuleRow label="To" compact={compact} primary={shortenAddress(action.recipient, 6)} mono />
    </div>
  );
}

function Connector({ compact }: { compact?: boolean }) {
  return (
    <div className={cn('flex justify-start', compact ? 'pl-[3.25rem]' : 'pl-16')} aria-hidden>
      <ArrowDown className="size-3.5 text-muted-foreground/40" />
    </div>
  );
}

function RuleRow({
  label,
  primary,
  operator,
  value,
  suffix,
  mono,
  compact,
}: {
  label: string;
  primary: string;
  operator?: string;
  value?: string;
  suffix?: string;
  mono?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span
        className={cn(
          'label-caps shrink-0 text-right',
          compact ? 'w-12' : 'w-14',
        )}
      >
        {label}
      </span>
      <span className={cn('text-sm', mono && 'font-mono text-[0.8125rem]')}>{primary}</span>
      {operator ? <span className="text-sm text-muted-foreground">{operator}</span> : null}
      {value ? (
        <span className="font-mono text-sm font-medium tabular">
          {value}
          {suffix ? <span className="ml-1 text-muted-foreground">{suffix}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
