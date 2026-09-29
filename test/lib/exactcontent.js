// Shared exact-content helpers for the streamed-world ceiling suites (moved verbatim out of
// test/unit/streamedceiling.test.js so test/unit/streamworlddialogueboundary.test.js can author the
// same exact totals instead of growing until something refuses). Both measure with checkCapacity's
// own compiled byte counts (textBytes etc.), which are pure measurements, not the gate under test.
import assert from 'node:assert/strict';
import { checkCapacity } from '../../main/build/generate.js';

export const WORD_CAP = 20; // safely under BOX_COLS=28 (shared/font.js) so no word this helper writes ever wraps-off

export function growTextExactlyBy(project, sayCmd, delta) {
  const cur0 = checkCapacity(project).textBytes;
  const target = cur0 + delta;
  let cur = cur0;
  let text = sayCmd.text || '';
  let wordLen = /\S+$/.exec(text)?.[0]?.length ?? 0;
  if (text === '' || /\s$/.test(text) || wordLen === 0) {
    sayCmd.text = text + (text && !/\s$/.test(text) ? ' ' : '') + 'x';
    text = sayCmd.text;
    wordLen = 1;
    cur = checkCapacity(project).textBytes;
    assert.ok(cur <= target, `starting a word overshot: ${cur} > ${target}`);
  }
  while (target - cur > WORD_CAP + 2) {
    while (wordLen < WORD_CAP) {
      sayCmd.text += 'x';
      wordLen++;
    }
    cur = checkCapacity(project).textBytes;
    assert.ok(cur <= target, `coarse word growth overshot: ${cur} > ${target}`);
    sayCmd.text += ' x';
    wordLen = 1;
    cur = checkCapacity(project).textBytes;
    assert.ok(cur <= target, `starting a new word overshot: ${cur} > ${target}`);
  }
  while (cur < target) {
    if (wordLen >= WORD_CAP) {
      const remaining = target - cur;
      assert.ok(remaining >= 2, `not enough room left to start a new word (${remaining} byte(s) left)`);
      sayCmd.text += ' x';
      wordLen = 1;
      cur = checkCapacity(project).textBytes;
      continue;
    }
    sayCmd.text += 'x';
    wordLen++;
    const next = checkCapacity(project).textBytes;
    assert.equal(next, cur + 1, `a single character must cost exactly 1 byte (was ${next - cur})`);
    cur = next;
  }
  assert.equal(cur, target, `text growth landed on ${cur}, not exact target ${target}`);
}

// Item 4: parses EVERY field of checkCapacity's ceiling-refusal message (generate.js's own
// template, ~line 3958), not just a handful of substring regexes -- so a printed number that
// silently drifted from the value checkCapacity actually computed would be caught here even if
// the message still happened to contain the right words in the right order.
const CEILING_MSG_RE =
  /^Music compiles to (\d+) bytes and sound effects to (\d+) bytes \(Sound Forge\), and dialogue compiles to (\d+) bytes \(Map Forge\)(?:; the streaming engine(?: \(including its scripted-Move probe\))? reserves (\d+) bytes of the same bank)?\. Together they must fit in (\d+) bytes of the (\d+)-byte music and text bank -- (\d+) bytes? over\. Shorten a song or effect, or cut some dialogue\.$/;

export function parseCeilingMessage(message) {
  const m = CEILING_MSG_RE.exec(message);
  assert.ok(m, `ceiling refusal message did not match the expected shape: ${message}`);
  return {
    musicBytes: Number(m[1]),
    sfxBytes: Number(m[2]),
    textBytes: Number(m[3]),
    streamworldHiBytes: m[4] !== undefined ? Number(m[4]) : 0,
    ceiling: Number(m[5]),
    bankSize: Number(m[6]),
    overBy: Number(m[7])
  };
}

