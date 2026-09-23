'use client';

import Link from 'next/link';
import { ArrowRight, ListChecks, Plus, Wallet } from 'lucide-react';
import { formatUsd, formatUsdPrecise } from '@upkeep/sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { DemoModeBanner, NotDeployedBanner } from '@/components/layout/banners';
import { ConditionCard } from '@/components/conditions/condition-card';
import { useArcWallet } from '@/hooks/use-arc-wallet';
import { useConditions } from '@/hooks/use-conditions';
import { useExecutions } from '@/hooks/use-executions';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';

export default function DashboardPage() {
  const wallet = useArcWallet();
  const { data: conditionsData, isLoading: conditionsLoading } = useConditions(wallet.address);
  const { data: executionsData, isLoading: executionsLoading } = useExecutions();
  const { data: balance } = useUsdcBalance(wallet.address);

  const conditions = conditionsData?.conditions ?? [];
  const executions = executionsData?.executions ?? [];

  const activeCount = conditions.filter((view) => view.condition.status === 'active').length;
  const triggeredCount = conditions.filter((view) => view.condition.status === 'triggered').length;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Monitor your financial conditions and automated actions on Arc."
        action={
          <Button asChild>
            <Link href="/conditions/new">
              <Plus aria-hidden />
              New condition
            </Link>
          </Button>
        }
      />

      <DemoModeBanner />
      <NotDeployedBanner />

      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Active conditions"
          value={activeCount.toString()}
          loading={conditionsLoading}
          hint={conditions.length > 0 ? `${conditions.length} total` : undefined}
        />
        <Metric
          label="Triggered"
          value={triggeredCount.toString()}
          loading={conditionsLoading}
          hint={triggeredCount > 0 ? 'awaiting recovery' : undefined}
        />
        <Metric
          label="Executions"
          value={executionsData?.stats.totalExecutions.toString() ?? '0'}
          loading={executionsLoading}
        />
        <Metric
          label="Automated USDC"
          value={executionsData ? formatUsd(executionsData.stats.totalAutomated) : '$0.00'}
          loading={executionsLoading}
          hint={
            executionsData && executionsData.stats.totalFees > 0n
              ? `${formatUsdPrecise(executionsData.stats.totalFees)} in fees`
              : undefined
          }
        />
      </section>

      {!wallet.isConnected ? (
        <EmptyState
          icon={Wallet}
          title="Connect a wallet to get started"
          body="upKEEP reads your live USDC balance on Arc Mainnet to evaluate conditions. Nothing is stored on a server."
          action={
            <Button onClick={wallet.connect} loading={wallet.isConnecting}>
              Connect wallet
            </Button>
          }
        />
      ) : (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium">Conditions</h2>
            {conditions.length > 0 ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/conditions">
                  View all
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : null}
          </div>

          {conditionsLoading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <ConditionCardSkeleton />
              <ConditionCardSkeleton />
            </div>
          ) : conditions.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No conditions yet"
              body="Create your first persistent financial condition and upKEEP will evaluate it against Arc Mainnet until it becomes true."
              action={
                <Button asChild>
                  <Link href="/conditions/new">
                    <Plus aria-hidden />
                    Create condition
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {conditions.slice(0, 4).map((view) => (
                <ConditionCard key={view.condition.id} view={view} />
              ))}
            </div>
          )}
        </section>
      )}

      {wallet.isConnected && balance !== null && balance !== undefined ? (
        <p className="mt-8 text-xs text-muted-foreground">
          Connected wallet holds{' '}
          <span className="font-mono tabular">{formatUsd(balance)}</span> USDC on Arc Mainnet.
        </p>
      ) : null}
    </>
  );
}

function Metric({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="label-caps font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <>
            <div className="font-mono text-2xl font-medium tabular">{value}</div>
            {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ConditionCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}
