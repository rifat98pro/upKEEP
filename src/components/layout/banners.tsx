'use client';

import Link from 'next/link';
import { AlertTriangle, FlaskConical, Terminal } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { isDemoMode, missingProtocolAddresses } from '@/config/contracts';
import { isRehearsalNetwork, networkName } from '@/config/env';

/**
 * Demo mode marker.
 *
 * Demo data must never be mistakable for Arc Mainnet activity, so this is
 * unmissable and appears on every surface that can render sample rows.
 */
export function DemoModeBanner() {
  if (!isDemoMode) return null;

  return (
    <Alert variant="warning" className="mb-6">
      <FlaskConical />
      <AlertTitle>Demo mode</AlertTitle>
      <AlertDescription>
        Everything below is sample data, not Arc Mainnet activity. No condition here is being
        evaluated and no transaction here exists on-chain. Set{' '}
        <code className="font-mono text-xs">NEXT_PUBLIC_DEMO_MODE=false</code> to use real data.
      </AlertDescription>
    </Alert>
  );
}

/**
 * Shown whenever the build is pointed at anything other than Arc Mainnet.
 *
 * Deploying to testnet first is a sensible rehearsal, but a page that looks
 * identical on both networks is how a testnet transaction ends up being
 * presented as a Mainnet one.
 */
export function NetworkBanner() {
  if (!isRehearsalNetwork) return null;

  return (
    <Alert variant="warning" className="mb-6">
      <AlertTriangle />
      <AlertTitle>Connected to {networkName}, not Arc Mainnet</AlertTitle>
      <AlertDescription>
        Everything here is real on {networkName}, but it is not Mainnet. Balances, conditions and
        transactions on this network carry no real value.
      </AlertDescription>
    </Alert>
  );
}

/**
 * Shown when the app has no deployed contracts configured.
 *
 * upKEEP would rather say this plainly than render an empty dashboard that
 * looks like "you have no conditions yet".
 */
export function NotDeployedBanner() {
  const missing = missingProtocolAddresses();
  if (missing.length === 0) return null;

  return (
    <Alert variant="info" className="mb-6">
      <Terminal />
      <AlertTitle>upKEEP contracts are not configured for this build</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Reading live Arc Mainnet balances works already. Creating and executing conditions needs
          the protocol deployed and these variables set in{' '}
          <code className="font-mono text-xs">.env.local</code>:
        </p>
        <ul className="space-y-1 font-mono text-xs">
          {missing.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p>
          Run <code className="font-mono text-xs">npm run contracts:deploy</code> against Arc
          Mainnet. The deploy script prints the lines ready to paste.{' '}
          <Link href="/docs" className="font-medium underline underline-offset-4">
            Deployment guide
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}

/** Shown when the configured RPC answers for a different chain than expected. */
export function ChainMismatchBanner({ observed, expected }: { observed?: number; expected: number }) {
  if (observed === undefined || observed === expected) return null;

  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTriangle />
      <AlertTitle>RPC is serving the wrong network</AlertTitle>
      <AlertDescription>
        The configured endpoint reports chain {observed}, but upKEEP expects Arc Mainnet ({expected}
        ). Nothing on this page should be trusted until that is fixed.
      </AlertDescription>
    </Alert>
  );
}
