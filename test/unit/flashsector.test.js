// pipeline.js's checkFlashSectorBlank, exercised directly against synthetic
// bytes rather than a real build -- reaching bank 30's own sector by
// actually packing a project's screens that deep would take an
// impractically large fixture (flashSaveSectorBank always names the very
// last bank of a 512 KB UNROM 512 image), so this proves the check's own
// byte math instead: right offset, right length, right message, and no
// false positive on a genuinely blank sector. flashsave.test.js's own
// real-build test covers the thing this check exists to catch actually not
// happening in practice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFlashSectorBlank } from '../../main/build/pipeline.js';
import { resolveMapper } from '../../shared/cartridge.js';

const UNROM512 = resolveMapper(30);
const INES_HEADER = 16;
const SECTOR_BANK = 30; // flashSaveSectorBank(UNROM512) -- the last bank of a 32-bank image
const SECTOR_FILE_OFFSET = INES_HEADER + SECTOR_BANK * 16384 + 0x3000;

/** A minimal UNROM 512 image, every byte $FF, large enough to hold the sector. */
function blankRom() {
  const bytes = new Uint8Array(INES_HEADER + 32 * 16384);
  bytes.fill(0xff);
  return bytes;
}

test('a genuinely blank sector passes', () => {
  assert.doesNotThrow(() => checkFlashSectorBlank(blankRom(), UNROM512));
});

test('a single non-$FF byte anywhere in the sector is refused', () => {
  const bytes = blankRom();
  bytes[SECTOR_FILE_OFFSET + 2048] = 0x00; // the middle of the 4 KB region
  assert.throws(
    () => checkFlashSectorBlank(bytes, UNROM512),
    /did not ship blank/,
    'a byte in the middle of the sector must be caught, not just its edges'
  );
});

test('a non-$FF byte at the very first or very last byte of the sector is refused', () => {
  const first = blankRom();
  first[SECTOR_FILE_OFFSET] = 0x00;
  assert.throws(() => checkFlashSectorBlank(first, UNROM512), /did not ship blank/);

  const last = blankRom();
  last[SECTOR_FILE_OFFSET + 4095] = 0x00;
  assert.throws(() => checkFlashSectorBlank(last, UNROM512), /did not ship blank/);
});

test('a non-$FF byte one past the sector, or one before it, is not caught by this check', () => {
  // Not a gap in the check -- proves it is reading the region B4 asked for
  // (16 + SAVE_BANK*16384 + $3000, 4 KB) and nothing wider or narrower.
  const before = blankRom();
  before[SECTOR_FILE_OFFSET - 1] = 0x00;
  assert.doesNotThrow(() => checkFlashSectorBlank(before, UNROM512));

  const after = blankRom();
  after[SECTOR_FILE_OFFSET + 4096] = 0x00;
  assert.doesNotThrow(() => checkFlashSectorBlank(after, UNROM512));
});

test('a truncated ROM (short of the sector entirely) is refused, not silently skipped', () => {
  const bytes = blankRom().subarray(0, SECTOR_FILE_OFFSET + 10);
  assert.throws(() => checkFlashSectorBlank(bytes, UNROM512), /did not ship blank/);
});
