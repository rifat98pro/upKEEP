'use client';

import * as React from 'react';
import Link from 'next/link';
import { ListChecks, Plus, Wallet } from 'lucide-react';
import type { ConditionStatus } from '@upkeep/sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { DemoModeBanner, NotDeployedBanner } from '@/components/layout/banners';
import { ConditionCard } from '@/components/conditions/condition-card';
import { useArcWallet } from '@/hooks/use-arc-wallet';
import { useConditions } from '@/hooks/use-conditions';
import { cn } from '@/lib/utils';
import { networkName } from '@/config/env';

type Filter = 'all' | 'active' | 'triggered' | 'paused';

const FILTERS: Array<{ value: Filter; label: string; matches: (s: ConditionStatus) => boolean }> = [
  { value: 'all', label: 'All', matches: () => true },
  { value: 'active', label: 'Active', matches: (s) => s === 'active' },
  { value: 'triggered', label: 'Triggered', matches: (s) => s === 'triggered' },
  { value: 'paused', label: 'Paused', matches: (s) => s === 'paused' || s === 'disabled' },
];

export default function ConditionsPage() {
  const wallet = useArcWallet();
  const { data, isLoading } = useConditions(wallet.address);
  const [filter, setFilter] = React.useState<Filter>('all');

  const conditions = data?.conditions ?? [];
  const active = FILTERS.find((f) => f.value === filter) ?? FILTERS[0];
  const filtered = conditions.filter((view) => active.matches(view.condition.status));

  return (
    <>
      <PageHeader
        title="Conditions"
        subtitle={`Persistent financial rules running on ${networkName}.`}
        action={
          <Button asChild>
            <Link href="/conditions/new">
              <Plus aria-hidden />
              Create condition
            </Link>
          </Button>
        }
      />

      <DemoModeBanner />
      <NotDeployedBanner />

      {wallet.isConnected ? (
        <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter conditions">
          {FILTERS.map((option) => {
            const count = conditions.filter((view) => option.matches(view.condition.status)).length;
            const selected = filter === option.value;
            return (
              <button
                key={option.value}
                role="tab"
                aria-selected={selected}
                onClick={() => setFilter(option.value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  selected
                    ? 'bg-secondary font-medium text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                {option.label}
                {count > 0 ? (
                  <span className="ml-1.5 font-mono text-xs tabular text-muted-foreground">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {!wallet.isConnected ? (
        <EmptyState
          icon={Wallet}
          title="Connect a wallet to get started"
          body="Your conditions live on Arc Mainnet and are read back from the registry with your address."
          action={
            <Button onClick={wallet.connect} loading={wallet.isConnecting}>
              Connect wallet
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : conditions.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No conditions yet"
          body="Create your first persistent financial condition."
          action={
            <Button asChild>
              <Link href="/conditions/new">
                <Plus aria-hidden />
                Create condition
              </Link>
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={`No ${active.label.toLowerCase()} conditions`}
          body="Nothing matches this filter right now."
          action={
            <Button variant="outline" onClick={() => setFilter('all')}>
              Show all conditions
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((view) => (
            <ConditionCard key={view.condition.id} view={view} />
          ))}
        </div>
      )}
    </>
  );
}

function CardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}
