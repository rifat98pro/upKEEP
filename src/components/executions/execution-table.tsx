'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { formatUsd, formatUsdPrecise, type Execution } from '@upkeep/sdk';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ExecutionStatusBadge } from '@/components/conditions/status-badge';
import { explorerTxLink } from '@/config/env';
import { isDemoArtifact } from '@/lib/mock-data';
import { shortenHash, timeAgo } from '@/lib/utils';

export function ExecutionTable({
  executions,
  compact = false,
}: {
  executions: Execution[];
  compact?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          {!compact ? <TableHead>Condition</TableHead> : null}
          {!compact ? <TableHead>Action</TableHead> : null}
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Fee</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Transaction</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {executions.map((execution) => (
          <TableRow key={execution.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {timeAgo(execution.createdAt)}
            </TableCell>

            {!compact ? (
              <TableCell>
                <Link
                  href={`/conditions/${execution.conditionId}`}
                  className="hover:underline"
                >
                  #{execution.conditionId}
                </Link>
              </TableCell>
            ) : null}

            {!compact ? (
              <TableCell className="whitespace-nowrap text-muted-foreground">
                Transfer USDC
              </TableCell>
            ) : null}

            <TableCell className="text-right font-mono tabular">
              {formatUsd(execution.amount)}
            </TableCell>
            <TableCell className="text-right font-mono tabular text-muted-foreground">
              {formatUsdPrecise(execution.fee)}
            </TableCell>
            <TableCell className="text-right font-mono font-medium tabular">
              {formatUsd(execution.netAmount)}
            </TableCell>

            <TableCell>
              <ExecutionStatusBadge status={execution.status} />
            </TableCell>

            <TableCell>
              <TransactionCell execution={execution} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Demo rows must never link to the explorer.
 *
 * A dead explorer link on fabricated data is exactly how a demo gets mistaken
 * for a real Mainnet transaction, so the link is replaced with a label saying
 * what it is.
 */
function TransactionCell({ execution }: { execution: Execution }) {
  if (isDemoArtifact(execution.transactionHash)) {
    return (
      <Badge variant="warning" className="font-mono text-2xs">
        Demo, not on-chain
      </Badge>
    );
  }

  return (
    <a
      href={explorerTxLink(execution.transactionHash)}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
    >
      {shortenHash(execution.transactionHash)}
      <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
    </a>
  );
}
