import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 0x71C7...92A4 - the shortened address format used across the product. */
export function shortenAddress(address?: string, chars = 4): string {
  if (!address || address.length < 2 * chars + 2) return address ?? '';
  return `${address.slice(0, 2 + chars)}...${address.slice(-chars)}`;
}

export function shortenHash(hash?: string): string {
  if (!hash) return '';
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

/** "12 seconds ago". Returns "just now" under 5s rather than "0 seconds ago". */
export function timeAgo(input?: string | Date | number): string {
  if (input === undefined || input === null) return 'never';

  const date = input instanceof Date ? input : new Date(input);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(input?: string | Date): string {
  if (!input) return '-';
  const date = input instanceof Date ? input : new Date(input);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Format a gas price in wei as Gwei, for the network status panel. */
export function formatGwei(wei?: bigint, decimals = 2): string {
  if (wei === undefined) return '-';
  const gwei = Number(wei) / 1e9;
  return `${gwei.toFixed(decimals)} Gwei`;
}
