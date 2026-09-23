'use client';

import Link from 'next/link';
import { useTheme } from 'next-themes';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { formatUsd, ARC_MIN_BASE_FEE_WEI, USDC_ERC20_ADDRESS } from '@upkeep/sdk';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PageHeader } from '@/components/layout/page-header';
import { DemoModeBanner } from '@/components/layout/banners';
import { useArcWallet } from '@/hooks/use-arc-wallet';
import { useConditions, useVaults } from '@/hooks/use-conditions';
import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  arcChainId,
  explorerAddressLink,
  explorerUrl,
  networkName,
  publicRpcUrl,
} from '@/config/env';
import {
  automationExecutorAddress,
  conditionRegistryAddress,
  isDemoMode,
  isProtocolDeployed,
  upkeepFeeBps,
  vaultFactoryAddress,
} from '@/config/contracts';
import { formatGwei, shortenAddress } from '@/lib/utils';

export default function SettingsPage() {
  const wallet = useArcWallet();
  const { theme, setTheme } = useTheme();
  const { data: network } = useNetworkStatus();
  const { data: conditionsData } = useConditions(wallet.address);
  const { data: vaults } = useVaults(wallet.address);

  const conditions = conditionsData?.conditions ?? [];
  const activeConditions = conditions.filter(
    (view) => view.condition.status === 'active' || view.condition.status === 'triggered',
  );

  // The most anyone could move in a single execution across all conditions.
  const maxSingleTransfer = activeConditions.reduce(
    (max, view) => (view.action.maxAmount > max ? view.action.maxAmount : max),
    0n,
  );
  const approvedRecipients = Array.from(
    new Set(activeConditions.map((view) => view.action.recipient.toLowerCase())),
  );

  return (
    <>
      <PageHeader title="Settings" subtitle="Account, network, automation and security." />

      <DemoModeBanner />

      <div className="space-y-6">
        <Section title="Account" description="The wallet upKEEP reads and acts on behalf of.">
          {wallet.isConnected ? (
            <>
              <Row label="Address">
                <a
                  href={explorerAddressLink(wallet.address!)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 font-mono text-sm hover:underline"
                >
                  {shortenAddress(wallet.address, 8)}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </Row>
              <Row label="Status">
                <Badge variant="success">Connected</Badge>
              </Row>
              <Row label="Session">
                <Button variant="outline" size="sm" onClick={wallet.disconnect}>
                  Disconnect
                </Button>
              </Row>
            </>
          ) : (
            <Row label="Status">
              <Button size="sm" onClick={wallet.connect} loading={wallet.isConnecting}>
                Connect wallet
              </Button>
            </Row>
          )}
        </Section>

        <Section
          title="Network"
          description="upKEEP targets Arc Mainnet. These values come from the official Arc documentation."
        >
          <Row label="Network">{networkName}</Row>
          <Row label="Chain ID">
            <span className="font-mono tabular">{arcChainId}</span>
          </Row>
          <Row label="RPC endpoint">
            <span className="break-all font-mono text-xs">{publicRpcUrl}</span>
          </Row>
          <Row label="Explorer">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
            >
              {explorerUrl}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </Row>
          <Row label="Gas token">USDC (18 decimals, native)</Row>
          <Row label="USDC ERC-20 interface">
            <span className="font-mono text-xs">{shortenAddress(USDC_ERC20_ADDRESS, 8)}</span>
          </Row>
          <Row label="Minimum base fee">
            <span className="font-mono text-xs tabular">
              {formatGwei(ARC_MIN_BASE_FEE_WEI, 0)}
            </span>
          </Row>
          <Row label="Live status">
            {network?.connected ? (
              <span className="font-mono text-xs tabular">
                block {network.blockNumber?.toString()} · {formatGwei(network.gasPrice)} ·{' '}
                {network.latencyMs}ms
              </span>
            ) : (
              <Badge variant="destructive">Unreachable</Badge>
            )}
          </Row>
        </Section>

        <Section title="Automation" description="Protocol configuration for this deployment.">
          <Row label="Protocol fee">
            <span className="font-mono tabular">
              {upkeepFeeBps} bps ({(upkeepFeeBps / 100).toFixed(2)}%)
            </span>
          </Row>
          <Row label="Charged on">Successful executions only</Row>
          <Row label="Minimum fee">
            <span className="font-mono tabular">$0.001</span>
          </Row>
          <Row label="Fee ceiling">
            <span className="font-mono tabular">1% of the transfer</span>
          </Row>
          <Separator />
          <Row label="ConditionRegistry">
            <ContractAddress address={conditionRegistryAddress} />
          </Row>
          <Row label="AutomationExecutor">
            <ContractAddress address={automationExecutorAddress} />
          </Row>
          <Row label="VaultFactory">
            <ContractAddress address={vaultFactoryAddress} />
          </Row>
        </Section>

        <Section
          title="Security"
          description="Exactly what upKEEP is currently authorized to do with your funds."
        >
          <Row label="Active automations">
            <span className="font-mono tabular">{activeConditions.length}</span>
          </Row>
          <Row label="Automation vaults">
            <span className="font-mono tabular">{vaults?.length ?? 0}</span>
          </Row>
          <Row label="Maximum authorized transfer">
            <span className="font-mono font-medium tabular">
              {maxSingleTransfer > 0n ? `${formatUsd(maxSingleTransfer)} per execution` : 'None'}
            </span>
          </Row>
          <Row label="Approved recipients">
            {approvedRecipients.length === 0 ? (
              <span className="text-muted-foreground">None</span>
            ) : (
              <div className="space-y-1 text-right">
                {approvedRecipients.map((recipient) => (
                  <a
                    key={recipient}
                    href={explorerAddressLink(recipient)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block font-mono text-xs hover:underline"
                  >
                    {shortenAddress(recipient, 6)}
                  </a>
                ))}
              </div>
            )}
          </Row>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mr-1.5 inline size-3.5" aria-hidden />
            upKEEP never holds your private keys and never receives an unlimited approval. Every
            automation is bounded by a vault you own, and you can pause, revoke or withdraw at any
            time from the{' '}
            <Link href="/wallets" className="underline underline-offset-4">
              Wallets page
            </Link>
            .
          </div>
        </Section>

        <Section
          title="Notifications"
          description="Where upKEEP would tell you an execution happened."
        >
          <Row label="In-app toasts">
            <Badge variant="success">Enabled</Badge>
          </Row>
          <Row label="Email and webhooks">
            <Badge variant="muted">Not implemented</Badge>
          </Row>
          <p className="text-xs text-muted-foreground">
            V1 has no notification backend. Execution history is read from chain logs on the{' '}
            <Link href="/executions" className="underline underline-offset-4">
              Executions page
            </Link>
            .
          </p>
        </Section>

        <Section title="Developer" description="Build configuration and appearance.">
          <Row label="Demo mode">
            {isDemoMode ? (
              <Badge variant="warning">On, data is not real</Badge>
            ) : (
              <Badge variant="muted">Off</Badge>
            )}
          </Row>
          <Row label="Protocol deployed">
            {isProtocolDeployed ? (
              <Badge variant="success">Configured</Badge>
            ) : (
              <Badge variant="warning">Addresses not set</Badge>
            )}
          </Row>
          <Row label="SDK">
            <span className="font-mono text-xs">@upkeep/sdk</span>
          </Row>
          <Row label="Theme">
            <div className="flex gap-1">
              {(['light', 'dark', 'system'] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={theme === option ? 'secondary' : 'ghost'}
                  onClick={() => setTheme(option)}
                  className="capitalize"
                >
                  {option}
                </Button>
              ))}
            </div>
          </Row>
        </Section>
      </div>
    </>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  );
}

function ContractAddress({ address }: { address?: string }) {
  if (!address) {
    return <Badge variant="muted">Not configured</Badge>;
  }
  return (
    <a
      href={explorerAddressLink(address)}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
    >
      {shortenAddress(address, 8)}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
