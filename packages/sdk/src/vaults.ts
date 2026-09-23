/**
 * `upkeep.vaults.*`
 *
 * A vault is the permission upKEEP is granted. It holds only the USDC a user
 * explicitly set aside for automation, and exposes exactly one capability to
 * the executor: move at most `maxPerExecution` to exactly `recipient`.
 *
 * Everything an owner needs to stay in control - pause, revoke, withdraw - is
 * here, and none of it can be taken away by the protocol.
 */
import type { Address, Hash } from 'viem';
import { automationVaultAbi, automationVaultFactoryAbi } from './abi.js';
import type { UpkeepContext } from './client.js';
import { ValidationError, WalletRequiredError } from './errors.js';
import type { VaultInfo } from './core/types.js';
import type { AuthorizationStatus, SecurityPolicy } from './core/authorization.js';
import { toUsdcWei } from './core/units.js';
import { sendArcTransaction } from './tx.js';
import { readBatch, readBatchAllowFailure } from './internal/multicall.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * Right-pad a short ASCII tag into bytes32, the way Solidity stores a string
 * literal assigned to bytes32. Used for the policy's mode tag.
 */
function stringToBytes32(value: string): `0x${string}` {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 32) throw new ValidationError('Value does not fit in bytes32.');
  const padded = new Uint8Array(32);
  padded.set(bytes);
  return `0x${Array.from(padded, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Inverse of stringToBytes32, trimming the zero padding. */
export function bytes32ToString(value: string): string {
  const hex = value.replace(/^0x/, '').replace(/(00)+$/, '');
  const bytes = hex.match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) ?? [];
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export interface CreateVaultInput {
  /** The single destination automation may ever send funds to. */
  recipient: Address;
  /** Ceiling on one automated transfer. */
  maxPerExecution: string | bigint;
  /**
   * Ceiling on everything automation may move in one UTC day. Omit for none.
   *
   * Must be at least `maxPerExecution`, or the per-execution ceiling could
   * never be reached and one of the two numbers would be meaningless.
   */
  maxPerDay?: string | bigint;
  /** USDC to deposit at creation. Optional; the vault can be funded later. */
  deposit?: string | bigint;
  /** Executor to authorize. Defaults to the factory's configured executor. */
  executor?: Address;
}

export interface VaultsApi {
  create: (input: CreateVaultInput) => Promise<{ transactionHash: Hash; vault?: Address }>;
  get: (vault: Address) => Promise<VaultInfo>;
  listFor: (owner?: Address) => Promise<Address[]>;
  fund: (vault: Address, amount: string | bigint) => Promise<Hash>;
  withdraw: (vault: Address, amount: string | bigint, to?: Address) => Promise<Hash>;
  withdrawAll: (vault: Address, to?: Address) => Promise<Hash>;
  pause: (vault: Address) => Promise<Hash>;
  resume: (vault: Address) => Promise<Hash>;
  /** The hard kill switch: disarms the executor and pauses. */
  revoke: (vault: Address) => Promise<Hash>;
  setRecipient: (vault: Address, recipient: Address) => Promise<Hash>;
  setMaxPerExecution: (vault: Address, max: string | bigint) => Promise<Hash>;
  /** Preview the recipient/fee split at this vault's immutable rate. */
  preview: (vault: Address, amount: string | bigint) => Promise<{ netAmount: bigint; fee: bigint }>;

  /** The authorization scheme this vault currently uses. */
  authorization: (vault: Address) => Promise<AuthorizationStatus>;

  /**
   * Replace the authorization policy.
   *
   * This is the migration path. It touches only the vault: any condition bound
   * to it keeps its id, threshold, action and history, and carries on running.
   */
  setSecurityPolicy: (vault: Address, policy: Partial<SecurityPolicy>) => Promise<Hash>;
}

export function createVaultsApi(ctx: UpkeepContext): VaultsApi {
  function requireWallet(operation: string) {
    if (!ctx.walletClient || !ctx.account) throw new WalletRequiredError(operation);
    return ctx.account;
  }

  return {
    async create(input) {
      requireWallet('vaults.create');
      const addresses = ctx.requireAddresses();

      const maxPerExecution = toUsdcWei(input.maxPerExecution);
      if (maxPerExecution <= 0n) {
        throw new ValidationError('maxPerExecution must be greater than zero.');
      }
      if (input.recipient === ZERO_ADDRESS) {
        throw new ValidationError('The recipient cannot be the zero address.');
      }

      const maxPerDay = input.maxPerDay ? toUsdcWei(input.maxPerDay) : 0n;
      if (maxPerDay !== 0n && maxPerDay < maxPerExecution) {
        throw new ValidationError(
          'maxPerDay must be at least maxPerExecution, or a single transfer could never reach its own ceiling.',
        );
      }

      const deposit = input.deposit ? toUsdcWei(input.deposit) : 0n;

      /*
       * The factory overloads createVault. The four-argument form carries the
       * daily cap; the three-argument form is kept so vaults created before the
       * cap existed still deploy through the same path.
       */
      const transactionHash = await sendArcTransaction(ctx, {
        address: addresses.vaultFactory,
        abi: automationVaultFactoryAbi,
        functionName: 'createVault',
        args:
          maxPerDay === 0n
            ? [input.recipient, maxPerExecution, input.executor ?? ZERO_ADDRESS]
            : [input.recipient, maxPerExecution, maxPerDay, input.executor ?? ZERO_ADDRESS],
        value: deposit,
      });

      // Find the new vault by asking the factory, rather than parsing logs by hand.
      const receipt = await ctx.publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        confirmations: 1,
      });

      let vault: Address | undefined;
      if (receipt.status === 'success') {
        const owned = (await ctx.publicClient.readContract({
          address: addresses.vaultFactory,
          abi: automationVaultFactoryAbi,
          functionName: 'vaultsOf',
          args: [ctx.account!],
        })) as readonly Address[];
        vault = owned[owned.length - 1];
      }

      return { transactionHash, vault };
    },

    async get(vault) {
      const results = await readBatch(ctx.publicClient, [
        { address: vault, abi: automationVaultAbi, functionName: 'owner' },
        { address: vault, abi: automationVaultAbi, functionName: 'executor' },
        { address: vault, abi: automationVaultAbi, functionName: 'recipient' },
        { address: vault, abi: automationVaultAbi, functionName: 'maxPerExecution' },
        { address: vault, abi: automationVaultAbi, functionName: 'paused' },
        { address: vault, abi: automationVaultAbi, functionName: 'feeBps' },
      ]);

      const [owner, executor, recipient, maxPerExecution, paused, feeBps] = results as unknown as [
        Address,
        Address,
        Address,
        bigint,
        boolean,
        bigint,
      ];

      /*
       * The daily cap was added after the first vaults were deployed, and a
       * vault is not upgradeable. Reading these from an older vault reverts, so
       * they are fetched tolerantly and absence is reported as "no cap" rather
       * than failing the whole lookup. An old vault is not broken; it simply
       * predates the feature.
       */
      const [dayCap, spent] = await readBatchAllowFailure(ctx.publicClient, [
        { address: vault, abi: automationVaultAbi, functionName: 'maxPerDay' },
        { address: vault, abi: automationVaultAbi, functionName: 'spentToday' },
      ]);

      const maxPerDay = dayCap?.status === 'success' ? (dayCap.result as bigint) : 0n;
      const spentToday = spent?.status === 'success' ? (spent.result as bigint) : 0n;

      const balance = await ctx.publicClient.getBalance({ address: vault });

      return {
        address: vault,
        owner,
        executor,
        recipient,
        maxPerExecution,
        maxPerDay,
        spentToday,
        remainingToday:
          maxPerDay === 0n ? undefined : maxPerDay > spentToday ? maxPerDay - spentToday : 0n,
        balance,
        paused,
        feeBps: Number(feeBps),
        revoked: executor === ZERO_ADDRESS,
      };
    },

    async listFor(owner) {
      const addresses = ctx.requireAddresses();
      const target = owner ?? ctx.account;
      if (!target) throw new ValidationError('An owner address is required.');

      const vaults = await ctx.publicClient.readContract({
        address: addresses.vaultFactory,
        abi: automationVaultFactoryAbi,
        functionName: 'vaultsOf',
        args: [target],
      });
      return [...(vaults as readonly Address[])];
    },

    async fund(vault, amount) {
      requireWallet('vaults.fund');
      const value = toUsdcWei(amount);
      if (value <= 0n) throw new ValidationError('Deposit must be greater than zero.');

      return sendArcTransaction(ctx, {
        address: vault,
        abi: automationVaultAbi,
        functionName: 'deposit',
        value,
      });
    },

    async withdraw(vault, amount, to) {
      const account = requireWallet('vaults.withdraw');
      return sendArcTransaction(ctx, {
        address: vault,
        abi: automationVaultAbi,
        functionName: 'withdraw',
        args: [toUsdcWei(amount), to ?? account],
      });
    },

    async withdrawAll(vault, to) {
      const account = requireWallet('vaults.withdrawAll');
      return sendArcTransaction(ctx, {
        address: vault,
        abi: automationVaultAbi,
        functionName: 'withdrawAll',
        args: [to ?? account],
      });
    },

    pause: (vault) => {
      requireWallet('vaults.pause');
      return sendArcTransaction(ctx, {
        address: vault,
        abi: automationVaultAbi,
        functionName: 'pause',
      });
    },

    resume: (vault) => {
      requireWallet('vaults.resume');
      return sendArcTransaction(ctx, {
        address: vault,
        abi: automationVaultAbi,
        functionName: 'unpause',
      });
    },

    revoke: (vault) => {
      requireWallet('vaults.revoke');
      return sendArcTransaction(ctx, {
        address: vault,
        abi: automationVaultAbi,
        functionName: 'revokeAutomation',
      });
    },

    setRecipient: (vault, recipient) => {
      requireWallet('vaults.setRecipient');
      if (recipient === ZERO_ADDRESS) {
        throw new ValidationError('The recipient cannot be the zero address.');
      }
      return sendArcTransaction(ctx, {
        address: vault,
        abi: automationVaultAbi,
        functionName: 'setRecipient',
        args: [recipient],
      });
    },

    setMaxPerExecution: (vault, max) => {
      requireWallet('vaults.setMaxPerExecution');
      const value = toUsdcWei(max);
      if (value <= 0n) throw new ValidationError('maxPerExecution must be greater than zero.');
      return sendArcTransaction(ctx, {
        address: vault,
        abi: automationVaultAbi,
        functionName: 'setMaxPerExecution',
        args: [value],
      });
    },

    async authorization(vault) {
      const result = (await ctx.publicClient.readContract({
        address: vault,
        abi: automationVaultAbi,
        functionName: 'authorizationStatus',
      })) as unknown as [Address, `0x${string}`, string, boolean];

      const [provider, schemeId, label, migrationRequired] = result;
      const configured = provider !== ZERO_ADDRESS;

      return {
        provider: configured ? provider : undefined,
        schemeId: configured ? schemeId : undefined,
        label,
        migrationRequired,
        providerConfigured: configured,
      };
    },

    setSecurityPolicy(vault, policy) {
      requireWallet('vaults.setSecurityPolicy');

      // A mode tag is stored on-chain as bytes32, so it has to fit in 32 bytes.
      const mode = policy.authorizationMode ?? 'CURRENT';
      if (new TextEncoder().encode(mode).length > 32) {
        throw new ValidationError('authorizationMode must be 32 bytes or fewer.');
      }

      return sendArcTransaction(ctx, {
        address: vault,
        abi: automationVaultAbi,
        functionName: 'setSecurityPolicy',
        args: [
          policy.provider ?? ZERO_ADDRESS,
          stringToBytes32(mode),
          policy.pauseOnMigrationRequired ?? false,
        ],
      });
    },

    async preview(vault, amount) {
      const result = (await ctx.publicClient.readContract({
        address: vault,
        abi: automationVaultAbi,
        functionName: 'previewExecution',
        args: [toUsdcWei(amount)],
      })) as unknown as [bigint, bigint];

      return { netAmount: result[0], fee: result[1] };
    },
  };
}
