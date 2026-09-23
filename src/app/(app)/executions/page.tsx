'use client';

import { Receipt } from 'lucide-react';
import { formatUsd, formatUsdPrecise } from '@upkeep/sdk';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { DemoModeBanner, NotDeployedBanner } from '@/components/layout/banners';
import { ExecutionTable } from '@/components/executions/execution-table';
import { useExecutions } from '@/hooks/use-executions';
import { networkName } from '@/config/env';

export default function ExecutionsPage() {
  const { data, isLoading } = useExecutions();
  const executions = data?.executions ?? [];

  return (
    <>
      <PageHeader
        title="Executions"
        subtitle={`Every automated action upKEEP has performed on ${networkName}.`}
      />

      <DemoModeBanner />
      <NotDeployedBanner />

      {!isLoading && executions.length > 0 ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Executions" value={data!.stats.totalExecutions.toString()} />
          <Stat label="USDC automated" value={formatUsd(data!.stats.totalAutomated)} />
          <Stat label="Protocol fees" value={formatUsdPrecise(data!.stats.totalFees)} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : executions.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No automated executions yet"
              body={`When one of your conditions becomes true, the execution appears here with its real ${networkName} transaction hash.`}
              className="border-0 py-10"
            />
          ) : (
            <ExecutionTable executions={executions} />
          )}
        </CardContent>
      </Card>

      {executions.length > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Rows are read back from the executor&apos;s on-chain logs, so every one corresponds to a
          transaction that actually landed on {networkName}.
        </p>
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="label-caps">{label}</div>
        <div className="mt-1 font-mono text-xl font-medium tabular">{value}</div>
      </CardContent>
    </Card>
  );
}
