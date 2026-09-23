'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Pause,
  Play,
  Receipt,
  RotateCcw,
  ShieldOff,
} from 'lucide-react';
import { formatUsd, formatUsdPrecise } from '@upkeep/sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { DemoModeBanner } from '@/components/layout/banners';
import { ConditionStatusBadge } from '@/components/conditions/status-badge';
import { RuleDisplay } from '@/components/conditions/rule-display';
import { ExecutionTable } from '@/components/executions/execution-table';
import { SecuritySection } from '@/components/conditions/security-section';
import { useCondition, useVaultInfo } from '@/hooks/use-conditions';
import { useExecutions } from '@/hooks/use-executions';
import { useUpkeepActions } from '@/hooks/use-upkeep-actions';
import { useArcWallet } from '@/hooks/use-arc-wallet';
import { conditionName } from '@/lib/condition-name';
import { explorerAddressLink, networkName } from '@/config/env';
import { upkeepFeeBps } from '@/config/contracts';
import { computeFeeBreakdown } from '@upkeep/sdk';
import { formatDateTime, shortenAddress, timeAgo } from '@/lib/utils';

export default function ConditionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const wallet = useArcWallet();

  const { data: view, isLoading, isError } = useCondition(params.id);
  const { data: vault } = useVaultInfo(view?.action.vault);
  const { data: executionsData } = useExecutions({ conditionId: params.id });
  const actions = useUpkeepActions();

  const [confirmRevoke, setConfirmRevoke] = React.useState(false);

  if (isLoading) return <DetailSkeleton />;

  if (isError || !view) {
    return (
      <>
        <PageHeader title="Condition" />
        <EmptyState
          icon={AlertTriangle}
          title="Condition not found"
          body={`No condition with id ${params.id} exists in the registry on ${networkName}.`}
          action={
            <Button variant="outline" asChild>
              <Link href="/conditions">Back to conditions</Link>
            </Button>
          }
        />
      </>
    );
  }

  const { condition, action } = view;
  const isOwner = wallet.address?.toLowerCase() === condition.owner.toLowerCase();
  const fee = computeFeeBreakdown(action.amount, vault?.feeBps ?? upkeepFeeBps);
  const executions = executionsData?.executions ?? [];

  return (
    <>
      <PageHeader
        title={conditionName(view)}
        subtitle={`Condition #${condition.id} on ${networkName}`}
        action={
          <Button variant="ghost" onClick={() => router.push('/conditions')}>
            <ArrowLeft aria-hidden />
            All conditions
          </Button>
        }
      />

      <DemoModeBanner />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <ConditionStatusBadge status={condition.status} animate />
        {condition.arm === 'fired' ? <Badge variant="muted">Latched</Badge> : null}
        {!condition.recurring ? <Badge variant="outline">One-shot</Badge> : null}
        {view.executable ? <Badge variant="warning">Due now</Badge> : null}
        {view.rearmable ? <Badge variant="info">Ready to re-arm</Badge> : null}
      </div>

      {vault?.revoked ? (
        <Alert variant="destructive" className="mb-6">
          <ShieldOff />
          <AlertTitle>Automation revoked</AlertTitle>
          <AlertDescription>
            The vault backing this condition has had its executor removed. Nothing can execute until
            you re-authorize it.
          </AlertDescription>
        </Alert>
      ) : vault?.paused ? (
        <Alert variant="warning" className="mb-6">
          <Pause />
          <AlertTitle>Vault paused</AlertTitle>
          <AlertDescription>
            This condition keeps evaluating, but no transfer can execute while the vault is paused.
          </AlertDescription>
        </Alert>
      ) : vault && vault.balance < action.amount ? (
        <Alert variant="warning" className="mb-6">
          <AlertTriangle />
          <AlertTitle>Vault underfunded</AlertTitle>
          <AlertDescription>
            The vault holds {formatUsd(vault.balance)} but this action needs{' '}
            {formatUsd(action.amount)}. Top it up on the{' '}
            <Link href="/wallets" className="underline underline-offset-4">
              Wallets page
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Rule</CardTitle>
            </CardHeader>
            <CardContent>
              <RuleDisplay view={view} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Live state</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Figure label="Current balance" value={formatUsd(view.currentValue)} />
                <Figure label="Threshold" value={formatUsd(condition.threshold)} />
                <Figure
                  label="Distance"
                  value={
                    view.executable || condition.arm === 'fired'
                      ? (condition.operator === 1 ? 'Below threshold' : 'Above threshold')
                      : formatUsd(view.distanceToTrigger)
                  }
                  tone={view.executable ? 'warning' : undefined}
                />
              </div>

              <DistanceBar view={view} />

              <div className="grid grid-cols-2 gap-4 border-t pt-4 text-sm sm:grid-cols-3">
                <Detail label="Monitored wallet">
                  <ExplorerLink address={condition.subject} />
                </Detail>
                <Detail label="Times fired">
                  <span className="font-mono tabular">{condition.triggerCount}</span>
                </Detail>
                <Detail label="Created">{timeAgo(condition.createdAt)}</Detail>
                {condition.lastTriggeredAt ? (
                  <Detail label="Last triggered">{formatDateTime(condition.lastTriggeredAt)}</Detail>
                ) : null}
                {condition.rearmBuffer > 0n ? (
                  <Detail label="Re-arm at">{formatUsd(rearmLevel(condition))}</Detail>
                ) : null}
              </div>

              <p className="text-2xs text-muted-foreground">
                Balances are read live from {networkName}. The registry timestamp updates only on
                on-chain transitions, not on every poll.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Execution history</CardTitle>
            </CardHeader>
            <CardContent>
              {executions.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="No automated executions yet"
                  body="When this condition becomes true, the execution will appear here with its Arc transaction hash."
                  className="border-0 py-8"
                />
              ) : (
                <ExecutionTable executions={executions} compact />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Automation permission</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <PermissionRow label="Asset" value="USDC" />
              <PermissionRow label="Maximum transfer" value={`${formatUsd(action.maxAmount)} per execution`} />
              <PermissionRow label="Approved recipient">
                <ExplorerLink address={action.recipient} />
              </PermissionRow>
              <PermissionRow label="Vault">
                <ExplorerLink address={action.vault} />
              </PermissionRow>
              {vault ? (
                <PermissionRow label="Vault balance" value={formatUsd(vault.balance)} />
              ) : null}
              <PermissionRow label="Network" value={networkName} />

              <Separator />

              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Per execution</span>
                  <span className="font-mono tabular">{formatUsd(fee.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    upKEEP fee ({((vault?.feeBps ?? upkeepFeeBps) / 100).toFixed(2)}%)
                  </span>
                  <span className="font-mono tabular">{formatUsdPrecise(fee.fee)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Recipient receives</span>
                  <span className="font-mono tabular">{formatUsd(fee.netAmount)}</span>
                </div>
              </div>

              <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                upKEEP can only execute the action defined above. It cannot change the amount, the
                recipient, or reach any funds outside this vault.
              </p>
            </CardContent>
          </Card>

          <SecuritySection vault={action.vault} />

          <Card>
            <CardHeader>
              <CardTitle>Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!isOwner ? (
                <p className="text-sm text-muted-foreground">
                  Only the owner ({shortenAddress(condition.owner)}) can control this condition.
                </p>
              ) : (
                <>
                  {condition.status === 'paused' ? (
                    <Button
                      className="w-full"
                      onClick={() => actions.resumeCondition(condition.id)}
                      loading={actions.isBusy}
                    >
                      <Play aria-hidden />
                      Resume automation
                    </Button>
                  ) : condition.status === 'active' || condition.status === 'triggered' ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => actions.pauseCondition(condition.id)}
                      loading={actions.isBusy}
                    >
                      <Pause aria-hidden />
                      Pause automation
                    </Button>
                  ) : null}

                  {view.rearmable ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => actions.rearmCondition(condition.id)}
                      loading={actions.isBusy}
                    >
                      <RotateCcw aria-hidden />
                      Re-arm now
                    </Button>
                  ) : null}

                  {condition.status !== 'disabled' ? (
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={() => setConfirmRevoke(true)}
                      disabled={actions.isBusy}
                    >
                      <ShieldOff aria-hidden />
                      Revoke condition
                    </Button>
                  ) : null}

                  <p className="pt-1 text-xs text-muted-foreground">
                    Revoking retires the condition permanently. Your vault funds stay yours and can
                    be withdrawn from the Wallets page at any time.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this condition?</DialogTitle>
            <DialogDescription>
              This permanently retires condition #{condition.id}. It cannot be resumed afterwards,
              and you would need to create a new one. Your vault funds are unaffected and remain
              withdrawable.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRevoke(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={actions.isBusy}
              onClick={async () => {
                await actions.disableCondition(condition.id);
                setConfirmRevoke(false);
              }}
            >
              Revoke condition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/*//////////////////////////////////////////////////////////////
                             PIECES
//////////////////////////////////////////////////////////////*/

function DistanceBar({ view }: { view: ReturnType<typeof useCondition>['data'] }) {
  if (!view) return null;

  const { condition, currentValue } = view;
  // Scale the bar against twice the threshold, so the threshold sits mid-way and
  // the marker has room to move in both directions.
  const ceiling = condition.threshold * 2n;
  const clamped = currentValue > ceiling ? ceiling : currentValue;
  const percent = ceiling === 0n ? 0 : Number((clamped * 100n) / ceiling);
  const thresholdPercent = 50;

  /*
   * Amber means "in the firing zone", which is the opposite side of the
   * threshold for each direction. Colouring by "is it below" would paint an
   * above-condition green at the exact moment it is due to fire.
   */
  const firesWhenBelow = condition.operator === 1;
  const inFiringZone = firesWhenBelow
    ? currentValue < condition.threshold
    : currentValue > condition.threshold;

  return (
    <div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={inFiringZone ? 'h-full bg-warning' : 'h-full bg-success'}
          style={{ width: `${Math.max(percent, 1)}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-foreground/50"
          style={{ left: `${thresholdPercent}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-1.5 flex justify-between text-2xs text-muted-foreground">
        <span>$0</span>
        <span>{formatUsd(condition.threshold)} threshold</span>
        <span>{formatUsd(ceiling)}</span>
      </div>
    </div>
  );
}

/**
 * The level the subject must reach to re-arm, in the direction it fires.
 *
 * Mirrors BalanceThresholdEvaluator.canRearm: a "below" condition recovers by
 * climbing past threshold + buffer, an "above" condition by falling under
 * threshold - buffer, with the subtraction floored at zero the same way.
 */
function rearmLevel(condition: { threshold: bigint; rearmBuffer: bigint; operator: number }): bigint {
  if (condition.operator === 1) return condition.threshold + condition.rearmBuffer;
  return condition.rearmBuffer >= condition.threshold
    ? 0n
    : condition.threshold - condition.rearmBuffer;
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div>
      <div className="label-caps">{label}</div>
      <div
        className={`mt-1 font-mono text-lg font-medium tabular ${tone === 'warning' ? 'text-warning' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-caps">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function PermissionRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children ?? value}</span>
    </div>
  );
}

function ExplorerLink({ address }: { address: string }) {
  return (
    <a
      href={explorerAddressLink(address)}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-mono text-[0.8125rem] hover:underline"
    >
      {shortenAddress(address, 6)}
      <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
    </a>
  );
}

function DetailSkeleton() {
  return (
    <>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Skeleton className="h-52 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
        </div>
      </div>
    </>
  );
}
