import Image from 'next/image';
import { cn } from '@/lib/utils';
import logoSymbol from '../../../assets/logo-mark-transparent.png';

/**
 * The upKEEP logo.
 *
 * This renders the supplied artwork from assets/logo-mark-transparent.png. It
 * is not a redraw, a trace or an approximation: no colours are substituted and
 * no paths are reconstructed. Change the file and every mark in the product
 * changes with it.
 *
 * The transparent file is generated from assets/logo-mark.png - the master, as
 * supplied - by `npm run logo:transparent`, which removes only the navy
 * backdrop the artwork was exported on. Regenerate rather than editing the
 * transparent copy by hand.
 *
 * Sizing is height-based (`h-5`, `h-6`) rather than `size-*`. The mark is
 * taller than it is wide (684x765 once trimmed), so forcing it into a square
 * box would squash it. Width follows the aspect ratio automatically.
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
