import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * The hero product visual.
 *
 * Deliberately an illustration of the mechanism, not a screenshot: it shows
 * balance -> condition -> action -> executed as one vertical chain. The figures
 * are the canonical example from the docs and are labelled as an example, so
 * nobody can read them as live Mainnet data.
 */
export function HeroFlow() {
  return (
    <figure className="relative mx-auto max-w-sm animate-fade-in">
      <div className="overflow-hidden rounded-xl border bg-card shadow-lifted">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="label-caps">Treasury Balance Guard</span>
          <Badge variant="success">
            <span aria-hidden className="size-1.5 animate-pulse-dot rounded-full bg-success" />
            Active
          </Badge>
        </div>

        <div className="space-y-0 p-4">
          <Node label="USDC balance" value="$8,420" tone="plain" />
          <Arrow />
          <Node label="Condition" value="Balance < $5,000" tone="muted" />
          <Arrow />
          <Node label="Action" value="Transfer $1,000" tone="muted" />
          <Arrow />
          <Node label="Executed" value="Confirmed on Arc" tone="success" />
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2.5 font-mono text-2xs text-muted-foreground">
          <span>upKEEP fee 0.05%</span>
          <span className="tabular">$0.50</span>
        </div>
      </div>

      <figcaption className="mt-3 text-center text-2xs text-muted-foreground">
        Illustrative example. Your dashboard shows live Arc Mainnet data.
      </figcaption>
    </figure>
  );
}

function Node({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'plain' | 'muted' | 'success';
}) {
  const toneClass =
    tone === 'success'
      ? 'border-success/25 bg-success-subtle'
      : tone === 'muted'
        ? 'border-border bg-secondary/40'
        : 'border-border bg-background';

  return (
    <div className={`rounded-lg border px-3.5 py-3 ${toneClass}`}>
      <div className="label-caps">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        {tone === 'success' ? (
          <span className="flex size-4 items-center justify-center rounded-full bg-success">
            <Check className="size-2.5 text-success-foreground" strokeWidth={3} aria-hidden />
          </span>
        ) : null}
        <span
          className={
            tone === 'plain'
              ? 'font-mono text-xl font-medium tabular'
              : 'font-mono text-sm font-medium tabular'
          }
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex h-5 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 8 20" className="h-5 w-2 text-muted-foreground/35">
        <path
          d="M4 1 L4 15 M1 12 L4 15 L7 12"
          stroke="currentColor"
          strokeWidth="1.25"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
