/**
 * Deterministic sample data for UI development and presentations.
 *
 * ONLY reachable when NEXT_PUBLIC_DEMO_MODE=true, which is off by default.
 * Every screen that renders it shows a DEMO MODE banner, and the transaction
 * hashes here are deliberately marked so they can never be mistaken for real
 * Arc Mainnet transactions: they are not valid hashes of anything, and the UI
 * refuses to link them to the explorer.
 *
 * Nothing in this file is ever shown when demo mode is off.
 */
import type { Address } from 'viem';
import {
  computeFeeBreakdown,
  parseUsdc,
  type ConditionView,
  type Execution,
  type VaultInfo,
} from '@upkeep/sdk';

/** Fixed addresses so screenshots and demos are reproducible. */
const DEMO_OWNER = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' as Address;
const DEMO_SUBJECT = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' as Address;
const DEMO_RECIPIENT = '0x8ba1f109551bD432803012645Ac136ddd64DBA72' as Address;
const DEMO_VAULT = '0x4A7C969110f7358bF334b49A2FF1a2585ac372B8' as Address;
const DEMO_EXECUTOR = '0x2546BcD3c84621e976D8185a91A922aE77ECEc30' as Address;

/** Marked so it is obvious at a glance that this is not a real hash. */
const DEMO_TX_PREFIX = '0xdemo0000';

const DEMO_EPOCH = Date.parse('2026-09-21T09:00:00.000Z');

function demoTime(minutesAgo: number): string {
  return new Date(DEMO_EPOCH - minutesAgo * 60_000).toISOString();
}

export function demoConditionViews(): ConditionView[] {
  const threshold = parseUsdc('5000');
  const balance = parseUsdc('8420');

  return [
    {
      condition: {
        id: '1',
        owner: DEMO_OWNER,
        type: 'BALANCE_BELOW',
        kind: 1,
        operator: 1,
        status: 'active',
        arm: 'armed',
        subject: DEMO_SUBJECT,
        asset: 'USDC',
        threshold,
        rearmBuffer: parseUsdc('250'),
        actionId: '1',
        recurring: true,
        triggerCount: 2,
        createdAt: demoTime(60 * 24 * 9),
        lastEvaluatedAt: demoTime(0.2),
        lastTriggeredAt: demoTime(60 * 31),
      },
      action: {
        id: '1',
        type: 'TRANSFER_USDC',
        kind: 1,
        vault: DEMO_VAULT,
        recipient: DEMO_RECIPIENT,
        amount: parseUsdc('1000'),
        maxAmount: parseUsdc('1000'),
      },
      currentValue: balance,
      distanceToTrigger: balance - threshold,
      executable: false,
      rearmable: false,
    },
    {
      condition: {
        id: '2',
        owner: DEMO_OWNER,
        type: 'BALANCE_BELOW',
        kind: 1,
        operator: 1,
        status: 'triggered',
        arm: 'fired',
        subject: DEMO_RECIPIENT,
        asset: 'USDC',
        threshold: parseUsdc('2000'),
        rearmBuffer: parseUsdc('100'),
        actionId: '2',
        recurring: true,
        triggerCount: 1,
        createdAt: demoTime(60 * 24 * 3),
        lastEvaluatedAt: demoTime(1),
        lastTriggeredAt: demoTime(44),
      },
      action: {
        id: '2',
        type: 'TRANSFER_USDC',
        kind: 1,
        vault: DEMO_VAULT,
        recipient: DEMO_RECIPIENT,
        amount: parseUsdc('500'),
        maxAmount: parseUsdc('500'),
      },
      currentValue: parseUsdc('1740'),
      distanceToTrigger: 0n,
      executable: false,
      rearmable: false,
    },
    {
      condition: {
        id: '3',
        owner: DEMO_OWNER,
        type: 'BALANCE_BELOW',
        kind: 1,
        operator: 1,
        status: 'paused',
        arm: 'armed',
        subject: DEMO_SUBJECT,
        asset: 'USDC',
        threshold: parseUsdc('10000'),
        rearmBuffer: 0n,
        actionId: '3',
        recurring: false,
        triggerCount: 0,
        createdAt: demoTime(60 * 24 * 14),
        lastEvaluatedAt: demoTime(60 * 6),
      },
      action: {
        id: '3',
        type: 'TRANSFER_USDC',
        kind: 1,
        vault: DEMO_VAULT,
        recipient: DEMO_RECIPIENT,
        amount: parseUsdc('2500'),
        maxAmount: parseUsdc('2500'),
      },
      currentValue: balance,
      distanceToTrigger: 0n,
      executable: false,
      rearmable: false,
    },
  ];
}

export function demoExecutions(): Execution[] {
  const rows = [
    { amount: '1000', minutesAgo: 31 * 60, conditionId: '1', trigger: 2 },
    { amount: '500', minutesAgo: 44, conditionId: '2', trigger: 1 },
    { amount: '1000', minutesAgo: 60 * 24 * 5, conditionId: '1', trigger: 1 },
  ];

  return rows.map((row, index) => {
    const amount = parseUsdc(row.amount);
    const { fee, netAmount } = computeFeeBreakdown(amount);

    return {
      id: `${DEMO_TX_PREFIX}${index}`,
      conditionId: row.conditionId,
      triggerId: `${DEMO_TX_PREFIX}${index}`,
      transactionHash: `${DEMO_TX_PREFIX}${'0'.repeat(54)}${index}` as `0x${string}`,
      status: 'confirmed' as const,
      amount,
      netAmount,
      fee,
      recipient: DEMO_RECIPIENT,
      vault: DEMO_VAULT,
      observedValue: parseUsdc('4200'),
      triggerCount: row.trigger,
      blockNumber: 0n,
      createdAt: demoTime(row.minutesAgo),
      confirmedAt: demoTime(row.minutesAgo),
    };
  });
}

export function demoVaultInfo(address: Address): VaultInfo {
  return {
    address,
    owner: DEMO_OWNER,
    executor: DEMO_EXECUTOR,
    recipient: DEMO_RECIPIENT,
    maxPerExecution: parseUsdc('1000'),
    // A demo vault with a cap, so the permission screen shows the shape of one.
    maxPerDay: parseUsdc('3000'),
    spentToday: parseUsdc('1000'),
    remainingToday: parseUsdc('2000'),
    balance: parseUsdc('4000'),
    paused: false,
    feeBps: 5,
    revoked: false,
  };
}

export function demoVaultAddress(): Address {
  return DEMO_VAULT;
}

/** True for any identifier produced by this file. Used to block explorer links. */
export function isDemoArtifact(value?: string): boolean {
  return Boolean(value?.startsWith(DEMO_TX_PREFIX));
}
