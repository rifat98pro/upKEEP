'use client';

/**
 * Write operations, driven through @upkeep/sdk.
 *
 * Everything here manages the transaction phases the UI shows (§31) and turns
 * chain errors into sentences a person can act on (§30). The actual contract
 * calls belong to the SDK: this file never builds one itself.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWalletClient } from 'wagmi';
import { toast } from 'sonner';
import type { Address, Hash } from 'viem';
import type { CreateConditionInput, CreateConditionResult, UpkeepClient } from '@upkeep/sdk';
import { getWritableUpkeep } from '@/lib/upkeep';
import { explorerTxLink } from '@/config/env';

export type TransactionPhase =
  | 'idle'
  | 'preparing'
  | 'awaiting-signature'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'failed';

export interface TransactionState {
  phase: TransactionPhase;
  hash?: Hash;
  error?: string;
}

const IDLE: TransactionState = { phase: 'idle' };

export function useUpkeepActions() {
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TransactionState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['conditions'] });
    queryClient.invalidateQueries({ queryKey: ['condition'] });
    queryClient.invalidateQueries({ queryKey: ['vault'] });
    queryClient.invalidateQueries({ queryKey: ['vaults'] });
    queryClient.invalidateQueries({ queryKey: ['executions'] });
    queryClient.invalidateQueries({ queryKey: ['usdc-balance'] });
  }, [queryClient]);

  /**
   * Run an SDK call through the full transaction lifecycle.
   *
   * `run` receives a writable client. Whatever it returns is passed back to the
   * caller, so a call that produces more than a hash (condition creation
   * returns ids) is not flattened.
   */
  const run = useCallback(
    async <T>(
      operation: string,
      successMessage: string,
      fn: (client: UpkeepClient) => Promise<T>,
      extractHash: (result: T) => Hash | undefined,
    ): Promise<T | undefined> => {
      if (!walletClient) {
        const message = 'Connect a wallet on Arc Mainnet to continue.';
        setState({ phase: 'failed', error: message });
        toast.error(operation, { description: message });
        return undefined;
      }

      setState({ phase: 'preparing' });

      try {
        const client = getWritableUpkeep(walletClient);

        // The SDK simulates before submitting, so the wallet prompt only
        // appears for a call that would actually succeed.
        setState({ phase: 'awaiting-signature' });
        const result = await fn(client);

        const hash = extractHash(result);
        if (!hash) {
          setState({ phase: 'confirmed' });
          invalidate();
          return result;
        }

        setState({ phase: 'confirming', hash });

        const receipt = await client.publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });

        if (receipt.status === 'reverted') {
          const message = 'The transaction was included but reverted on-chain.';
          setState({ phase: 'failed', hash, error: message });
          toast.error('Transaction reverted', { description: message });
          return undefined;
        }

        setState({ phase: 'confirmed', hash });
        invalidate();

        toast.success(successMessage, {
          description: 'Confirmed on Arc Mainnet.',
          action: {
            label: 'View',
            onClick: () => window.open(explorerTxLink(hash), '_blank', 'noopener'),
          },
        });

        return result;
      } catch (caught) {
        const message = describeTransactionError(caught);
        setState({ phase: 'failed', error: message });
        toast.error(operation, { description: message });
        return undefined;
      }
    },
    [walletClient, invalidate],
  );

  return {
    state,
    reset,
    isBusy:
      state.phase === 'preparing' ||
      state.phase === 'awaiting-signature' ||
      state.phase === 'submitted' ||
      state.phase === 'confirming',

    /** Deploy a vault: the bounded permission upKEEP is granted. */
    createVault: (input: {
      recipient: Address;
      maxPerExecution: string;
      /** Optional daily spending cap on the vault. */
      maxPerDay?: string;
      deposit?: string;
    }) =>
      run(
        'Could not create the automation vault',
        'Automation vault created',
        (client) => client.vaults.create(input),
        (result) => result.transactionHash,
      ),

    createCondition: (input: CreateConditionInput) =>
      run(
        'Could not create the condition',
        'Condition is now active',
        (client) => client.conditions.create(input),
        (result: CreateConditionResult) => result.transactionHash,
      ),

    pauseCondition: (id: string) =>
      run(
        'Could not pause the condition',
        'Condition paused',
        (client) => client.conditions.pause(id),
        (hash) => hash,
      ),

    resumeCondition: (id: string) =>
      run(
        'Could not resume the condition',
        'Condition resumed',
        (client) => client.conditions.resume(id),
        (hash) => hash,
      ),

    disableCondition: (id: string) =>
      run(
        'Could not revoke the condition',
        'Condition revoked',
        (client) => client.conditions.disable(id),
        (hash) => hash,
      ),

    rearmCondition: (id: string) =>
      run(
        'Could not re-arm the condition',
        'Condition re-armed',
        (client) => client.conditions.rearm(id),
        (hash) => hash,
      ),

    fundVault: (vault: Address, amount: string) =>
      run(
        'Could not fund the vault',
        'Vault funded',
        (client) => client.vaults.fund(vault, amount),
        (hash) => hash,
      ),

    withdrawAll: (vault: Address) =>
      run(
        'Could not withdraw',
        'Funds withdrawn',
        (client) => client.vaults.withdrawAll(vault),
        (hash) => hash,
      ),

    pauseVault: (vault: Address) =>
      run(
        'Could not pause automation',
        'Automation paused',
        (client) => client.vaults.pause(vault),
        (hash) => hash,
      ),

    resumeVault: (vault: Address) =>
      run(
        'Could not resume automation',
        'Automation resumed',
        (client) => client.vaults.resume(vault),
        (hash) => hash,
      ),

    /** The hard kill switch: disarms the executor and pauses the vault. */
    revokeVault: (vault: Address) =>
      run(
        'Could not revoke automation',
        'Automation revoked',
        (client) => client.vaults.revoke(vault),
        (hash) => hash,
      ),
  };
}

