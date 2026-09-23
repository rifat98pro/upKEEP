'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';
import { arcChainId, explorerUrl, networkName, publicRpcUrl } from '@/config/env';
import { upkeepFeeBps } from '@/config/contracts';
import { USDC_ERC20_ADDRESS } from '@upkeep/sdk';

export default function DocsPage() {
  return (
    <>
      <PageHeader
        title="Docs"
        subtitle="What upKEEP is, how conditions work, and exactly what it can do with your funds."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_13rem]">
        <div className="min-w-0 space-y-8">
          <Section id="what" title="What is upKEEP?">
            <p>
              upKEEP is a reusable financial automation layer for Arc. You describe a financial
              condition once, bind it to a single constrained action, and upKEEP keeps evaluating it
              against {networkName} until it becomes true.
            </p>
            <p>The mental model is one sentence:</p>
            <Callout>
              <strong>When</strong> this financial condition becomes true,{' '}
              <strong>then</strong> perform this authorized action.
            </Callout>
            <p>
              It is a condition engine rather than a payment scheduler. Conditional treasury
              automation is not a new idea; what upKEEP packages is the condition itself as
              infrastructure other Arc applications can build on.
            </p>
          </Section>

          <Section id="engine" title="The engine">
            <p>
              A condition is a generic triple: a <em>subject</em>, an <em>operator</em>, and a{' '}
              <em>threshold</em>. Which evaluator interprets that triple is looked up by kind, so
              adding a new condition type means deploying one small view contract and registering
              it, not changing the registry or anything that holds funds.
            </p>
            <p>
              Balance Guard is the first evaluator registered on that engine, not the product
              itself.
            </p>
            <p>
              Evaluators are deliberately view-only: an evaluator can say a condition is true, but
              it cannot move money, write state or re-enter. Actions are deliberately{' '}
              <em>not</em> an open plugin point, because an action decides what upKEEP may do with
              your funds. Each new action type is added explicitly in the executor where it is
              auditable and visible to you.
            </p>
          </Section>

          <Section id="conditions" title="How conditions work">
            <p>
              A condition lives on-chain in the ConditionRegistry. Its predicate is evaluated by a
              view function on Arc, which is the single most important property of the design: the
              executor re-checks the predicate in the same transaction that moves the funds, so a
              keeper cannot fabricate a trigger.
            </p>
            <p>
              The off-chain monitor is only a scheduler. It decides <em>when</em> to ask, never{' '}
              <em>whether</em> the answer is yes.
            </p>

            <h3 className="mt-5 font-medium">The state machine</h3>
            <p>
              After firing, a condition latches into a fired state and stays there until its
              evaluator confirms the subject genuinely recovered. This is what prevents a balance
              that simply stays below the threshold from executing on every polling cycle:
            </p>
            <Callout>
              Threshold $5,000 · balance $4,900 → fires once.
              <br />
              Next poll, balance still $4,900 → does not fire.
              <br />
              Balance recovers above $5,000 (plus any re-arm buffer) → armed again.
              <br />
              Balance drops below $5,000 → fires again.
            </Callout>
            <p>
              The optional re-arm buffer adds hysteresis. Without it, a balance oscillating by one
              wei around the threshold could fire repeatedly.
            </p>
          </Section>

          <Section id="permissions" title="Permissions">
            <p>
              upKEEP never takes custody of a private key and never receives an unlimited approval.
              Instead you deploy an AutomationVault, fund it with the amount you are willing to
              automate, and name exactly one destination and one per-execution ceiling.
            </p>
            <p>From that point the executor can do precisely one thing:</p>
            <Callout>
              Move at most <strong>maxPerExecution</strong> to exactly{' '}
              <strong>recipient</strong>, and only while the condition is true and armed.
            </Callout>
            <p>
              It cannot change either value, cannot withdraw, cannot reach funds outside that vault,
              and cannot act at all once you pause or revoke. The worst case, a fully compromised
              executor, is bounded by one authorized amount per armed trigger, sent to an address
              you chose.
            </p>
            <p>
              Withdrawal always works, including while the vault is paused or revoked. Your funds
              can never be stranded by a protocol-level action.
            </p>
          </Section>

          <Section id="arc" title="Arc Mainnet">
            <p>
              upKEEP runs on Arc Mainnet. These values come from the official Arc documentation and
              are what this build is pointed at:
            </p>
            <dl className="mt-3 space-y-2 rounded-lg border bg-card p-4 text-sm">
              <Row label="Network">{networkName}</Row>
              <Row label="Chain ID">
                <span className="font-mono tabular">{arcChainId}</span>
              </Row>
              <Row label="RPC">
                <span className="break-all font-mono text-xs">{publicRpcUrl}</span>
              </Row>
              <Row label="Explorer">
                <span className="break-all font-mono text-xs">{explorerUrl}</span>
              </Row>
            </dl>

            <h3 className="mt-5 font-medium">USDC is the gas token</h3>
            <p>
              This is the detail that shapes the whole codebase. On Arc, USDC is the native gas
              token with <strong>18 decimals</strong>, and it additionally exposes an ERC-20
              interface at <code className="font-mono text-xs">{USDC_ERC20_ADDRESS}</code> with{' '}
              <strong>6 decimals</strong> over the same balance. To display a native value as USDC
              you divide by 10<sup>12</sup>.
            </p>
            <p>
              Arc&apos;s documentation warns against recording balances from the 6-decimal view,
              because it truncates. upKEEP therefore accounts for everything in 18-decimal native
              wei and uses the 6-decimal view only for display.
            </p>

            <h3 className="mt-5 font-medium">The 20 Gwei floor</h3>
            <p>
              Arc&apos;s mempool silently drops transactions whose maxFeePerGas is under 20 Gwei:
              no receipt, no error, the transaction simply never appears in a block. Every write in
              the SDK reads the live gas price and clamps to that floor, so this cannot happen to
              you by accident.
            </p>
          </Section>

          <Section id="fees" title="Fees">
            <p>
              No subscription, no setup fee, nothing to create a condition, nothing to monitor one.
              upKEEP charges <strong>{(upkeepFeeBps / 100).toFixed(2)}%</strong> only on a
              successful automated execution.
            </p>
            <Callout>
              $1,000 execution → upKEEP fee $0.50 → recipient receives $999.50
            </Callout>
            <p>The fee is bounded at both ends so it can never become absurd:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                A minimum of <span className="font-mono">$0.001</span> per execution.
              </li>
              <li>
                A hard ceiling of <strong>1% of the transfer</strong>, which is what stops the
                minimum from swallowing a small amount. A $0.01 execution is charged $0.0001.
              </li>
            </ul>
            <p>
              Every vault stores its fee rate in an immutable set at construction, so the rate you
              agreed to can never be raised afterwards by anyone, including protocol admins. The
              fee is always shown before you confirm and is never deducted silently.
            </p>
          </Section>

          <Section id="security" title="Security">
            <ul className="ml-4 list-disc space-y-2">
              <li>
                <strong>On-chain evaluation.</strong> The predicate is verified inside the same
                transaction that moves funds, so the keeper is a scheduler and not an oracle.
              </li>
              <li>
                <strong>Triple replay protection.</strong> The registry latches the condition
                before any value moves, the executor records the derived execution id, and the
                vault independently refuses a spent id.
              </li>
              <li>
                <strong>Checks-effects-interactions and reentrancy guards</strong> on every path
                that moves value, tested against a recipient that calls back in mid-payout.
              </li>
              <li>
                <strong>Defence in depth on amounts.</strong> The ceiling is enforced at creation,
                again in the executor, and again in the vault.
              </li>
              <li>
                <strong>No floating point in the money path.</strong> Every amount is a bigint of
                native wei, and the fee math is mirrored between Solidity and TypeScript against a
                shared vector table.
              </li>
              <li>
                <strong>Your kill switch outranks everything.</strong> Pause and revoke are yours
                alone, and neither the protocol admin nor the keeper can undo them.
              </li>
            </ul>
          </Section>

          <Section id="example" title="Example condition">
            <Callout>
              <strong>IF</strong> USDC balance &lt; $5,000
              <br />
              <strong>THEN</strong> transfer $1,000 USDC
              <br />
              <strong>TO</strong> the approved reserve wallet
            </Callout>
            <p>
              For a first run on Mainnet, use a deliberately tiny amount: a $0.10 threshold and a
              $0.01 transfer proves the whole path end to end while risking almost nothing.
            </p>
            <p>
              <Link href="/conditions/new" className="font-medium underline underline-offset-4">
                Create a condition
              </Link>
            </p>
          </Section>

          <Section id="sdk" title="Using the SDK">
            <p>
              This dashboard is a reference implementation. It calls the same{' '}
              <code className="font-mono text-xs">@upkeep/sdk</code> client any other Arc
              application would, with no private path around it.
            </p>
            <pre className="overflow-x-auto rounded-lg border bg-card p-4 font-mono text-xs leading-relaxed">
              <code>{`import { createUpkeepClient } from '@upkeep/sdk';

const upkeep = createUpkeepClient({ addresses, walletClient });

const { vault } = await upkeep.vaults.create({
  recipient: reserveWallet,
  maxPerExecution: '1000',
  deposit: '5000',
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
});`}</code>
            </pre>
            <p className="text-sm text-muted-foreground">
              Amounts are strings or bigints of 18-decimal native wei. A JavaScript{' '}
              <code className="font-mono text-xs">number</code> is rejected, because it cannot
              represent every USDC amount exactly and money must never round by accident.
            </p>
          </Section>

          <Section id="authorization" title="Authorization and crypto-agility">
            <p>
              <strong>upKEEP implements no cryptography and makes no post-quantum security
              claim.</strong> What it does is avoid coupling a financial condition to any one
              signature scheme.
            </p>
            <p>The engine is layered so authorization is replaceable:</p>
            <Callout>
              Condition → Policy → Authorization → Execution → Arc Mainnet
            </Callout>
            <p>
              A vault names the authorization scheme it uses. Replacing that scheme is a
              vault-level change: the condition keeps its id, threshold, action, history and
              re-arm state, and carries on running. You can migrate how automation is authorized
              without recreating what it does.
            </p>

            <h3 className="mt-5 font-medium">A provider can only restrict</h3>
            <p>
              The authorization check runs <em>after</em> the vault has already verified the
              caller, the amount, the recipient and the balance. A provider that approves changes
              nothing; only a refusal blocks. It fails closed if it reverts, and withdrawal never
              consults it, so funds can never be trapped behind one.
            </p>

            <h3 className="mt-5 font-medium">What Arc provides today</h3>
            <p>
              Arc runs an <strong>SLH-DSA-SHA2-128s verification precompile</strong>, live on Arc
              Mainnet. Post-quantum <em>transaction signing</em> is a future Arc milestone, so Arc
              accounts are not post-quantum secure today and upKEEP does not suggest otherwise.
            </p>
            <p>
              upKEEP ships no provider that calls that precompile: Arc has not published its
              calldata encoding, and guessing the argument order of a signature verifier would be
              worse than waiting. The interface exists so adding it later is a registration rather
              than a rewrite.
            </p>
          </Section>

          <Section id="limits" title="What is not implemented">
            <p>
              upKEEP is honest about its edges. In this version:
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                Two condition types are enabled — <Badge variant="brand">balance below</Badge> and{' '}
                <Badge variant="brand">balance above</Badge> — both running on the same deployed
                evaluator, plus one action type (<Badge variant="brand">transfer USDC</Badge>).
              </li>
              <li>
                Spend-rate, ratio and scheduled conditions are designed for but not built, and are
                marked &ldquo;coming soon&rdquo; wherever they appear.
              </li>
              <li>
                Circle Agent Stack is <strong>not</strong> integrated. Its Agent Wallets support Arc
                testnet with mainnet listed as coming soon, so integrating it here would mean
                claiming Mainnet support that does not exist yet. An Agent Wallet can already be
                used as a monitored wallet today, since upKEEP watches any Arc address.
              </li>
              <li>
                CCTP and Gateway are not used. The core flow is entirely within Arc, so adding them
                would be branding rather than function.
              </li>
              <li>There is no notification backend and no hosted keeper.</li>
            </ul>
          </Section>
        </div>

        <nav className="hidden lg:block">
          <div className="sticky top-20">
            <div className="label-caps mb-2">On this page</div>
            <ul className="space-y-1.5 text-sm">
              {[
                ['what', 'What is upKEEP?'],
                ['engine', 'The engine'],
                ['conditions', 'How conditions work'],
                ['permissions', 'Permissions'],
                ['arc', 'Arc Mainnet'],
                ['fees', 'Fees'],
                ['security', 'Security'],
                ['authorization', 'Authorization'],
                ['example', 'Example'],
                ['sdk', 'Using the SDK'],
                ['limits', 'Not implemented'],
              ].map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>

            <a
              href="https://docs.arc.io"
              target="_blank"
              rel="noreferrer noopener"
              className="mt-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Arc documentation
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        </nav>
      </div>
    </>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <Card className="bg-secondary/40">
      <CardContent className="py-3.5 text-sm leading-relaxed text-foreground">{children}</CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}
