import Image from 'next/image';
import { cn } from '@/lib/utils';
import logoSymbol from '../../../assets/logo-mark.png';

/**
 * The upKEEP logo.
 *
 * This renders assets/logo-mark.png exactly as supplied: a 1254x1254 square,
 * navy backdrop included. Nothing is removed, recoloured, traced or trimmed.
 * Replace that one file and every mark in the product changes with it.
 *
 * Sizing is height-based (`h-5`, `h-6`). The artwork is square, so width
 * follows automatically and nothing is ever squashed.
 *
 * The full lockup with the wordmark lives at assets/logo-master.png and is used
 * for the social card, where the name belongs in the image. Here the word
 * "upKEEP" is already beside the mark as live text.
 */
export function UpkeepMark({
  className,
  alt = '',
}: {
  className?: string;
  /** Leave empty where "upKEEP" already appears as text next to the mark. */
  alt?: string;
}) {
  return (
    <Image
      src={logoSymbol}
      alt={alt}
      priority
      // Height comes from className; width follows the artwork's aspect ratio.
      className={cn('w-auto shrink-0 object-contain', className)}
      aria-hidden={alt === '' ? true : undefined}
    />
  );
}