/**
 * Map chain and wallet errors to plain language (§30).
 *
 * Unrecognised errors keep their original first line rather than being replaced
 * with something generic - verbatim is more useful than vague.
 */
export function describeTransactionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/user rejected|user denied|rejected the request/i.test(message)) {
    return 'You rejected the request in your wallet.';
  }
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(message)) {
    return 'Not enough USDC in your wallet to cover this transaction and its gas.';
  }
  if (/InsufficientVaultBalance/i.test(message)) {
    return 'The automation vault does not hold enough USDC for this execution.';
  }
  if (/AmountExceedsLimit|AmountExceedsAuthorized|VaultLimitTooLow/i.test(message)) {
    return 'That amount is above the per-execution limit authorized on the vault.';
  }
  if (/RecipientNotApproved|VaultRecipientMismatch/i.test(message)) {
    return 'That recipient is not the one approved on this vault.';
  }
  if (/VaultPaused/i.test(message)) {
    return 'This automation is paused. Resume it before executing.';
  }
  if (/NotExecutor/i.test(message)) {
    return 'Automation has been revoked on this vault.';
  }
  if (/ConditionNotExecutable/i.test(message)) {
    return 'The condition is not currently due to fire.';
  }
  if (/ConditionNotRearmable/i.test(message)) {
    return 'The monitored balance has not recovered far enough to re-arm yet.';
  }
  if (/ExecutionReplay/i.test(message)) {
    return 'This trigger has already been executed.';
  }
  if (/NotConditionOwner|OwnableUnauthorizedAccount|NotVaultOwner/i.test(message)) {
    return 'That action can only be taken by the owner.';
  }
  if (/NoEvaluatorForKind|OperatorNotSupported/i.test(message)) {
    return 'That condition type is not registered on this deployment.';
  }
  if (/ZeroAddress/i.test(message)) {
    return 'A zero address is not a valid recipient.';
  }
  if (/chain mismatch|chain id|wrong network/i.test(message)) {
    return 'Your wallet is on a different network. Switch to Arc Mainnet.';
  }
  if (/fetch failed|network error|timeout|ECONNREFUSED/i.test(message)) {
    return 'Could not reach the Arc RPC endpoint. Check your connection and retry.';
  }
  if (/nonce too low|replacement transaction underpriced/i.test(message)) {
    return 'A conflicting transaction is already pending. Wait for it to settle, then retry.';
  }
  if (/not configured/i.test(message)) {
    return 'upKEEP contracts are not configured for this build. Deploy them and set the addresses.';
  }

  // viem puts the useful line first; the rest is a stack of context.
  return message.split('\n')[0] ?? 'The transaction could not be completed.';
}
