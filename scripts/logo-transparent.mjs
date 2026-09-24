/**
 * Strip the black backdrop from the upKEEP logo without touching the artwork.
 *
 * The source PNG is the blue mark on a solid black square. On a light header
 * that square reads as a box around the logo. The goal is only to remove it:
 * every coloured pixel keeps its exact value.
 *
 * Two things make this harder than "delete dark pixels":
 *
 *   1. The counter inside the arch is dark navy, not black, and it is *part of
 *      the design*. Thresholding on darkness alone would punch a hole through
 *      it and let a light page show through the middle of the mark. So the
 *      background is found by flood-filling inward from the border: only black
 *      that is connected to the edge is removed, and the enclosed navy - which
 *      the blue disc completely surrounds - is never reached.
 *
 *   2. The mark has a soft glow that fades to black over many pixels. A hard
 *      cut would leave a visible ring where the fade was truncated. So inside
 *      the flood-filled region alpha ramps with brightness instead of snapping
 *      to zero, and the glow fades out the way it was drawn.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'assets/logo-symbol.png');
const OUTPUT = resolve(root, 'assets/logo-symbol-transparent.png');

/**
 * Brightness at or below which a pixel can be considered backdrop.
 *
 * Measured on the max channel rather than luminance: the glow is blue, and
 * luminance weights blue at 0.07, so a vivid blue would score as "dark" and be
 * eaten away. Max channel treats a saturated blue as the bright pixel it is.
 */
const BACKDROP_MAX = 90;

const image = sharp(SOURCE).ensureAlpha();
const { width, height } = await image.metadata();
const { data } = await image.raw().toBuffer({ resolveWithObject: true });

const isBackdrop = new Uint8Array(width * height);
const queue = new Int32Array(width * height);
let head = 0;
let tail = 0;

const brightness = (i) => Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);

/** Seed the fill from every border pixel that is dark enough to be backdrop. */
function seed(x, y) {
  const i = y * width + x;
  if (!isBackdrop[i] && brightness(i) <= BACKDROP_MAX) {
    isBackdrop[i] = 1;
    queue[tail++] = i;
  }
}

for (let x = 0; x < width; x++) {
  seed(x, 0);
  seed(x, height - 1);
}
for (let y = 0; y < height; y++) {
  seed(0, y);
  seed(width - 1, y);
}

// Four-connected flood fill. Anything it cannot reach stays fully opaque,
// which is what protects the enclosed navy.
while (head < tail) {
  const i = queue[head++];
  const x = i % width;
  const y = (i - x) / width;

  if (x > 0) seed(x - 1, y);
  if (x < width - 1) seed(x + 1, y);
  if (y > 0) seed(x, y - 1);
  if (y < height - 1) seed(x, y + 1);
}

let cleared = 0;
let faded = 0;

for (let i = 0; i < width * height; i++) {
  if (!isBackdrop[i]) continue;

  // Ramp rather than cut, so the glow keeps its falloff.
  const alpha = Math.round((brightness(i) / BACKDROP_MAX) * 255);
  data[i * 4 + 3] = alpha;

  if (alpha === 0) cleared++;
  else faded++;
}

await sharp(data, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT);

const total = width * height;
console.log(`source  : ${width}x${height}`);
console.log(`cleared : ${cleared} px fully transparent (${((cleared / total) * 100).toFixed(1)}%)`);
console.log(`faded   : ${faded} px partially transparent (the glow falloff)`);
console.log(`kept    : ${total - cleared - faded} px untouched (${(((total - cleared - faded) / total) * 100).toFixed(1)}%)`);
console.log(`wrote   : ${OUTPUT}`);
