// Phase 3a slice S3b: the scenes of the cross stage build (test/lua/sw_cross_scene.mjs), headless, no Mesen. Cells are the PARENT side's, because
// the new side's marks name routines (sw_talker_cross) that exist only once the engine change lands; the scene is the same on both sides, and the
// capacity/composition checks of the new side run at the end of step C (run_sw_cross.mjs --preflight).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { enumerateAll, cellOptions } from '../lua/sw_cross_cells.mjs';
import { parentProblems, parentTiming } from '../lua/sw_cross_classes.mjs';
import { crossCellProblems } from '../lua/run_sw_cross.mjs';
import { measureCrossCell, customCode, crossMarks, horizontalOptions, RETURN_TAIL, TALKER_MARKS, FLASH_PRODUCER_MARKS, sceneCommands, marksOfCommands, enterCommands } from '../lua/sw_cross_scene.mjs';
import { REPO } from '../lua/sw_manifest_scene.mjs';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const boots = { skip: !hasNesasm && 'nesasm not found on PATH' };
const cells = enumerateAll().filter((c) => c.which === 'parent');
const find = (f) => cells.find(f);

test('the marks a cell records: the talker symbols only on the new side, the Flash producer evidence only where a Flash command exists', () => {
  const flash = find((c) => c.stages.includes('x4') && c.tail === 'flash');
  const plain = find((c) => c.stages.includes('x2'));
  assert.ok(!crossMarks(flash).some((m) => TALKER_MARKS.includes(m)), 'a parent cell never marks a symbol the parent tree lacks');
  assert.ok(crossMarks({ ...flash, which: 'new' }).includes('sw_talker_cross'));
  for (const m of FLASH_PRODUCER_MARKS) assert.ok(crossMarks(flash).includes(m), m);
  assert.ok(!crossMarks(plain).includes('flash_tick'));
  assert.deepEqual(crossMarks(flash), [...new Set(crossMarks(flash))], 'no duplicate mark');
});

test('the custom-code project: one user file and one verbatim engine override, and it builds', boots, async () => {
  const code = customCode(REPO);
  assert.equal(code.files.length, 1);
  assert.equal(code.overrides.length, 1);
  assert.equal(code.overrides[0].name, 'title.asm');
  assert.ok(code.overrides[0].text.length > 100);
  const x6 = find((c) => c.stages.includes('x6'));
  const r = await measureCrossCell(x6, { prepareOnly: true });
  assert.equal(r.prepared, true);
  assert.ok(r.prov.rom, 'a ROM was built');
});

test('the horizontal scene: eight destination actors, 15 tiles plain / 14 with the bound tile, one enter event, the touch actor on the source screen', boots, async () => {
  const plain = find((c) => c.stages.includes('x5h') && c.kind === 'f1' && !c.bound && c.gt === 'action' && c.tail === 'switch' && c.pop === 'many-small');
  const bound = find((c) => c.stages.includes('x5h') && c.kind === 'f1' && c.bound && c.gt === 'action' && c.tail === 'switch' && c.pop === 'many-small');
  const a = await measureCrossCell(plain, { prepareOnly: true });
  const b = await measureCrossCell(bound, { prepareOnly: true });
  const walk = { srcEntities: 1, srcTiles: 1, srcEnter: 0, touchSlot: 0 };
  assert.deepEqual(a.facts, { destEntities: 8, destTiles: 15, boundTiles: 0, enterEvents: 1, touchOnSource: true, ...walk });
  assert.deepEqual(b.facts, { destEntities: 8, destTiles: 14, boundTiles: 1, enterEvents: 1, touchOnSource: true, ...walk });
});

test('the return row: its page is Flash, Move right, Flash, Move left back across the seam, then an observable Set; the SOURCE screen is populated with the talker last', boots, async () => {
  const ret = find((c) => c.stages.includes('x5r') && c.gt === 'action' && !c.bound && c.pop === 'many-small');
  const { opts } = horizontalOptions(ret);
  assert.deepEqual(opts.flashCmds.map((c) => c.op), ['flash', 'move', 'flash', 'move', 'setSwitch']);
  assert.deepEqual(opts.flashCmds.filter((c) => c.op === 'move').map((c) => c.dir), ['right', 'left']);
  assert.deepEqual(RETURN_TAIL.map((c) => c.op), ['flash', 'move', 'setSwitch']);
  // the return destination (the first screen) is a real populated screen: eight actors, the talker in the LAST slot (7), an enter actor in slot 6
  const r = await measureCrossCell(ret, { prepareOnly: true });
  assert.deepEqual([r.facts.srcEntities, r.facts.srcTiles, r.facts.touchSlot, r.facts.enterEvents], [8, 15, 7, 2]);
  assert.ok(r.facts.srcEnter >= 1);
});

test('class (a) alignments: the Flash lead, a Wait of the alignment\'s length, a second Flash, then the 14-px Move and the switch tail', () => {
  const a = find((c) => c.stages.includes('x5h') && c.kind === 'classA' && c.wf === 2);
  const { opts } = horizontalOptions(a);
  assert.deepEqual(opts.flashCmds.map((c) => c.op), ['flash', 'wait', 'flash', 'move', 'setSwitch']);
  assert.equal(opts.flashCmds[1].frames, 2);
  assert.equal(opts.flashCmds[3].dist, 14);
});

