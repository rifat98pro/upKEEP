'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Loader2,
  Percent,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { formatUsd, parseUsdc, type ConditionTypeName } from '@upkeep/sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { NotDeployedBanner } from '@/components/layout/banners';
import { PermissionReview } from '@/components/conditions/permission-review';
import { useArcWallet } from '@/hooks/use-arc-wallet';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { useUpkeepActions } from '@/hooks/use-upkeep-actions';
import { isProtocolDeployed } from '@/config/contracts';
import { networkName } from '@/config/env';
import { cn, shortenAddress } from '@/lib/utils';

/*//////////////////////////////////////////////////////////////
                             VALIDATION
//////////////////////////////////////////////////////////////*/

/** A USDC amount that parseUsdc can represent exactly and that is positive. */
const usdcAmount = (field: string) =>
  z
    .string()
    .min(1, `${field} is required`)
    .refine((value) => {
      try {
        return parseUsdc(value) > 0n;
      } catch {
        return false;
      }
    }, `${field} must be a positive USDC amount`);

const addressField = (field: string) =>
  z
    .string()
    .min(1, `${field} is required`)
    // Boolean() keeps isAddress's type guard from narrowing the inferred type
    // to `0x${string}`, which would make the empty default value invalid.
    .refine((value) => Boolean(isAddress(value)), `${field} must be a valid address`);

/**
 * How long a repeating schedule stays firable within each cycle.
 *
 * It has to comfortably exceed the keeper's poll interval (30s by default), or
 * a cycle can pass unnoticed between two sweeps. Ten minutes leaves room for a
 * slow RPC and a retry without making the window feel imprecise.
 */
const FIRING_WINDOW_SECONDS = 10 * 60;

/** True for the condition types whose threshold is a moment, not money. */
function isSchedule(type: string): boolean {
  return type === 'SCHEDULE_AT' || type === 'SCHEDULE_EVERY';
}

const schema = z
  .object({
    conditionType: z.enum(['BALANCE_BELOW', 'BALANCE_ABOVE', 'SCHEDULE_AT', 'SCHEDULE_EVERY']),
    monitoredWallet: addressField('Monitored wallet'),
    /*
     * Money for a balance condition, unused for a schedule. Validated in a
     * refine rather than here, because a schedule has no threshold to type and
     * a required-USDC rule would block the form on a hidden field.
     */
    threshold: z.string(),
    /** Local datetime for a schedule. Empty for balance conditions. */
    scheduleAt: z.string().optional(),
    /** Cycle length in seconds, or '0' for a one-off deadline. */
    scheduleEvery: z.string().optional(),
    rearmBuffer: z.string().optional(),
    amount: usdcAmount('Transfer amount'),
    recipient: addressField('Recipient'),
    deposit: usdcAmount('Vault deposit'),
    /** Optional daily spending cap on the vault. Empty means no cap. */
    dailyLimit: z.string().optional(),
    recurring: z.boolean(),
  })
  .refine(
    (data) => {
      // A schedule has no monetary threshold; a balance condition must have one.
      if (isSchedule(data.conditionType)) return true;
      try {
        return parseUsdc(data.threshold) > 0n;
      } catch {
        return false;
      }
    },
    { message: 'Threshold must be a USDC amount greater than zero', path: ['threshold'] },
  )
  .refine(
    (data) => {
      if (!isSchedule(data.conditionType)) return true;
      if (!data.scheduleAt) return false;
      return !Number.isNaN(Date.parse(data.scheduleAt));
    },
    { message: 'Pick the date and time this should start', path: ['scheduleAt'] },
  )
  .refine(
    (data) => {
      /*
       * A one-off scheduled in the past would fire the instant it is created,
       * which is almost never what someone meant to build. A repeating schedule
       * may legitimately start in the past - it just begins at its next window.
       */
      if (data.conditionType !== 'SCHEDULE_AT' || !data.scheduleAt) return true;
      return Date.parse(data.scheduleAt) > Date.now();
    },
    { message: 'A one-off schedule must be in the future', path: ['scheduleAt'] },
  )
  .refine(
    (data) => {
      if (!data.dailyLimit) return true;
      try {
        // A cap below one transfer would stop the first execution outright,
        // which is a limit nobody means to set.
        return parseUsdc(data.dailyLimit) >= parseUsdc(data.amount);
      } catch {
        return false;
      }
    },
    {
      message: 'The daily limit must be at least one transfer amount',
      path: ['dailyLimit'],
    },
  )
  .refine(
    (data) => {
      try {
        return parseUsdc(data.deposit) >= parseUsdc(data.amount);
      } catch {
        return false;
      }
    },
    {
      message: 'The vault deposit must cover at least one transfer',
      path: ['deposit'],
    },
  )
  .refine(
    (data) => {
      try {
        // Sending to the wallet being monitored would make the condition
        // self-satisfying in the wrong direction, which is never what is meant.
        return data.recipient.toLowerCase() !== data.monitoredWallet.toLowerCase();
      } catch {
        return false;
      }
    },
    {
      message: 'The recipient must be different from the monitored wallet',
      path: ['recipient'],
    },
  )
  .refine(
    (data) => {
      try {
        if (!data.rearmBuffer) return true;
        return parseUsdc(data.rearmBuffer) >= 0n;
      } catch {
        return false;
      }
    },
    { message: 'Re-arm buffer must be a USDC amount', path: ['rearmBuffer'] },
  )
  .refine(
    (data) => {
      /*
       * An "above" condition re-arms by falling back under threshold - buffer.
       * A buffer at or over the threshold floors that level at zero, so the
       * condition could only ever re-arm on a completely empty wallet - a
       * recurring rule that silently behaves as one-shot. The contract handles
       * it safely; this stops anyone creating it by accident.
       */
      if (data.conditionType !== 'BALANCE_ABOVE' || !data.rearmBuffer) return true;
      try {
        return parseUsdc(data.rearmBuffer) < parseUsdc(data.threshold);
      } catch {
        return true; // a malformed amount is reported by its own rule
      }
    },
    {
      message:
        'For a "greater than" condition the buffer must be smaller than the threshold, or it could only re-arm at a zero balance',
      path: ['rearmBuffer'],
    },
  );

