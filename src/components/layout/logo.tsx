import Image from 'next/image';
import { cn } from '@/lib/utils';
import logoSymbol from '../../../assets/logo-mark-cutout.png';

/**
 * The upKEEP logo.
 *
 * On app surfaces this renders assets/logo-mark-cutout.png: the supplied
 * artwork with only its navy backdrop made transparent. The mark's own pixels
 * are untouched - nothing is recoloured, traced or trimmed, and the canvas
 * stays the original 1254x1254 square.
 *
 * The cutout exists because the supplied file bakes in its own navy, which
 * averages far brighter than any page surface and therefore shows as a glowing
 * tile around the mark. The favicon, app icons and social card still use
 * assets/logo-mark.png as supplied, because a square tile is exactly what those
 * platforms expect. Regenerate the cutout with `npm run logo:cutout`.
 *
 * Callers set an explicit square (`size-5`, `size-6`) rather than a height with
 * `w-auto`. Letting the width be derived landed it on a fractional pixel at
 * small sizes, so a 24px logo rendered 24x25 and read as slightly off-square.
 * The artwork is square, so pinning both dimensions cannot squash it.
 *
 * `quality={100}` because this is a 1254px image shown at 24px. At Next's
 * default of 75 the downscale muddied the gradient and the glow lost its
 * cleanliness - a cost worth paying on one small, cached asset.
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
      quality={100}
      // Both dimensions come from className, e.g. `size-6`.
      className={cn('shrink-0 object-cover', className)}
      aria-hidden={alt === '' ? true : undefined}
    />
  );
}
