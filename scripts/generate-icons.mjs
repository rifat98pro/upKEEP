#!/usr/bin/env node
/**
 * Generate the app icons and social preview from the master logo.
 *
 * The master is a square lockup (symbol + wordmark) on a dark background, which
 * is exactly right for a favicon, an Apple touch icon and a social card — and
 * exactly wrong for the 16-20px inline marks beside the word "upKEEP" in the
 * header and sidebar. Those use the SVG symbol in components/layout/logo.tsx
 * instead, so the wordmark is not rendered twice and the mark stays legible on
 * a light background.
 *
 *   node scripts/generate-icons.mjs [path-to-master.png]
 */
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The full lockup: symbol plus wordmark, on its dark backdrop. */
const lockup = join(root, 'assets', 'logo-master.png');

/** The symbol alone, transparent background. Used wherever there is no room
 *  for the wordmark, or where the name already appears as text beside it. */
const symbol = join(root, 'assets', 'logo-symbol.png');

for (const [label, path] of [['lockup', lockup], ['symbol', symbol]]) {
  if (!existsSync(path)) {
    console.error(`Missing ${label} artwork: ${path}`);
    process.exit(1);
  }
}

/** The current logo's own backdrop, sampled from its corners. */
const BACKDROP = '#000000';

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const appDir = join(root, 'src', 'app');
mkdirSync(appDir, { recursive: true });

async function main() {
  const lockupMeta = await sharp(lockup).metadata();
  const symbolMeta = await sharp(symbol).metadata();
  console.log(`lockup: ${lockupMeta.width}x${lockupMeta.height}`);
  console.log(`symbol: ${symbolMeta.width}x${symbolMeta.height}`);

  /*
   * Favicons use the symbol rather than the lockup. A wordmark is unreadable at
   * 16px, and the symbol is the part that has to be recognisable in a tab strip.
   * `contain` keeps the artwork's proportions and pads with transparency rather
   * than cropping or stretching it.
   */
  await sharp(symbol)
    .resize(512, 512, { fit: 'contain', background: BACKDROP })
    .png({ compressionLevel: 9 })
    .toFile(join(appDir, 'icon.png'));
  console.log('wrote src/app/icon.png            512x512  (logo)');

  // Apple touch icon. iOS composites onto its own tile and applies rounding,
  // so the backdrop is filled rather than left transparent.
  await sharp(symbol)
    .resize(180, 180, { fit: 'contain', background: BACKDROP })
    .flatten({ background: BACKDROP })
    .png({ compressionLevel: 9 })
    .toFile(join(appDir, 'apple-icon.png'));
  console.log('wrote src/app/apple-icon.png      180x180  (logo)');

  /*
   * Social preview at the 1.91:1 ratio X and most link unfurlers expect.
   * The square master is scaled to the full height and the backdrop extended
   * sideways, which blends because the master's own edges are already this
   * colour.
   */
  const ogHeight = 630;
  const ogWidth = 1200;
  const sidePad = Math.round((ogWidth - ogHeight) / 2);

  await sharp(symbol)
    .resize(ogHeight, ogHeight, { fit: 'cover' })
    .extend({
      left: sidePad,
      right: ogWidth - ogHeight - sidePad,
      background: BACKDROP,
    })
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(join(appDir, 'opengraph-image.png'));


  console.log(`wrote src/app/opengraph-image.png ${ogWidth}x${ogHeight}  (logo)`);

  // Copies for README and docs use.
  mkdirSync(join(root, 'public'), { recursive: true });

  await sharp(symbol)
    .resize(256, 256, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(join(root, 'public', 'logo.png'));
  console.log('wrote public/logo.png             256x256  (logo)');

  await sharp(symbol)
    .resize({ height: 256 })
    .png({ compressionLevel: 9 })
    .toFile(join(root, 'public', 'logo-symbol.png'));
  console.log('wrote public/logo-symbol.png      h256     (symbol)');
}

main().catch((error) => {
  console.error('Icon generation failed:', error);
  process.exit(1);
});
