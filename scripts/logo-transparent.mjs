/**
 * Produce a transparent-backdrop copy of the logo for use on app surfaces.
 *
 * upKEEP ships the mark twice, on purpose:
 *
 *   assets/logo-mark.png             the artwork exactly as supplied, navy
 *                                    backdrop included. Used for the favicon,
 *                                    the app icons and the social card, where a
 *                                    square tile is what the platform expects.
 *
 *   assets/logo-mark-cutout.png      the same artwork with only the backdrop
 *                                    removed. Used in the header and anywhere
 *                                    else it sits on a page surface, where a
 *                                    baked-in background would show as a tile.
 *
 * The artwork is never altered. The mark's own pixels are passed through
 * untouched; only the navy behind it loses its opacity.
 *
 * Three decisions worth knowing about:
 *
 *   The canvas stays square and uncropped. Trimming to the mark's bounding box
 *   produces a tall arch-shaped image that looks like a triangle wedged into
 *   whatever contains it. The source is already 1254x1254 with the mark
 *   centred, so leaving it alone is both simpler and correct.
 *
 *   The counter inside the arch becomes transparent. Sampling shows it is the
 *   same navy as the backdrop, so it is a letterform counter - the hole in an
 *   "A" - and should let the page through.
 *
 *   Glow pixels are un-blended before being given partial alpha. A glow pixel
 *   in the source is the glow already composited over navy; keeping that colour
 *   while making it translucent drags the navy along, and on a light surface
 *   the glow renders as a grey smudge ringing the mark. Solving the blend
 *   recovers the colour the glow was drawn in.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'assets/logo-mark.png');
const OUTPUT = resolve(root, 'assets/logo-mark-cutout.png');

/** Top of the navy backdrop. At or below this, a pixel is fully transparent. */
const BACKDROP_TOP = 118;

/** Where the glow is solid enough to be fully opaque. */
const MARK_FLOOR = 200;

/** The navy the artwork was composited onto, sampled from the source corners. */
const BACKDROP = [0, 16, 62];

const image = sharp(SOURCE).ensureAlpha();
const { width, height } = await image.metadata();
const { data } = await image.raw().toBuffer({ resolveWithObject: true });

let cleared = 0;
let faded = 0;
let kept = 0;

for (let i = 0; i < width * height; i++) {
  const o = i * 4;

  // Max channel, not luminance: the mark is blue, and luminance weights blue at
  // 0.07, so a vivid blue would score as "dark" and be erased.
  const brightness = Math.max(data[o], data[o + 1], data[o + 2]);

  if (brightness <= BACKDROP_TOP) {
    data[o + 3] = 0;
    cleared++;
    continue;
  }

  if (brightness >= MARK_FLOOR) {
    data[o + 3] = 255;
    kept++;
    continue;
  }

  const ramp = (brightness - BACKDROP_TOP) / (MARK_FLOOR - BACKDROP_TOP);
  const alpha = Math.max(ramp, 0.01); // never divide by zero

  for (let c = 0; c < 3; c++) {
    const unblended = (data[o + c] - BACKDROP[c] * (1 - alpha)) / alpha;
    data[o + c] = Math.max(0, Math.min(255, Math.round(unblended)));
  }

  data[o + 3] = Math.round(ramp * 255);
  faded++;
}

await sharp(data, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT);

const total = width * height;
console.log(`source  : ${width}x${height} (square, uncropped)`);
console.log(`output  : ${width}x${height} (same canvas, backdrop transparent)`);
console.log(`cleared : ${cleared} px transparent (${((cleared / total) * 100).toFixed(1)}%)`);
console.log(`faded   : ${faded} px partial - the glow falloff`);
console.log(`opaque  : ${kept} px passed through untouched`);
console.log(`wrote   : ${OUTPUT}`);
