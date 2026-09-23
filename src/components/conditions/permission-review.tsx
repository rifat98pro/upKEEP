import { Ban, Check, ShieldCheck } from 'lucide-react';
import { computeFeeBreakdown, formatUsd, formatUsdPrecise } from '@upkeep/sdk';
import type { Address } from 'viem';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { networkName } from '@/config/env';
import { upkeepFeeBps } from '@/config/contracts';

export interface PermissionSummary {
  /** True for a "falls below" trigger, false for "rises above". */
  firesWhenBelow: boolean;
  threshold: bigint;
  amount: bigint;
  maxAmount: bigint;
  recipient: Address;
  monitoredWallet: Address;
  deposit?: bigint;
  rearmBuffer?: bigint;
  recurring: boolean;
}

/**
 * The permission review.
 *
 * This screen has one job: make the exact scope of what is being authorized
 * impossible to misread. It states the ceiling, the single destination, and -
 * just as importantly - what upKEEP will still not be able to do afterwards.
 * No persuasive wording, no reassurance that is not literally true.
 */
export function PermissionReview({ summary }: { summary: PermissionSummary }) {
  const fee = computeFeeBreakdown(summary.amount, upkeepFeeBps);

  return (
    <div className="space-y-5">
      <Alert variant="info">
        <ShieldCheck />
        <AlertTitle>You are authorizing the following automation</AlertTitle>
        <AlertDescription>
          upKEEP can only execute the action defined below. It never holds your keys, and you can
          pause or revoke it at any time.
        </AlertDescription>
      </Alert>

      <div className="rounded-lg border bg-card">
        <div className="space-y-0 divide-y">
          <Row label="Network" value={networkName} />
          <Row label="Asset" value="USDC" />
          <Row
            label="Monitored wallet"
            value={summary.monitoredWallet}
            mono
          />
          <Row
            label="Trigger"
            value={`USDC balance ${summary.firesWhenBelow ? 'falls below' : 'rises above'} ${formatUsd(summary.threshold)}`}
          />
          <Row label="Action" value="Transfer USDC" />
          <Row
            label="Maximum transfer"
            value={`${formatUsd(summary.maxAmount)} per execution`}
            emphasis
          />
          <Row label="Approved recipient" value={summary.recipient} mono emphasis />
          {summary.deposit !== undefined ? (
            <Row label="Vault deposit" value={formatUsd(summary.deposit)} />
          ) : null}
          <Row
            label="Repeats"
            value={
              summary.recurring
                ? recoveryDescription(summary)
                : 'No, fires once then retires'
            }
          />
        </div>
      </div>

      {/* §19: the fee must be visible before execution, never deducted silently. */}
      <div className="rounded-lg border bg-card p-4">
        <div className="label-caps mb-3">Per execution</div>
        <dl className="space-y-2 text-sm">
          <FeeRow label="Automation amount" value={formatUsd(fee.amount)} />
          <FeeRow
            label={`upKEEP fee (${(upkeepFeeBps / 100).toFixed(2)}%)`}
            value={formatUsdPrecise(fee.fee)}
            note={
              fee.capApplied
                ? 'capped at 1% of the transfer'
                : fee.minimumApplied
                  ? 'minimum fee applied'
                  : undefined
            }
          />
          <Separator />
          <FeeRow label="Recipient receives" value={formatUsd(fee.netAmount)} emphasis />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Arc network fees are paid in USDC by the keeper submitting the transaction and are shown
          on the execution record once it settles.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <div className="label-caps mb-2.5 text-success">Actions allowed</div>
          <ul className="space-y-2">
            <Permission allowed>Transfer up to {formatUsd(summary.maxAmount)} in USDC</Permission>
            <Permission allowed>Only to {shorten(summary.recipient)}</Permission>
            <Permission allowed>Only while the condition is true and armed</Permission>
          </ul>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="label-caps mb-2.5">Actions not allowed</div>
          <ul className="space-y-2">
            <Permission>Any other amount or recipient</Permission>
            <Permission>Any funds outside the vault</Permission>
            <Permission>Anything at all once paused or revoked</Permission>
            <Permission>Everything else</Permission>
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * How this condition re-arms, in the direction it actually fires.
 *
 * A "below" condition recovers by climbing back over the threshold; an "above"
 * condition recovers by falling back under it. Saying the wrong one would be
 * worse than saying nothing.
 */
function recoveryDescription(summary: PermissionSummary): string {
  const buffer = summary.rearmBuffer ?? 0n;

  if (summary.firesWhenBelow) {
    const level = summary.threshold + buffer;
    return buffer > 0n
      ? `Yes, once the balance climbs back past ${formatUsd(level)}`
      : 'Yes, once the balance recovers above the threshold';
  }

  // Guard the subtraction the same way the evaluator does.
  const level = buffer >= summary.threshold ? 0n : summary.threshold - buffer;
  return buffer > 0n
    ? `Yes, once the balance falls back under ${formatUsd(level)}`
    : 'Yes, once the balance falls back under the threshold';
}

function Row({
  label,
  value,
  mono,
  emphasis,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
      <span className="label-caps">{label}</span>
      <span
        className={[
          'text-right text-sm',
          mono ? 'break-all font-mono text-[0.8125rem]' : '',
          emphasis ? 'font-medium' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </span>
    </div>
  );
}

function FeeRow({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={emphasis ? 'font-medium' : 'text-muted-foreground'}>
        {label}
        {note ? <span className="ml-1.5 text-xs text-muted-foreground">({note})</span> : null}
      </dt>
      <dd className={`font-mono tabular ${emphasis ? 'font-medium' : ''}`}>{value}</dd>
    </div>
  );
}

function Permission({ children, allowed }: { children: React.ReactNode; allowed?: boolean }) {
  return (
    <li className={`flex items-start gap-2 text-sm ${allowed ? '' : 'text-muted-foreground'}`}>
      {allowed ? (
        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      ) : (
        <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      {children}
    </li>
  );
}

function shorten(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
