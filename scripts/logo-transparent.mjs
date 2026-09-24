/**
 * Strip the backdrop from the upKEEP mark without touching the artwork.
 *
 * The source is the supplied PNG: the blue arch-and-arrow on a dark navy
 * gradient. On a page of any other colour that gradient reads as a rectangle
 * around the logo. The goal is only to remove it - every coloured pixel of the
 * mark keeps its exact value. This is not a redraw, a trace or a recolour.
 *
 * Why a brightness ramp rather than a flood fill:
 *
 *   Sampling the source shows the counter inside the arch is (1,30,100) - the
 *   same navy as the backdrop, not a distinct design colour. It is a letterform
 *   counter, so it *should* become transparent and let the page show through,
 *   exactly like the hole in a printed "A". An earlier version of this script
 *   flood-filled from the border to protect an enclosed colour; that mark had a
 *   solid disc behind it and this one does not.
 *
 *   The brightness histogram is cleanly bimodal: ~79% of pixels sit between 40
 *   and 119 (the navy), ~11% at 250+ (the mark), and the rest is glow falling
 *   off between. So a ramp across that gap separates them without a threshold
 *   that would either eat the glow or leave a navy halo.
 *
 * Brightness is the max channel, not luminance. The mark is blue, and luminance
 * weights blue at 0.07 - a vivid blue would score as "dark" and be erased.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'assets/logo-mark.png');
const OUTPUT = resolve(root, 'assets/logo-mark-transparent.png');

/** Top of the navy backdrop. At or below this, a pixel is fully transparent. */
const BACKDROP_TOP = 118;

/** Where the glow is solid enough to be fully opaque. */
const MARK_FLOOR = 200;

/**
 * The navy the artwork was composited onto, sampled from the source.
 *
 * It is a gradient - (0,12,48) at the corners, (1,20,76) nearer the mark - so
 * this is a mid estimate. Exactness is not needed: it only has to be close
 * enough that un-blending removes the darkness rather than over-correcting.
 */
const BACKDROP = [0, 16, 62];

const image = sharp(SOURCE).ensureAlpha();
const { width, height } = await image.metadata();
const { data } = await image.raw().toBuffer({ resolveWithObject: true });

let cleared = 0;
let faded = 0;
let kept = 0;

for (let i = 0; i < width * height; i++) {
  const o = i * 4;
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

  /*
   * Recover the glow's true colour before assigning alpha.
   *
   * A glow pixel in the source is the glow already blended over navy:
   *
   *     source = glow x a  +  backdrop x (1 - a)
   *
   * Giving it partial alpha while keeping `source` as its colour carries that
   * navy along, and on a light page the glow renders as a grey smudge - a dark
   * halo ringing the mark. Solving the blend for `glow` undoes it, so the glow
   * stays blue against white and unchanged against dark.
   */
  const ramp = (brightness - BACKDROP_TOP) / (MARK_FLOOR - BACKDROP_TOP);
  const alpha = Math.max(ramp, 0.01); // never divide by zero

  for (let c = 0; c < 3; c++) {
    const unblended = (data[o + c] - BACKDROP[c] * (1 - alpha)) / alpha;
    data[o + c] = Math.max(0, Math.min(255, Math.round(unblended)));
  }

  data[o + 3] = Math.round(ramp * 255);
  faded++;
}

/*
 * Trim the transparent margin. The source is a 1254px square with the mark
 * inset, so leaving it would make every rendered logo smaller than its box and
 * force the CSS to compensate. Trimming means the height in `h-6` is the
 * height of the mark.
 */
await sharp(data, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .trim({ threshold: 1 })
  .toFile(OUTPUT);

const trimmed = await sharp(OUTPUT).metadata();
const total = width * height;

console.log(`source  : ${width}x${height}`);
console.log(`cleared : ${cleared} px transparent (${((cleared / total) * 100).toFixed(1)}%)`);
console.log(`faded   : ${faded} px partial - the glow falloff`);
console.log(`opaque  : ${kept} px untouched (${((kept / total) * 100).toFixed(1)}%)`);
console.log(`trimmed : ${trimmed.width}x${trimmed.height}`);
console.log(`wrote   : ${OUTPUT}`);