type FormValues = z.infer<typeof schema>;

const STEPS = ['Monitor', 'Condition', 'Action', 'Review'] as const;

/*//////////////////////////////////////////////////////////////
                               PAGE
//////////////////////////////////////////////////////////////*/

export default function NewConditionPage() {
  const router = useRouter();
  const wallet = useArcWallet();
  const { data: balance } = useUsdcBalance(wallet.address);
  const actions = useUpkeepActions();

  const [step, setStep] = React.useState(0);
  const [vaultAddress, setVaultAddress] = React.useState<Address>();
  const [submitting, setSubmitting] = React.useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      conditionType: 'BALANCE_BELOW',
      monitoredWallet: '',
      threshold: '',
      rearmBuffer: '',
      amount: '',
      recipient: '',
      deposit: '',
      dailyLimit: '',
      scheduleAt: '',
      scheduleEvery: '0',
      recurring: true,
    },
  });

  // Default the monitored wallet to the connected account once it is known.
  React.useEffect(() => {
    if (wallet.address && !form.getValues('monitoredWallet')) {
      form.setValue('monitoredWallet', wallet.address, { shouldValidate: true });
    }
  }, [wallet.address, form]);

  const values = form.watch();

  const stepValid = React.useMemo(() => {
    const errors = form.formState.errors;
    switch (step) {
      case 0:
        return true;
      case 1: {
        if (isSchedule(values.conditionType)) {
          return Boolean(values.monitoredWallet && values.scheduleAt) &&
            !errors.monitoredWallet &&
            !errors.scheduleAt;
        }
        return (
          Boolean(values.monitoredWallet && values.threshold) &&
          !errors.monitoredWallet &&
          !errors.threshold
        );
      }
      case 2:
        return (
          Boolean(values.amount && values.recipient && values.deposit) &&
          !errors.amount &&
          !errors.recipient &&
          !errors.deposit
        );
      default:
        return form.formState.isValid;
    }
  }, [step, values, form.formState]);

  async function onSubmit(data: FormValues) {
    setSubmitting(true);
    try {
      /*
       * Two transactions, in this order and no other:
       *
       *   1. Deploy the vault - the bounded permission. It has to exist before
       *      a condition can reference it, and the registry cross-checks the
       *      vault's recipient and ceiling at creation.
       *   2. Create the condition bound to that vault.
       *
       * If the second fails, the user still owns a funded vault and can
       * withdraw from it. Nothing is stranded.
       */
      let vault = vaultAddress;

      if (!vault) {
        const created = await actions.createVault({
          recipient: data.recipient as Address,
          maxPerExecution: data.amount,
          maxPerDay: data.dailyLimit || undefined,
          deposit: data.deposit,
        });
        if (!created?.vault) return;
        vault = created.vault;
        setVaultAddress(vault);
      }

      const scheduled = isSchedule(data.conditionType);

      /*
       * `datetime-local` has no timezone, so `new Date(value)` reads it in the
       * browser's zone - which is what the person typing it meant. The SDK
       * converts to Unix seconds from there.
       */
      const startsAt = data.scheduleAt ? new Date(data.scheduleAt) : undefined;
      const cycleSeconds = Number(data.scheduleEvery ?? '0');

      const result = await actions.createCondition({
        wallet: data.monitoredWallet as Address,
        type: data.conditionType,
        asset: 'USDC',
        threshold: scheduled && startsAt ? startsAt : data.threshold,
        schedule:
          data.conditionType === 'SCHEDULE_EVERY'
            ? { every: cycleSeconds, window: FIRING_WINDOW_SECONDS }
            : undefined,
        rearmBuffer: scheduled ? undefined : data.rearmBuffer || undefined,
        recurring: data.conditionType === 'SCHEDULE_AT' ? false : data.recurring,
        vault,
        action: {
          type: 'TRANSFER_USDC',
          amount: data.amount,
          recipient: data.recipient as Address,
        },
      });

      if (result) router.push(`/conditions/${result.conditionId}`);
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || actions.isBusy;

  return (
    <>
      <PageHeader
        title="Create condition"
        subtitle="Define a persistent financial condition and the single action it may perform."
        action={
          <Button variant="ghost" onClick={() => router.back()}>
            <ArrowLeft aria-hidden />
            Back
          </Button>
        }
      />

      <NotDeployedBanner />

      <Stepper step={step} />

      {!wallet.isConnected ? (
        <Alert className="mt-6">
          <Wallet />
          <AlertTitle>Connect a wallet to continue</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>upKEEP needs your address to create the condition on {networkName}.</span>
            <Button size="sm" onClick={wallet.connect} loading={wallet.isConnecting}>
              Connect wallet
            </Button>
          </AlertDescription>
        </Alert>
      ) : wallet.isWrongNetwork ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Wrong network</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>Your wallet is not on {networkName}.</span>
            <Button size="sm" onClick={wallet.switchToArc} loading={wallet.isSwitching}>
              Switch to {networkName}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6">
          {step === 0 ? <StepMonitor form={form} /> : null}
          {step === 1 ? <StepCondition form={form} balance={balance ?? undefined} /> : null}
          {step === 2 ? <StepAction form={form} /> : null}
          {step === 3 ? <StepReview values={values} vaultAddress={vaultAddress} /> : null}

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || busy}
            >
              <ArrowLeft aria-hidden />
              Back
            </Button>

            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                disabled={!stepValid || busy}
              >
                Continue
                <ArrowRight aria-hidden />
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => router.push('/conditions')} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" loading={busy} disabled={!isProtocolDeployed}>
                  {!busy ? <ShieldCheck aria-hidden /> : null}
                  Confirm and activate
                </Button>
              </div>
            )}
          </div>

          {busy ? <TransactionProgress phase={actions.state.phase} vaultCreated={Boolean(vaultAddress)} /> : null}

          {actions.state.phase === 'failed' && actions.state.error ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Could not complete</AlertTitle>
              <AlertDescription>{actions.state.error}</AlertDescription>
            </Alert>
          ) : null}
        </form>
      )}
    </>
  );
}