test('the RPG-bound class (a) target: Wait-free leads (a Wait costs 43 kernel-lo bytes, free 144 -> 101), a Flash-move gap instead, so the cell BUILDS', () => {
  const t = cells.filter((c) => c.stages.includes('x5h') && c.kind === 'classARpgBound');
  assert.equal(t.length, 8);
  for (const c of t) {
    assert.equal(c.gt, 'rpg'); assert.equal(c.bound, true);
    const { opts } = horizontalOptions(c);
    assert.ok(!opts.flashCmds.some((x) => x.op === 'wait'), c.id);
    assert.ok(opts.flashCmds.filter((x) => x.op === 'flash').length >= 2, 'the second Flash that class (a) needs');
    assert.deepEqual(opts.flashCmds.slice(-2).map((x) => x.op), ['move', 'setSwitch']);
  }
});

// ---- the scene -> measurement integration controls (review 1 finding 2): the marks of a cell are derived from the commands the scene really authors,
// and the REAL rows of that scene (test/fixtures/crossstage/real-vertical.json.gz, measured through the shipped harness) show every implied mark and
// nothing the cell did not ask for.

const real = JSON.parse(gunzipSync(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/crossstage/real-vertical.json.gz'))));
const byId = new Map(enumerateAll().map((c) => [c.id, c]));
const seenIn = (x) => new Set(x.rows.flatMap((r) => r.ran));

test('integration, switch tail: the authored commands are Flash, Move, Set; the marks follow them; the real body runs every one', () => {
  for (const x of [real.composedNew.switch, real.composedParent.switch]) {
    const c = byId.get(x.id);
    assert.deepEqual(sceneCommands(c).map((k) => k.op), ['flash', 'move', 'setSwitch']);
    const implied = marksOfCommands([...sceneCommands(c), ...enterCommands('set')]);
    for (const m of implied) assert.ok(seenIn(x).has(m), `${x.id}: the authored work implies ${m} but no real body ran it`);
    for (const m of seenIn(x)) assert.ok(crossMarks(c).includes(m), `${x.id}: a real body ran ${m}, which the cell did not mark`);
    assert.ok(crossMarks(c).includes('script_op_set') && crossMarks(c).includes('flash_tick'), 'the switch tail and the implicit horizontal Flash lead are both marked');
  }
  // a cell whose authored tail differs derives different marks: the same real rows no longer satisfy the control
  const flash = byId.get(real.composedNew.flash.id);
  assert.ok(marksOfCommands(sceneCommands(flash)).includes('script_op_flash'));
  // script_op_set alone cannot tell the tail from the destination's enter Set (both run it), so the tail is held to the FINAL Move body: only the switch scene's final body ran it
  const tailOnFinal = (x) => x.rows.some((r) => r.ran.includes('move_finish') && r.ran.includes('script_op_set'));
  assert.deepEqual([tailOnFinal(real.composedNew.switch), tailOnFinal(real.composedNew.none)], [true, false]);
  assert.ok(!marksOfCommands(sceneCommands(byId.get(real.composedNew.none.id))).includes('script_op_set'), 'a tail-less cell never marks the switch tail');
});

test('integration, return tail: Flash, Move right, Flash, Move left, Set; the marks include the producer evidence and the real return body ran them', () => {
  const x = real.retNew[0];
  const c = byId.get(x.id);
  assert.deepEqual(sceneCommands(c).map((k) => k.op), ['flash', 'move', 'flash', 'move', 'setSwitch']);
  const implied = marksOfCommands(sceneCommands(c));
  for (const m of implied) assert.ok(seenIn(x).has(m), `${x.id}: the authored work implies ${m} but no real body ran it`);
  for (const m of FLASH_PRODUCER_MARKS) assert.ok(crossMarks(c).includes(m), m);
  // the scene's own facts: the talker is in the last slot of a populated source screen
  assert.deepEqual([x.facts.srcEntities, x.facts.touchSlot], [8, 7]);
  // ... and the real verdict of that very scene passes every class, including the same-body Flash producer of the return crossing
  assert.deepEqual(crossCellProblems(c, { rows: x.rows, facts: x.facts, status: 0, done: true, timeout: false }), []);
});

test('the populated vertical scenes: eight destination actors, the touch actor on the source in its LAST slot, a real parent Move/final body', () => {
  const comp = real.composedNew.switch.facts;
  assert.deepEqual([comp.destEntities, comp.destTiles, comp.enterEvents, comp.touchOnSource, comp.srcEntities, comp.srcTiles], [8, 15, 1, true, 8, 15]);
  assert.equal(comp.touchSlot, 7);
  for (const x of real.destNew) assert.equal(x.facts.destEntities, 8);
  const par = real.composedParent.switch;
  assert.deepEqual(parentProblems(byId.get(par.id), par.rows), []);
  assert.ok(parentTiming(par.rows).move > 10000 && parentTiming(par.rows).final > 5000, 'the parent timing maxima are real Move bodies, not a walk');
});

test('no substitute scene exists: every planned cell is an original, and the damage-merging NPC variant is gone from the scene module', async () => {
  const all = enumerateAll();
  assert.equal(all.filter((c) => c.sub !== undefined).length, 0, 'no cell is a changed copy of another');
  assert.ok(all.every((c) => !/\/dmgmerge$/.test(c.id)));
  assert.equal((await import('../lua/sw_cross_scene.mjs')).mergeDamageNpc, undefined, 'nothing builds a damage-merged scene for any original (review 2 finding 1)');
  assert.equal(fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/crossstage/substitutions.json')), false);
});
