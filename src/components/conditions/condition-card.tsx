import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { formatUsd, type ConditionView } from '@upkeep/sdk';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConditionStatusBadge } from '@/components/conditions/status-badge';
import { RuleDisplay } from '@/components/conditions/rule-display';
import { conditionName } from '@/lib/condition-name';
import { timeAgo } from '@/lib/utils';

export function ConditionCard({ view }: { view: ConditionView }) {
  const { condition } = view;

  return (
    <Card className="transition-shadow hover:shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/conditions/${condition.id}`}
            className="font-medium tracking-tight hover:underline"
          >
            {conditionName(view)}
          </Link>
          <ConditionStatusBadge status={condition.status} animate />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <RuleDisplay view={view} compact />

        <div className="flex items-end justify-between border-t pt-3">
          <div>
            <div className="label-caps">
              {view.executable ? 'Due now' : condition.arm === 'fired' ? 'Awaiting recovery' : 'Distance to trigger'}
            </div>
            <div className="mt-0.5 font-mono text-sm font-medium tabular">
              {condition.arm === 'fired' || view.executable
                ? formatUsd(view.currentValue)
                : formatUsd(view.distanceToTrigger)}
            </div>
          </div>

          <Link
            href={`/conditions/${condition.id}`}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            View details
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>

        <div className="text-2xs text-muted-foreground">
          {condition.lastTriggeredAt
            ? `Last triggered ${timeAgo(condition.lastTriggeredAt)}`
            : `Created ${timeAgo(condition.createdAt)}`}
          {condition.triggerCount > 0
            ? ` · fired ${condition.triggerCount} time${condition.triggerCount === 1 ? '' : 's'}`
            : null}
        </div>
      </CardContent>
    </Card>
  );
}
