// Controls for the coverage judge on a REAL recorded run (review 2 findings 1 and 2): one genuine jsnes lap (MMC1-V action, enter talkers) is
// built and recorded once; every control then mutates the RECORDS (never the engine) and the campaign verdict -- vram AND coverage, the two
// verdicts run_oracle.mjs reports -- must reject it while the unmutated records pass. The engine-side counterpart (a real premature-text
// mutation, `instant-text`) runs under run_oracle.mjs in both emulators.   Run: node --test test/lua/ring_gate/record_controls.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTree } from './ringtree.mjs';
import { cellById, ringProject, buildCell } from './ringworld.mjs';
import { laps } from './ringscene.mjs';
import { bootRom, runSteps } from './ringrun_jsnes.mjs';
import { judge, judgeCoverage } from './ringjudge.mjs';

const cell = cellById('MMC1-V');
const scene = laps({ ring: cell.ring, talkers: 'enter' });
const { project, gridW, gridH } = ringProject({ cell, gameType: 'action', talkers: 'enter' });
const ctx = { project, ring: cell.ring, gridW, gridH, typing: scene.expect.typing };
const tree = makeTree({ ring: true });
const built = await buildCell({ tree, project, cell, gameType: 'action', label: 'record-controls' });
const records = runSteps(bootRom(built.romPath), scene.steps);
fs.rmSync(built.dir, { recursive: true, force: true });
fs.rmSync(tree.root, { recursive: true, force: true });

/** The campaign verdict of a record list: every record's byte verdict, then the coverage verdict. Returns the failure strings of both. */
const campaign = (recs) => [...recs.map((r) => judge(r, ctx)).filter((v) => !v.ok).map((v) => `vram ${v.label}: ${v.fails[0]}`), ...judgeCoverage(recs, scene.expect, ctx).fails.map((f) => `coverage: ${f}`)];
const idx = (pred) => records.findIndex(pred);
const clone = () => records.slice();

test('the unmutated real lap passes both verdicts (the matching positive)', () => assert.deepEqual(campaign(records), []));

test('removing the cold-boot checkpoint fails coverage (review 2 probe `missingColdBoot`)', () => {
  const r = clone(); r.splice(idx((x) => x.label === 'cold-boot'), 1);
  assert.ok(campaign(r).some((f) => /coverage: missing mandatory record check:cold-boot/.test(f)), campaign(r).join('\n'));
});
test('substituting the cold-boot label, duplicating it, and adding an unexpected checkpoint each fail', () => {
  const i = idx((x) => x.label === 'cold-boot');
  const sub = clone(); sub[i] = { ...sub[i], label: 'warm-boot' };
  assert.ok(campaign(sub).some((f) => /missing mandatory record check:cold-boot/.test(f)) && campaign(sub).some((f) => /unexpected record check:warm-boot/.test(f)));
  const dup = clone(); dup.splice(i, 0, records[i]);
  assert.ok(campaign(dup).some((f) => /duplicate record check:cold-boot/.test(f)));
  const extra = clone(); extra.push({ ...records[i], label: 'extra' });
  assert.ok(campaign(extra).some((f) => /unexpected record check:extra/.test(f)));
});
test('reordering two mandatory checkpoints fails coverage', () => {
  const r = clone(); const a = idx((x) => x.label === 'cold-boot'); const b = idx((x) => /^fwd@/.test(x.label));
  [r[a], r[b]] = [r[b], r[a]];
  assert.ok(campaign(r).some((f) => /coverage: reordered records/.test(f)), campaign(r).join('\n'));
});
test('dropping a dialogue transaction, or only its typing stage, fails coverage', () => {
  const i = idx((x) => x.kind === 'dlg-typing');
  const noTyping = clone(); noTyping.splice(i, 1);
  assert.ok(campaign(noTyping).some((f) => /missing mandatory record dialogue@/.test(f)), campaign(noTyping).join('\n'));
  const gone = clone(); gone.splice(i, 3);
  assert.ok(campaign(gone).some((f) => /missing mandatory record dialogue@/.test(f)), campaign(gone).join('\n'));
});
test('swapping two dialogue transactions (the same screens in a different order) fails as reordered', () => {
  const ts = records.map((r, i) => (r.kind === 'dlg-typing' ? i : -1)).filter((i) => i >= 0);
  const [a, b] = [ts[1], ts[2]]; // the first two crossings: different screens
  assert.notEqual(records[a + 1].state.sw_col, records[b + 1].state.sw_col);
  const r = clone();
  const [ta, tb] = [r.slice(a, a + 3), r.slice(b, b + 3)];
  r.splice(a, 3, ...tb); // lengths are equal, so the indices of the other transaction hold
  r.splice(b, 3, ...ta);
  assert.ok(campaign(r).some((f) => /reordered records/.test(f)), campaign(r).join('\n'));
});
test('the reviewer\'s typing counterexample, built from the real boot records, fails BOTH verdicts', () => {
  // boot:open is the complete box; remove the page arrow, relabel it the typing stage, and give it the impossible counters.
  const open = records[idx((x) => x.label === 'boot:open')];
  const vram = Object.fromEntries(Object.entries(open.vram).map(([k, v]) => [k, v.slice()]));
  for (const base of Object.keys(vram)) for (let i = 0; i < 960; i++) if (vram[base][i] === 0xff) vram[base][i] = 0xa0; // ARROW_TILE -> space
  const fake = { ...open, label: 'boot:typing', kind: 'dlg-typing', vram, state: { ...open.state, box_state: 2, msg_line: 99, msg_col: 3, vram_len: 0 } };
  const r = clone(); r[idx((x) => x.label === 'boot:typing')] = fake;
  assert.equal(judge(fake, ctx).ok, false, 'vram verdict');
  assert.ok(campaign(r).some((f) => /^coverage: typing record boot:typing: msg_line 99 is outside/.test(f)), campaign(r).join('\n'));
  assert.ok(campaign(r).some((f) => /^vram boot:typing/.test(f)));
});
test('a complete page with honest counters standing in for the typing stage fails both verdicts', () => {
  const open = records[idx((x) => x.label === 'boot:open')];
  const vram = Object.fromEntries(Object.entries(open.vram).map(([k, v]) => [k, v.slice()]));
  for (const base of Object.keys(vram)) for (let i = 0; i < 960; i++) if (vram[base][i] === 0xff) vram[base][i] = 0xa0;
  const fake = { ...open, label: 'boot:typing', kind: 'dlg-typing', vram, state: { ...open.state, box_state: 2, msg_line: 0, msg_col: 13, vram_len: 0 } };
  const r = clone(); r[idx((x) => x.label === 'boot:typing')] = fake;
  assert.ok(campaign(r).some((f) => /^coverage: typing record boot:typing: typing record with the whole first page typed/.test(f)), campaign(r).join('\n'));
  assert.ok(campaign(r).some((f) => /^vram boot:typing/.test(f)));
});
