import Link from 'next/link';
import {
  ArrowRight,
  Ban,
  Bot,
  Building2,
  Check,
  Code2,
  Eye,
  Gauge,
  KeyRound,
  Layers,
  Lock,
  Send,
  Shuffle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UpkeepMark } from '@/components/layout/logo';
import { HeroFlow } from '@/components/landing/hero-flow';
import { networkName } from '@/config/env';

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <LandingHeader />

      <main>
        <Hero />
        <ThePrimitive />
        <HowItWorks />
        <EngineSection />
        <PermissionsSection />
        <PostQuantumSection />
        <UseCases />
        <SdkSection />
        <ClosingCta />
      </main>

      <LandingFooter />
    </div>
  );
}

function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <UpkeepMark className="size-6" />
          <span className="font-semibold tracking-tight">upKEEP</span>
        </Link>

        <nav className="ml-6 hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          <Link href="#how-it-works" className="transition-colors hover:text-foreground">
            How it works
          </Link>
          <Link href="#engine" className="transition-colors hover:text-foreground">
            Engine
          </Link>
          <Link href="#reuse" className="transition-colors hover:text-foreground">
            Reuse
          </Link>
          <Link href="#post-quantum" className="transition-colors hover:text-foreground">
            Crypto-agility
          </Link>
          <Link href="#sdk" className="transition-colors hover:text-foreground">
            SDK
          </Link>
          <Link href="/docs" className="transition-colors hover:text-foreground">
            Docs
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/dashboard">Open app</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/conditions/new">Create a condition</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="absolute inset-0 bg-grid mask-fade-b opacity-[0.55]" aria-hidden />

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="animate-fade-in">
            <Badge variant="brand" className="mb-5">
              <span aria-hidden className="size-1.5 rounded-full bg-brand" />
              Live on {networkName}
            </Badge>

            <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.25rem]">
              Financial conditions that act on Arc.
            </h1>

            <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
              A reusable financial automation layer that turns persistent financial conditions into
              permissioned onchain actions built on {networkName}, and designed for a
              post-quantum future.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link href="/conditions/new">
                  Create a condition
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="#how-it-works">How it works</Link>
              </Button>
            </div>

            <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t pt-6">
              <Stat label="Protocol fee" value="0.05%" note="on execution only" />
              <Stat label="Subscription" value="None" note="no setup fee" />
              <Stat label="Custody" value="Yours" note="revocable anytime" />
            </dl>
          </div>

          <div className="lg:pl-4">
            <HeroFlow />
          </div>
        </div>
      </div>

      {/* The positioning line, as four claims the rest of the page has to earn. */}
      <div className="relative border-t bg-card/50">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 sm:px-6 lg:grid-cols-4">
          {[
            { label: 'Reusable automation', href: '#reuse' },
            { label: 'Permissioned execution', href: '#permissions' },
            { label: 'Post-quantum-ready architecture', href: '#post-quantum' },
            { label: `Built for ${networkName}`, href: '#how-it-works' },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="group flex items-center gap-2 py-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <Check className="size-3.5 shrink-0 text-brand" aria-hidden />
              <span className="text-pretty">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="label-caps">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-medium tabular">{value}</dd>
      <dd className="text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}

/** The architecture in three words, which is the whole product. */
function ThePrimitive() {
  const steps = [
    {
      title: 'Condition',
      body: 'A persistent financial state, stored on Arc and evaluated on-chain until it becomes true.',
      example: 'USDC balance < $5,000',
    },
    {
      title: 'Permission',
      body: 'A bounded authority you grant in advance: one amount, one destination, revocable at any time.',
      example: 'At most $1,000, to one address',
    },
    {
      title: 'Action',
      body: 'The single authorized thing that happens when the condition is met, as a real Arc transaction.',
      example: 'Transfer $1,000 USDC',
    },
  ];

  return (
    <section className="border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="The primitive"
          title="Condition → Permission → Action"
          body="One reusable shape underneath everything. Change what the condition watches or what the action does, and the rest of the machinery is unchanged."
        />

        <div className="mt-12 grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.title} className="relative bg-card p-6">
              <div className="font-mono text-xs text-brand">0{index + 1}</div>
              <h3 className="mt-2 text-lg font-medium">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              <div className="mt-4 rounded-md border bg-background px-3 py-2 font-mono text-xs">
                {step.example}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Define',
      body: 'Describe a financial condition and the single action it may perform. It is stored on Arc, not on a server.',
    },
    {
      n: '02',
      title: 'Monitor',
      body: 'The condition is evaluated against live Arc Mainnet state. The predicate is a view function on-chain, so nobody has to be trusted to report it honestly.',
    },
    {
      n: '03',
      title: 'Trigger',
      body: 'When it becomes true the condition latches, so a value that simply stays past the threshold fires once, not once per poll.',
    },
    {
      n: '04',
      title: 'Act',
      body: 'The authorized action executes as a real Arc Mainnet transaction, bounded by the permission you granted.',
    },
  ];

  return (
    <section id="how-it-works" className="border-b bg-secondary/25">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="How it works"
          title="A condition, not a payment"
          body="You are not scheduling a transfer. You are describing a financial state, once, and binding it to an action that only runs when that state is reached."
        />

        <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <li key={step.n}>
              <div className="font-mono text-xs text-brand">{step.n}</div>
              <h3 className="mt-2 font-medium">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function EngineSection() {
  return (
    <section id="engine" className="border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="The engine"
          title="Balance Guard is the first condition type, not the product"
          body="upKEEP is a condition engine. A condition is a generic subject, operator and threshold, interpreted by a registered evaluator and bound to an action. Adding a new condition type means deploying one small view contract and registering it."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
          <div className="rounded-lg border bg-card p-6 shadow-card">
            <EngineDiagram />
          </div>

          <div className="space-y-6">
            <Feature
              icon={Layers}
              title="Evaluators are the extension point"
              body="An evaluator answers two questions: is this true, and has it recovered. It is a view function, so it cannot move money, write state or re-enter. That is what makes it safe to make it pluggable."
            />
            <Feature
              icon={Lock}
              title="Actions deliberately are not"
              body="An action decides what upKEEP may do with your funds, so each new action type is added explicitly in the executor where it is auditable, rather than something an admin can register quietly."
            />
            <Feature
              icon={Eye}
              title="Evaluated on-chain"
              body="Because the predicate is readable on-chain, the executor re-checks it in the same transaction that moves the funds. The off-chain monitor only decides when to ask, never whether the answer is yes."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function EngineDiagram() {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2">
          <UpkeepMark className="size-5" />
          <span className="text-sm font-medium">upKEEP engine</span>
        </div>
      </div>

      <svg viewBox="0 0 320 40" className="h-10 w-full text-border" aria-hidden>
        <path
          d="M160 0 L160 14 M56 14 L264 14 M56 14 L56 34 M160 14 L160 34 M264 14 L264 34"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
      </svg>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Balance', status: 'live' },
          { label: 'Spend rate', status: 'planned' },
          { label: 'Schedule', status: 'planned' },
        ].map((item) => (
          <div
            key={item.label}
            className={
              item.status === 'live'
                ? 'rounded-md border border-brand/30 bg-brand-subtle px-2 py-2 text-center'
                : 'rounded-md border border-dashed px-2 py-2 text-center'
            }
          >
            <div className="text-xs font-medium">{item.label}</div>
            <div
              className={
                item.status === 'live'
                  ? 'mt-0.5 text-2xs text-brand'
                  : 'mt-0.5 text-2xs text-muted-foreground'
              }
            >
              {item.status === 'live' ? 'Live' : 'Planned'}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 text-center text-2xs text-muted-foreground">
        <div>↓</div>
        <div>↓</div>
        <div>↓</div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {['Transfer USDC', 'Pause', 'Notify'].map((label, i) => (
          <div
            key={label}
            className={
              i === 0
                ? 'rounded-md border bg-background px-2 py-2 text-center text-xs'
                : 'rounded-md border border-dashed px-2 py-2 text-center text-xs text-muted-foreground'
            }
          >
            {label}
          </div>
        ))}
      </div>

      <p className="pt-1 text-center text-2xs text-muted-foreground">
        V1 enables one pair: balance below, transfer USDC. Dashed items are designed for, not built.
      </p>
    </div>
  );
}

function PermissionsSection() {
  const allowed = [
    'Transfer a fixed USDC amount',
    'To one approved recipient',
    'Only when the condition is true',
  ];
  const notAllowed = [
    'Move any other amount',
    'Send anywhere else',
    'Touch funds outside the vault',
    'Act after you pause or revoke',
  ];

  return (
    <section id="permissions" className="border-b bg-secondary/25">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="Permissioned execution"
          title="upKEEP never holds your keys"
          body="You deploy a vault, fund it with the amount you are willing to automate, and name one destination and one ceiling. That is the entire permission. There is no unlimited approval anywhere in the system."
        />

        <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
          <div className="rounded-lg border bg-card p-5">
            <div className="label-caps mb-3 text-success">What upKEEP can do</div>
            <ul className="space-y-2.5">
              {allowed.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <div className="label-caps mb-3">What it cannot</div>
            <ul className="space-y-2.5">
              {notAllowed.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-muted-foreground">
          Pause, resume or revoke at any time. Withdrawal always works, even while paused.
        </p>
      </div>
    </section>
  );
}

/**
 * Crypto-agility.
 *
 * The claim made here is about *architecture*, and the disclaimer sits in the
 * same block rather than being buried, because the claim is only honest with it
 * attached. The words "quantum safe", "post-quantum secure" and "quantum proof"
 * appear nowhere: upKEEP does not provide that property.
 */
function PostQuantumSection() {
  return (
    <section id="post-quantum" className="border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="Cryptographic agility"
          title="Designed for a post-quantum future"
          body="Authorization standards will change. upKEEP is built so that when they do, your financial conditions do not have to be rebuilt, they keep running under a new mechanism."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
          <div className="space-y-6">
            <Feature
              icon={KeyRound}
              title="Authorization is a layer, not a hardcoded scheme"
              body="A condition is never coupled to a signature scheme. The mechanism that proves a caller may act sits behind an interface, so a new one is added rather than migrated to."
            />
            <Feature
              icon={Shuffle}
              title="Staged migration, not a flag day"
              body="Old and new authorization mechanisms run side by side. You move your own vault when you choose; nobody is switched over beneath you, and an admin cannot do it for you."
            />
            <Feature
              icon={Gauge}
              title="The condition survives the change"
              body="Migrating keeps the condition's threshold, action, trigger history and funds exactly as they were. Only how it is authorized changes."
            />
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-6 shadow-card">
              <div className="label-caps mb-4">Migration path</div>

              <div className="space-y-3">
                <MigrationRow label="Today" value="Current authorization" tone="active" />
                <MigrationArrow />
                <MigrationRow label="Later" value="New authorization mechanism" tone="future" />
              </div>

              <div className="mt-5 space-y-2 border-t pt-4 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Check className="size-3.5 shrink-0 text-success" aria-hidden />
                  Same upKEEP conditions
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Check className="size-3.5 shrink-0 text-success" aria-hidden />
                  Same automation policies
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Check className="size-3.5 shrink-0 text-success" aria-hidden />
                  Same execution history
                </div>
              </div>
            </div>

            {/*
              The honest counterweight. Kept adjacent to the claim, not in a
              footnote, because the claim is only defensible with it visible.
            */}
            <div className="rounded-lg border border-dashed p-5">
              <div className="label-caps mb-2">What this does and does not mean</div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                upKEEP implements no cryptography and makes no post-quantum security claim. This
                describes how authorization can be <em>replaced</em>, not what protects it today.
                Arc runs an SLH-DSA-SHA2-128s verification precompile on Mainnet; post-quantum
                transaction signing remains a future Arc milestone, so Arc accounts are not
                post-quantum secure today and upKEEP does not suggest otherwise.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MigrationRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'active' | 'future';
}) {
  return (
    <div
      className={
        tone === 'active'
          ? 'rounded-md border border-brand/30 bg-brand-subtle px-3.5 py-3'
          : 'rounded-md border border-dashed px-3.5 py-3'
      }
    >
      <div className="label-caps">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}

function MigrationArrow() {
  return (
    <div className="flex justify-center" aria-hidden>
      <svg viewBox="0 0 8 20" className="h-5 w-2 text-muted-foreground/40">
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

/**
 * Reuse, demonstrated rather than asserted.
 *
 * "Reusable" is easy to claim and meaningless unless you can see the same shape
 * filled in differently. So every row below uses the identical three slots, and
 * each carries an honest status: two of these need no new code at all, one needs
 * a catalog flag, one needs a new evaluator. Saying that plainly is more
 * convincing than four abstract cards would be.
 */
function UseCases() {
  const workflows = [
    {
      icon: Building2,
      title: 'Treasury automation',
      condition: 'USDC balance < $5,000',
      permission: '≤ $1,000 → reserve wallet',
      action: 'Transfer $1,000 USDC',
      status: 'live' as const,
      note: 'The Balance Guard flow, running today.',
    },
    {
      icon: Bot,
      title: 'Agent budgets',
      condition: 'Agent wallet < $100',
      permission: '≤ $50 → agent wallet',
      action: 'Transfer $50 USDC',
      status: 'live' as const,
      note: 'Same condition and action types. Only the values differ, so this needs no new code.',
    },
    {
      icon: Send,
      title: 'Automated payouts',
      condition: 'Settlement balance > $10,000',
      permission: '≤ $5,000 → payout wallet',
      action: 'Transfer $5,000 USDC',
      status: 'live' as const,
      note: 'The opposite direction, running on the same deployed evaluator. A catalog entry, not a second contract.',
    },
    {
      icon: Gauge,
      title: 'Spending controls',
      condition: 'Daily outflow > $500',
      permission: 'Pause authority, no transfer',
      action: 'Pause the automation',
      status: 'planned' as const,
      note: 'Needs a spend-rate evaluator and a pause action. Neither is built.',
    },
  ];

  return (
    <section id="reuse" className="border-b bg-secondary/25">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="Reusable by design"
          title="The same three slots, different financial workflows"
          body="Conditional treasury automation is not a new idea. What upKEEP packages is the condition itself as reusable infrastructure — one shape that extends beyond balance monitoring, with the engine underneath unchanged."
        />

        <div className="mt-12 overflow-hidden rounded-lg border bg-card">
          {/* The column headers are the point: every row fills the same slots. */}
          <div className="hidden border-b bg-secondary/40 lg:grid lg:grid-cols-[1.1fr_1fr_1fr_1fr]">
            <div className="label-caps px-5 py-3">Workflow</div>
            <div className="label-caps px-5 py-3">Condition</div>
            <div className="label-caps px-5 py-3">Permission</div>
            <div className="label-caps px-5 py-3">Action</div>
          </div>

          <div className="divide-y">
            {workflows.map((flow) => (
              <div
                key={flow.title}
                className="grid gap-4 p-5 lg:grid-cols-[1.1fr_1fr_1fr_1fr] lg:items-start lg:gap-5"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <flow.icon className="size-4 shrink-0 text-brand" aria-hidden />
                    <h3 className="font-medium">{flow.title}</h3>
                  </div>
                  <ReuseStatus status={flow.status} />
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{flow.note}</p>
                </div>

                <Slot label="Condition" value={flow.condition} />
                <Slot label="Permission" value={flow.permission} />
                <Slot label="Action" value={flow.action} />
              </div>
            ))}
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-relaxed text-muted-foreground">
          Three of these run on the engine as it exists today, on one deployed evaluator: the
          second needs only different values, the third only the opposite operator. The last is
          designed for, not built, and the product marks it that way everywhere it appears.
        </p>

        {/*
          The other axis of reuse. The rows above are one team reusing the engine
          for different workflows; this is different teams reusing it entirely.
          Stated with its real status: the SDK exists and this dashboard runs on
          it, but it is not on npm yet, so "import it" means from the repo today.
        */}
        <div className="mx-auto mt-12 max-w-3xl rounded-lg border bg-card p-6 shadow-card">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
              <Code2 className="size-4 text-brand" aria-hidden />
            </div>

            <div className="flex-1">
              <h3 className="font-medium">Developers can build on it too</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                The deepest kind of reuse is not one team running more workflows — it is other
                teams not having to rebuild the monitoring and execution layer at all. upKEEP ships
                as a TypeScript SDK, and this dashboard is simply its first consumer.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border bg-background p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="success" className="text-2xs">
                      <span aria-hidden className="size-1.5 rounded-full bg-success" />
                      Today
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    The SDK is written, tested and in use — every condition on this site is created
                    through it. You can import it from the repository now.
                  </p>
                </div>

                <div className="rounded-md border border-dashed p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="muted" className="text-2xs">
                      Next
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Published to npm, so any Arc builder can{' '}
                    <code className="font-mono">npm install @upkeep/sdk</code> and bind their own
                    conditions to their own actions.
                  </p>
                </div>
              </div>

              <Link
                href="#sdk"
                className="mt-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                See the SDK
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** One of the three reusable slots, rendered identically in every row. */
function Slot({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label-caps mb-1 lg:hidden">{label}</div>
      <div className="rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed">
        {value}
      </div>
    </div>
  );
}

function ReuseStatus({ status }: { status: 'live' | 'planned' }) {
  if (status === 'live') {
    return (
      <Badge variant="success" className="mt-2">
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
        Available today
      </Badge>
    );
  }
  return (
    <Badge variant="muted" className="mt-2">
      Needs a new evaluator
    </Badge>
  );
}

function SdkSection() {
  return (
    <section id="sdk" className="border-b">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="For developers"
              title="The dashboard is a reference implementation"
              body="upKEEP ships as a TypeScript SDK over the contracts. This site uses exactly the same client any other Arc application would - there is no private path around it."
              align="left"
            />

            <div className="mt-8 space-y-5">
              <Feature
                icon={Code2}
                title="One call to create a condition"
                body="Amounts are strings or bigints of native wei. A JS number is rejected, because it cannot represent every USDC amount exactly."
              />
              <Feature
                icon={Zap}
                title="Arc's gas floor handled for you"
                body="Arc silently drops transactions under 20 Gwei with no receipt and no error. Every SDK write clamps to the documented floor so that never happens to you."
              />
            </div>

            <Button variant="outline" className="mt-8" asChild>
              <Link href="/docs">
                Read the docs
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border bg-card shadow-card">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <div className="flex gap-1.5" aria-hidden>
                <span className="size-2.5 rounded-full bg-muted" />
                <span className="size-2.5 rounded-full bg-muted" />
                <span className="size-2.5 rounded-full bg-muted" />
              </div>
              <span className="font-mono text-xs text-muted-foreground">treasury-guard.ts</span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
              <code>{`import { createUpkeepClient } from '@upkeep/sdk';

const upkeep = createUpkeepClient({
  addresses,
  walletClient,
});

const condition = await upkeep.conditions.create({
  wallet: treasury,
  type: 'BALANCE_BELOW',
  asset: 'USDC',
  threshold: '5000',
  vault,
  action: {
    type: 'TRANSFER_USDC',
    amount: '1000',
    recipient: reserveWallet,
  },
});

// -> { conditionId, transactionHash, explorerUrl }`}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-balance text-3xl font-semibold tracking-tight">
          Set a condition once. Stop watching the balance.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground">
          Start with a small amount on {networkName} and watch a real condition fire a real
          transaction.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/conditions/new">
              Create a condition
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/dashboard">Open the dashboard</Link>
          </Button>
        </div>

        <p className="mt-10 text-sm text-muted-foreground">
          Reusable automation · Permissioned execution · Post-quantum-ready architecture · Built for{' '}
          {networkName}
        </p>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  body: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-xl'}>
      <div className="label-caps text-brand">{eyebrow}</div>
      <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Layers;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card">
        <Icon className="size-4 text-brand" aria-hidden />
      </div>
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-2">
          <UpkeepMark className="size-5" />
          <span className="text-sm font-medium">upKEEP</span>
          <span className="text-sm text-muted-foreground">
            Persistent financial conditions for Arc.
          </span>
        </div>

        <nav className="flex gap-5 text-sm text-muted-foreground sm:ml-auto">
          <Link href="/docs" className="transition-colors hover:text-foreground">
            Docs
          </Link>
          <Link href="/dashboard" className="transition-colors hover:text-foreground">
            Dashboard
          </Link>
          <a
            href="https://docs.arc.io"
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-foreground"
          >
            Arc docs
          </a>
        </nav>
      </div>
    </footer>
  );
}
