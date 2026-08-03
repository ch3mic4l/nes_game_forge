// NES master palette and perceptual colour matching.
// Extracted from TileForge (codex_img_to_nes/app.js) so it can be unit tested
// and shared between the renderer and the build pipeline.

const RAW = [
  0x7c7c7c, 0x0000fc, 0x0000bc, 0x4428bc, 0x940084, 0xa80020, 0xa81000, 0x881400,
  0x503000, 0x007800, 0x006800, 0x005800, 0x004058, 0x000000, 0, 0,
  0xbcbcbc, 0x0078f8, 0x0058f8, 0x6844fc, 0xd800cc, 0xe40058, 0xf83800, 0xe45c10,
  0xac7c00, 0x00b800, 0x00a800, 0x00a844, 0x008888, 0, 0, 0,
  0xf8f8f8, 0x3cbcfc, 0x6888fc, 0x9878f8, 0xf878f8, 0xf85898, 0xf87858, 0xfca044,
  0xf8b800, 0xb8f818, 0x58d854, 0x58f898, 0x00e8d8, 0x787878, 0, 0,
  0xfcfcfc, 0xa4e4fc, 0xb8b8f8, 0xd8b8f8, 0xf8b8f8, 0xf8a4c0, 0xf0d0b0, 0xfce0a8,
  0xf8d878, 0xd8f878, 0xb8f8b8, 0xb8f8d8, 0x00fcfc, 0xf8d8f8, 0, 0
];

/** 64 NES colours as [r, g, b]. */
export const NES_PALETTE = RAW.map((n) => (n ? [n >> 16, (n >> 8) & 255, n & 255] : [0, 0, 0]));

/**
 * Indices worth offering to a user or an automatic palette picker: duplicates of
 * black collapse onto $0F, and the "blacker than black" $xD entries are dropped
 * because they can damage some displays.
 */
export const NES_CHOICES = NES_PALETTE
  .map((color, index) => ({ color, index }))
  .filter(({ color, index }, position, all) => {
    if (index % 16 === 0x0d) return false;
    const key = color.join(',');
    if (key === '0,0,0') return index === 0x0f;
    return all.findIndex((entry) => entry.color.join(',') === key) === position;
  })
  .map((entry) => entry.index);

/** True for the $xD entries the palette picker hides. */
export function isUnsafeColor(index) {
  return index % 16 === 0x0d;
}

export function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

/** CIE L*a*b* conversion — perceptual distance beats naive RGB distance badly here. */
export function rgbToLab(r, g, b) {
  const linear = [r, g, b].map((value) => {
    const channel = clampByte(value) / 255;
    return channel > 0.04045 ? ((channel + 0.055) / 1.055) ** 2.4 : channel / 12.92;
  });
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const transform = (value) =>
    value > 216 / 24389 ? Math.cbrt(value) : ((24389 / 27) * value + 16) / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const NES_LAB = NES_PALETTE.map((color) => rgbToLab(color[0], color[1], color[2]));

export function labDistance(first, second) {
  return (
    (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2 + (first[2] - second[2]) ** 2
  );
}

/** Closest NES colour index to an RGB sample, restricted to `choices`. */
export function nearestNesColor(r, g, b, choices = NES_CHOICES) {
  const sample = rgbToLab(r, g, b);
  let best = choices[0];
  let bestDistance = Infinity;
  for (const choice of choices) {
    const distance = labDistance(sample, NES_LAB[choice]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = choice;
    }
  }
  return best;
}

/**
 * Pick four NES colours that best cover a set of RGB pixels, greedily maximising
 * the coverage gain of each additional colour. Returned darkest first.
 */
export function perceptualPaletteFor(pixels) {
  const histogram = new Map();
  for (const pixel of pixels) {
    const index = nearestNesColor(pixel[0], pixel[1], pixel[2]);
    histogram.set(index, (histogram.get(index) || 0) + 1);
  }
  const candidates = [...histogram]
    .map(([index, count]) => ({ index, count }))
    .sort((first, second) => second.count - first.count);
  const picked = candidates.length ? [candidates[0].index] : [0x0f];
  while (picked.length < 4 && picked.length < candidates.length) {
    let best = null;
    let bestGain = -1;
    for (const candidate of candidates) {
      if (picked.includes(candidate.index)) continue;
      let gain = 0;
      for (const sample of candidates) {
        const current = Math.min(
          ...picked.map((index) => labDistance(NES_LAB[sample.index], NES_LAB[index]))
        );
        const next = labDistance(NES_LAB[sample.index], NES_LAB[candidate.index]);
        gain += (current - Math.min(current, next)) * sample.count;
      }
      if (gain > bestGain) {
        bestGain = gain;
        best = candidate.index;
      }
    }
    picked.push(best);
  }
  while (picked.length < 4) {
    picked.push(NES_CHOICES.find((index) => !picked.includes(index)) ?? 0x0f);
  }
  return picked.sort((first, second) => NES_LAB[first][0] - NES_LAB[second][0]);
}

export function cssColor(index) {
  const [r, g, b] = NES_PALETTE[index & 0x3f];
  return `rgb(${r},${g},${b})`;
}

export function colorLabel(index) {
  return `$${(index & 0x3f).toString(16).padStart(2, '0').toUpperCase()}`;
}