/*//////////////////////////////////////////////////////////////
                              STEPS
//////////////////////////////////////////////////////////////*/

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((label, index) => {
        const done = index < step;
        const current = index === step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-xs',
                done && 'border-brand bg-brand text-brand-foreground',
                current && 'border-foreground font-medium',
                !done && !current && 'text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3" aria-hidden /> : index + 1}
            </span>
            <span className={cn(current ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
            {index < STEPS.length - 1 ? (
              <span className="mx-1 h-px w-6 bg-border sm:w-10" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StepMonitor({ form }: { form: UseFormReturn<FormValues> }) {
  const selected = form.watch('conditionType');
  const scheduled = isSchedule(selected);

  /*
   * Picking a data source, not a comparison. The operator (below/above, or the
   * repeat cycle) belongs to the next step, because it only makes sense once
   * you know what is being watched.
   */
  function choose(kind: 'balance' | 'schedule') {
    form.setValue('conditionType', kind === 'balance' ? 'BALANCE_BELOW' : 'SCHEDULE_AT', {
      shouldValidate: true,
    });
  }

  const options = [
    {
      id: 'balance' as const,
      icon: Wallet,
      title: 'USDC balance',
      body: "Fires when a wallet's native USDC balance on Arc crosses a threshold.",
      active: !scheduled,
    },
    {
      id: 'schedule' as const,
      icon: Clock,
      title: 'Time or schedule',
      body: 'Fires when the clock reaches a moment, once or on a repeating cycle.',
      active: scheduled,
    },
  ];

  return (
    <Card>
      <CardContent className="pt-5">
        <h2 className="font-medium">What should upKEEP monitor?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          upKEEP is a condition engine. Each of these is a separate evaluator registered on the
          same engine - adding one changed nothing that holds funds.
        </p>

        <div className="mt-5 space-y-3">
          {options.map((option) => (
            <label
              key={option.id}
              className={
                option.active
                  ? 'flex cursor-pointer items-start gap-3 rounded-lg border-2 border-brand bg-brand-subtle p-4'
                  : 'flex cursor-pointer items-start gap-3 rounded-lg border-2 border-transparent bg-card p-4 ring-1 ring-border hover:ring-brand/50'
              }
            >
              <input
                type="radio"
                name="monitorKind"
                className="sr-only"
                checked={option.active}
                onChange={() => choose(option.id)}
              />
              <span
                className={
                  option.active
                    ? 'mt-0.5 flex size-4 items-center justify-center rounded-full border-2 border-brand'
                    : 'mt-0.5 flex size-4 items-center justify-center rounded-full border-2 border-muted-foreground/40'
                }
              >
                {option.active ? <span className="size-2 rounded-full bg-brand" aria-hidden /> : null}
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <option.icon className="size-4 shrink-0 text-brand" aria-hidden />
                  <span className="font-medium">{option.title}</span>
                  <Badge variant="brand">Available</Badge>
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{option.body}</span>
              </span>
            </label>
          ))}

          {/*
            Spending limits exist, but not as a condition.
            
            A condition fires an action, and the useful response to "too much
            has been spent" is to stop - which is not an action and should not
            become one. So the cap lives on the vault, beside the recipient and
            the per-transfer ceiling, where it is enforced inside the transfer
            itself. No keeper, nothing to race.

            Watching an arbitrary wallet's outflow remains impossible: chain
            state records balances, not flows, and an evaluator is a view
            function. That is a different feature from this one.
          */}
          <div className="flex items-start gap-3 rounded-lg border border-dashed p-4">
            <Percent className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-muted-foreground">Daily spending limit</span>
                <Badge variant="muted">Set in step 3</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Capping what automation may move per day is a permission, not a trigger. Set it on
                the vault in the Action step and it is enforced on every transfer, whatever the
                condition does.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The schedule variant of step 2.
 *
 * Deliberately not the balance form with different labels. A schedule has no
 * threshold to type, no re-arm buffer to tune (the gap between cycles is the
 * hysteresis), and its "operator" is a repeat cycle rather than a comparison.
 */
function StepSchedule({ form }: { form: UseFormReturn<FormValues> }) {
  const { register, formState, watch, setValue } = form;
  const every = watch('scheduleEvery') ?? '0';
  const startsAt = watch('scheduleAt');

  const cycles = [
    { value: '0', label: 'Once, then retire' },
    { value: '3600', label: 'Every hour' },
    { value: '86400', label: 'Every day' },
    { value: '604800', label: 'Every week' },
  ];

  function chooseCycle(value: string) {
    setValue('scheduleEvery', value, { shouldValidate: true });
    // The cycle decides the condition type: no cycle is a one-off deadline.
    setValue('conditionType', value === '0' ? 'SCHEDULE_AT' : 'SCHEDULE_EVERY', {
      shouldValidate: true,
    });
  }

  const repeats = every !== '0';

  return (
    <Card>
      <CardContent className="space-y-5 pt-5">
        <div>
          <h2 className="font-medium">When should it fire?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Evaluated on-chain against block time, the same way a balance condition is evaluated
            against a balance.
          </p>
        </div>

        <Field label="Repeat" error={formState.errors.scheduleEvery?.message}>
          <Select value={every} onValueChange={chooseCycle}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cycles.map((cycle) => (
                <SelectItem key={cycle.value} value={cycle.value}>
                  {cycle.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={repeats ? 'Not before' : 'Fire at'}
          error={formState.errors.scheduleAt?.message}
          hint={
            repeats
              ? 'The schedule will not fire before this moment. Cycles run on UTC boundaries, so "every day" means midnight UTC.'
              : 'Fires once when this moment passes, then retires permanently.'
          }
        >
          <Input type="datetime-local" {...register('scheduleAt')} />
        </Field>

        {repeats ? (
          <p className="rounded-lg border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
            Each cycle opens a <strong>10 minute</strong> window in which the condition can fire,
            then closes and re-arms for the next one. The window exists because a keeper polls
            rather than watches: it must be wide enough that a sweep lands inside it. Within one
            window the condition fires at most once, however often the keeper checks.
          </p>
        ) : null}

        {startsAt && !formState.errors.scheduleAt ? (
          <p className="text-xs text-muted-foreground">
            Your local time. Stored on-chain as a Unix timestamp:{' '}
            <span className="font-mono">{Math.floor(Date.parse(startsAt) / 1000)}</span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StepCondition({
  form,
  balance,
}: {
  form: UseFormReturn<FormValues>;
  balance?: bigint;
}) {
  const { register, formState, watch, setValue } = form;
  const monitored = watch('monitoredWallet');
  const conditionType = watch('conditionType');
  const firesWhenBelow = conditionType === 'BALANCE_BELOW';

  if (isSchedule(conditionType)) {
    return <StepSchedule form={form} />;
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-5">
        <div>
          <h2 className="font-medium">Configure the condition</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            upKEEP reads this wallet&apos;s live balance on {networkName}.
          </p>
        </div>

        <Field
          label="Monitored wallet"
          error={formState.errors.monitoredWallet?.message}
          hint={
            balance !== undefined && monitored
              ? `Current balance: ${formatUsd(balance)} USDC`
              : 'Defaults to your connected wallet.'
          }
        >
          <Input
            {...register('monitoredWallet')}
            placeholder="0x..."
            className="font-mono text-sm"
            aria-invalid={Boolean(formState.errors.monitoredWallet)}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Asset">
            <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/40 px-3">
              <span className="text-sm font-medium">USDC</span>
              <Badge variant="muted" className="text-2xs">
                Native gas token on Arc
              </Badge>
            </div>
          </Field>

          {/*
            Both directions run on the same on-chain evaluator, reached with a
            different operator. Picking one here is the whole change.
          */}
          <Field label="Operator">
            <Select
              value={conditionType}
              onValueChange={(value) =>
                setValue('conditionType', value as ConditionTypeName, { shouldValidate: true })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BALANCE_BELOW">Less than</SelectItem>
                <SelectItem value="BALANCE_ABOVE">Greater than</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field
          label="Threshold"
          error={formState.errors.threshold?.message}
          hint={
            firesWhenBelow
              ? 'The condition becomes true when the balance falls below this.'
              : 'The condition becomes true when the balance rises above this.'
          }
        >
          <AmountInput
            {...register('threshold')}
            placeholder={firesWhenBelow ? '5000' : '10000'}
            invalid={Boolean(formState.errors.threshold)}
          />
        </Field>

        <Field
          label="Re-arm buffer (optional)"
          error={formState.errors.rearmBuffer?.message}
          // Recovery inverts with the operator, so the explanation has to follow it.
          hint={
            firesWhenBelow
              ? 'After firing, the balance must climb back past threshold + buffer before it can fire again. Leave empty for no buffer.'
              : 'After firing, the balance must fall back under threshold − buffer before it can fire again. Leave empty for no buffer.'
          }
        >
          <AmountInput {...register('rearmBuffer')} placeholder="250" invalid={Boolean(formState.errors.rearmBuffer)} />
        </Field>
      </CardContent>
    </Card>
  );
}

function StepAction({ form }: { form: UseFormReturn<FormValues> }) {
  const { register, formState, watch, setValue } = form;
  const recurring = watch('recurring');

  return (
    <Card>
      <CardContent className="space-y-5 pt-5">
        <div>
          <h2 className="font-medium">Configure the action</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is the only thing upKEEP will ever be able to do with the funds you deposit.
          </p>
        </div>

        <Field label="Action">
          <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/40 px-3">
            <span className="text-sm font-medium">Transfer USDC</span>
            <Badge variant="brand" className="text-2xs">
              Available
            </Badge>
          </div>
        </Field>

        <Field
          label="Transfer amount"
          error={formState.errors.amount?.message}
          hint="Released per execution. This also becomes the vault's hard per-execution ceiling."
        >
          <AmountInput {...register('amount')} placeholder="1000" invalid={Boolean(formState.errors.amount)} />
        </Field>

        <Field
          label="Approved recipient"
          error={formState.errors.recipient?.message}
          hint="The single address automation may ever send to. It cannot be changed by upKEEP."
        >
          <Input
            {...register('recipient')}
            placeholder="0x..."
            className="font-mono text-sm"
            aria-invalid={Boolean(formState.errors.recipient)}
          />
        </Field>

        <Field
          label="Vault deposit"
          error={formState.errors.deposit?.message}
          hint="USDC moved into the automation vault now. Only this is at stake, and you can withdraw it at any time."
        >
          <AmountInput {...register('deposit')} placeholder="1000" invalid={Boolean(formState.errors.deposit)} />
        </Field>

        {/*
          A limit, not a condition. It is checked inside the transfer itself, so
          there is no keeper to race and no window in which it is briefly
          untrue - which is exactly why it belongs here beside the recipient and
          the per-transfer ceiling rather than in the condition builder.
        */}
        <Field
          label="Daily limit (optional)"
          error={formState.errors.dailyLimit?.message}
          hint="The most upKEEP may move from this vault in one UTC day, however many times the condition fires. Leave blank for no daily cap. You can change it later, and it never affects withdrawal."
        >
          <AmountInput
            {...register('dailyLimit')}
            placeholder="No limit"
            invalid={Boolean(formState.errors.dailyLimit)}
          />
        </Field>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div>
            <div className="text-sm font-medium">Repeat after recovery</div>
            <p className="mt-1 text-sm text-muted-foreground">
              When on, the condition can fire again after the balance recovers. When off, it fires
              once and retires.
            </p>
          </div>
          <Switch
            checked={recurring}
            onCheckedChange={(checked) => setValue('recurring', checked)}
            aria-label="Repeat after recovery"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StepReview({ values, vaultAddress }: { values: FormValues; vaultAddress?: Address }) {
  let summary;
  try {
    const amount = parseUsdc(values.amount);
    summary = {
      firesWhenBelow: values.conditionType === 'BALANCE_BELOW',
      threshold: parseUsdc(values.threshold),
      amount,
      maxAmount: amount,
      recipient: values.recipient as Address,
      monitoredWallet: values.monitoredWallet as Address,
      deposit: parseUsdc(values.deposit),
      rearmBuffer: values.rearmBuffer ? parseUsdc(values.rearmBuffer) : 0n,
      recurring: values.recurring,
    };
  } catch {
    return (
      <Alert variant="destructive">
        <AlertTitle>Some values could not be read</AlertTitle>
        <AlertDescription>Go back and check the amounts you entered.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <PermissionReview summary={summary} />

      {vaultAddress ? (
        <Alert variant="success">
          <Check />
          <AlertTitle>Vault already deployed</AlertTitle>
          <AlertDescription>
            <span className="font-mono text-xs">{shortenAddress(vaultAddress, 8)}</span> is funded
            and ready. Confirming now only creates the condition.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          Confirming sends two transactions: one to deploy and fund your automation vault, then one
          to create the condition. Your wallet will prompt for each.
        </p>
      )}
    </div>
  );
}

/*//////////////////////////////////////////////////////////////
                             HELPERS
//////////////////////////////////////////////////////////////*/

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const AmountInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ invalid, className, ...props }, ref) => (
  <div className="relative">
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
      $
    </span>
    <Input
      ref={ref}
      inputMode="decimal"
      autoComplete="off"
      aria-invalid={invalid}
      className={cn('pl-7 pr-16 font-mono', className)}
      {...props}
    />
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
      USDC
    </span>
  </div>
));
AmountInput.displayName = 'AmountInput';

/** §31: name the phase the transaction is actually in. */
function TransactionProgress({ phase, vaultCreated }: { phase: string; vaultCreated: boolean }) {
  const label =
    phase === 'preparing'
      ? 'Preparing transaction'
      : phase === 'awaiting-signature'
        ? 'Waiting for your signature'
        : phase === 'confirming'
          ? 'Confirming on Arc Mainnet'
          : phase === 'confirmed'
            ? vaultCreated
              ? 'Vault confirmed, creating the condition'
              : 'Confirmed'
            : 'Working';

  return (
    <div className="mt-4 flex items-center gap-2.5 rounded-lg border bg-card px-4 py-3 text-sm">
      <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
      {label}
    </div>
  );
}
