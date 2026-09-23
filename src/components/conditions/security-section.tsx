'use client';

import { KeyRound, ShieldCheck } from 'lucide-react';
import type { Address } from 'viem';
import {
  ARC_PQ,
  AUTHORIZATION_COPY,
  futureAuthorizationSchemes,
  getAuthorizationScheme,
} from '@upkeep/sdk';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useVaultAuthorization } from '@/hooks/use-conditions';
import { Skeleton } from '@/components/ui/skeleton';
import { shortenAddress } from '@/lib/utils';

/**
 * The Security panel on a condition's detail page.
 *
 * Every phrase here comes from AUTHORIZATION_COPY in the SDK, which is covered
 * by tests asserting it contains no "quantum safe" / "post-quantum secure" /
 * "quantum proof" claim. That indirection is the point: no screen can drift
 * into asserting a property upKEEP does not provide.
 */
export function SecuritySection({ vault }: { vault?: Address }) {
  const { data: auth, isLoading } = useVaultAuthorization(vault);

  const currentScheme = getAuthorizationScheme('EXECUTOR_V1');
  const future = futureAuthorizationSchemes();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden />
          Security
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <>
            <Row label="Authorization">
              <span className="text-right">{auth?.label ?? currentScheme?.label}</span>
            </Row>

            {auth?.providerConfigured && auth.provider ? (
              <Row label="Provider">
                <span className="font-mono text-xs">{shortenAddress(auth.provider, 6)}</span>
              </Row>
            ) : null}

            <Row label="Migration">
              {auth?.migrationRequired ? (
                <Badge variant="warning">Migration recommended</Badge>
              ) : (
                <Badge variant="success">{AUTHORIZATION_COPY.migrationReady}</Badge>
              )}
            </Row>

            <Row label="Status">
              <span className="text-right text-muted-foreground">
                {AUTHORIZATION_COPY.configured}
              </span>
            </Row>

            <Separator />

            <p className="text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mr-1 inline size-3.5" aria-hidden />
              {AUTHORIZATION_COPY.currentSchemeNote} The authorization mechanism can be replaced
              without recreating this condition: its threshold, action and history are unaffected.
            </p>

            {/*
              Arc's roadmap, stated as Arc states it. The precompile is real and
              live; upKEEP ships no provider against it because the calldata
              encoding is not yet published, and guessing at the encoding of a
              signature verifier would be worse than waiting.
            */}
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
                Future authorization mechanisms
              </summary>

              <div className="mt-3 space-y-3 border-l pl-3">
                {future.map((scheme) => (
                  <div key={scheme.name}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{scheme.label}</span>
                      <Badge variant="muted" className="text-2xs">
                        Not implemented
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {scheme.description}
                    </p>
                  </div>
                ))}

                <div className="rounded-md bg-muted/50 p-2.5 text-2xs leading-relaxed text-muted-foreground">
                  Arc runs an {ARC_PQ.scheme} verification precompile at{' '}
                  <span className="font-mono">
                    {shortenAddress(ARC_PQ.signatureVerifyPrecompile, 6)}
                  </span>
                  . Post-quantum transaction signing is a future Arc milestone, so Arc accounts are
                  not post-quantum secure today.
                </div>

                <p className="text-2xs leading-relaxed text-muted-foreground">
                  {AUTHORIZATION_COPY.disclaimer}
                </p>
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
