'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, Pause, Play, Plus, ShieldOff, Wallet } from 'lucide-react';
import type { Address } from 'viem';
import { formatUsd, formatUsdc, nativeToErc20 } from '@upkeep/sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { DemoModeBanner, NotDeployedBanner } from '@/components/layout/banners';
import { useArcWallet } from '@/hooks/use-arc-wallet';
import { useDualUsdcBalance } from '@/hooks/use-usdc-balance';
import { useConditions, useVaultInfo, useVaults } from '@/hooks/use-conditions';
import { useUpkeepActions } from '@/hooks/use-upkeep-actions';
import { explorerAddressLink, networkName } from '@/config/env';
import { shortenAddress } from '@/lib/utils';
import { USDC_ERC20_ADDRESS } from '@upkeep/sdk';

export default function WalletsPage() {
  const wallet = useArcWallet();
  const { data: dual, isLoading: balanceLoading } = useDualUsdcBalance(wallet.address);
  const { data: vaults, isLoading: vaultsLoading } = useVaults(wallet.address);
  const { data: conditionsData } = useConditions(wallet.address);

  return (
    <>
      <PageHeader
        title="Wallets"
        subtitle={`Connected wallets and automation vaults on ${networkName}.`}
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

      {!wallet.isConnected ? (
        <EmptyState
          icon={Wallet}
          title="Connect a wallet to get started"
          body="upKEEP reads balances directly from Arc Mainnet. Private keys never leave your wallet and are never sent anywhere."
          action={
            <Button onClick={wallet.connect} loading={wallet.isConnecting}>
              Connect wallet
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Connected wallet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <a
                  href={explorerAddressLink(wallet.address!)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 font-mono text-sm hover:underline"
                >
                  {wallet.address}
                  <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
                </a>
                <Badge variant="outline">
                  <span aria-hidden className="size-1.5 rounded-full bg-success" />
                  {networkName}
                </Badge>
              </div>

              <Separator />

              {balanceLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : dual ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="label-caps">USDC balance</div>
                      <div className="mt-1 font-mono text-2xl font-medium tabular">
                        {formatUsd(dual.native)}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Native balance, 18 decimals
                      </div>
                    </div>
                    <div>
                      <div className="label-caps">ERC-20 view</div>
                      <div className="mt-1 font-mono text-2xl font-medium tabular text-muted-foreground">
                        {formatUsdc(dual.erc20 * 10n ** 12n, 6)}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {nativeToErc20(dual.native).toString()} units, 6 decimals
                      </div>
                    </div>
                  </div>

                  {/*
                    Arc's dual-interface USDC surprises people, so it is explained
                    here rather than left to look like a bug.
                  */}
                  <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                    On Arc, USDC is the native gas token. The same balance is readable two ways: as
                    native value with 18 decimals, and through the ERC-20 interface at{' '}
                    <span className="font-mono">{shortenAddress(USDC_ERC20_ADDRESS, 6)}</span> with
                    6 decimals.{' '}
                    {dual.consistent
                      ? 'Both views agree exactly.'
                      : `The ERC-20 view truncates ${formatUsdc(dual.truncated, 18)} USDC of dust; upKEEP accounts in the 18-decimal figure so nothing is lost.`}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <section>
            <h2 className="mb-3 font-medium">Automation vaults</h2>

            {vaultsLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-48 rounded-lg" />
              </div>
            ) : !vaults || vaults.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="No automation vaults yet"
                body="A vault holds only the USDC you set aside for automation, with one approved recipient and one per-execution ceiling. Creating a condition deploys one for you."
                action={
                  <Button asChild>
                    <Link href="/conditions/new">Create your first condition</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {vaults.map((address) => (
                  <VaultCard
                    key={address}
                    address={address}
                    conditionCount={
                      conditionsData?.conditions.filter(
                        (view) => view.action.vault.toLowerCase() === address.toLowerCase(),
                      ).length ?? 0
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function VaultCard({ address, conditionCount }: { address: Address; conditionCount: number }) {
  const { data: vault, isLoading } = useVaultInfo(address);
  const actions = useUpkeepActions();
  const [topUp, setTopUp] = React.useState('');

  if (isLoading || !vault) {
    return <Skeleton className="h-48 rounded-lg" />;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <a
            href={explorerAddressLink(address)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 font-mono text-sm hover:underline"
          >
            {shortenAddress(address, 8)}
            <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
          </a>
          <div className="flex items-center gap-2">
            {vault.revoked ? (
              <Badge variant="destructive">Revoked</Badge>
            ) : vault.paused ? (
              <Badge variant="warning">Paused</Badge>
            ) : (
              <Badge variant="success">
                <span aria-hidden className="size-1.5 rounded-full bg-success" />
                Armed
              </Badge>
            )}
            <Badge variant="muted">
              {conditionCount} condition{conditionCount === 1 ? '' : 's'}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="label-caps">Balance</div>
            <div className="mt-1 font-mono text-lg font-medium tabular">
              {formatUsd(vault.balance)}
            </div>
          </div>
          <div>
            <div className="label-caps">Max per execution</div>
            <div className="mt-1 font-mono text-lg font-medium tabular">
              {formatUsd(vault.maxPerExecution)}
            </div>
          </div>
          <div>
            <div className="label-caps">Approved recipient</div>
            <a
              href={explorerAddressLink(vault.recipient)}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 block font-mono text-sm hover:underline"
            >
              {shortenAddress(vault.recipient, 6)}
            </a>
          </div>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[12rem] flex-1 items-center gap-2">
            <Input
              value={topUp}
              onChange={(event) => setTopUp(event.target.value)}
              placeholder="Top up amount"
              inputMode="decimal"
              className="font-mono"
            />
            <Button
              variant="outline"
              disabled={!topUp || actions.isBusy}
              onClick={async () => {
                const ok = await actions.fundVault(address, topUp);
                if (ok) setTopUp('');
              }}
            >
              Fund
            </Button>
          </div>

          {vault.paused || vault.revoked ? (
            <Button
              variant="outline"
              onClick={() => actions.resumeVault(address)}
              loading={actions.isBusy}
              disabled={vault.revoked}
            >
              <Play aria-hidden />
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => actions.pauseVault(address)}
              loading={actions.isBusy}
            >
              <Pause aria-hidden />
              Pause
            </Button>
          )}

          <Button
            variant="outline"
            onClick={() => actions.withdrawAll(address)}
            loading={actions.isBusy}
            disabled={vault.balance === 0n}
          >
            Withdraw all
          </Button>

          {!vault.revoked ? (
            <Button
              variant="destructive"
              onClick={() => actions.revokeVault(address)}
              loading={actions.isBusy}
            >
              <ShieldOff aria-hidden />
              Revoke
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          Revoking removes the executor entirely and pauses the vault: after that nothing can move
          funds but you. Withdrawal always works, including while paused or revoked.
        </p>
      </CardContent>
    </Card>
  );
}
