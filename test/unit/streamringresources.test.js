// Phase 3b S5, C1: the resource matrix of a RING build, the RPG depth pin and the banked-placement close frame at the RPG ceiling. Everything is built through
// the bypass copy (test/lib/ringbypass.js: only the refusal is neutralized), so engine, generator and checkCapacity are production; the RPG ring is still refused by
// validateProject in the shipped tree until C2.
//
// (h)  per board x mirroring x {action, RPG} x {dialogue resident, banked}: what the assembler really used against what checkCapacity charges.
//      kernelCodeBytes covers the real kernel-lo code with the margin kernelbytes.test.js's assertCovers asks for (KERNEL_SLACK .. 2 x KERNEL_SLACK); an RPG's battle
//      region (codeRegions(...)[0]'s nesasm bank) equals battleRegionBytesPlaced EXACTLY -- the absolute check bankedbytes.test.js makes on sample-rpg, here on a ring build,
//      with hero naming on and off (STREAMWORLD_NAMEENTRY_BATTLE_ALLOWANCE) and with the dialogue overlay resident and banked (STREAMWORLD_DIALOGUE_BATTLE_ALLOWANCE) --
//      and stays under battleRegionCeiling. Action x banked is N/A (an action project has no battle bank).
// (h+) the EIGHT optional battle features whose allowance terms the matrix above leaves off (items, magic power, magic defence, monster spell list, battle animation, party attack
//      animation, hit feedback, miss), per RPG board x mirroring x placement: the feature's projectUses* predicate is TRUE in its build (and FALSE in its baseline), the assembled
//      battle region equals battleRegionBytesPlaced, and the isolated code delta against the baseline equals that feature's own *_BATTLE_ALLOWANCE -- so a term that is wrong
//      only on a ring build (streaming + the feature) is seen. A ninth build switches all eight on at once.
// (i)  the RPG depth pin: the STRUCTURAL region ceiling of an RPG on each horizontal board is 13 / 29 / 60 for ANY RPG project (the lightest, one-tileset one reaches it); the
//      default two-tileset RPG reaches 13 / 29 / 59. The ring gate's RPG cells ran at 13 / 29 / 59 (S4c C2 certificate), so on UNROM 512 the 60th row is ADMITTED BY THE CAPACITY CHECK BUT
//      NOT YET MEASURED: C3 resizes the U512-H RPG gate cells to the one-tileset workload (Chris, 2026-10-14, "Measure it in C3"). This pin does not call 60 certified.
// (f)  the banked-placement close frame at the deepest world a close scene admits, on every ring board, with the talker on the second-deepest live screen: the mixed scene (an
//      ordinary map, hence flip_tick: the full Flip + Flash + arrow + close-row queue) at its own ceiling, and the streamed map alone at the board's universal ceiling (no flip_tick,
//      so Flash + arrow + close row). Both keep the assembled overlay-address check.
//
// Wrong implementations these catch: an allowance that drifts from the assembled cost on a ring build, for the baseline or any of the eight features; a kernelCodeBytes term missing
// for the ring fork; a ring RPG that admits a world deeper than the structural ceiling (a battle bank no longer taking a region off the front, a CHR region no longer charged, a
// height charge that wraps); a banked overlay emitted at the resident address; a banked call/address that takes the resident path; a close frame whose structure differs on a banked
// build or at the deepest row.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree, buildThrough } from '../lib/ringbypass.js';
import { cellById, readFns, BULK } from '../lib/ringrun.js';
import { ringProject } from '../lua/ring_gate/ringworld.mjs';
import { closeShape } from '../lua/ring_gate/ringclose.mjs';
import { createStreamedProject } from '../lib/streamedproject.js';
import { captureCloseFrame } from '../lib/ringcloseframe.js';
import { SIX_CELLS, oneTilesetRpg, ceilingCloseProject, featureBase, RING_FEATURES } from '../lib/ringrpg.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';
let tree;
let loaded;
let bt;
let sp;
before(async () => {
  if (skip) return;
  tree = makeBypassTree();
  loaded = await loadBypassTree(tree);
  const u = (f) => pathToFileURL(path.join(tree.root, f)).href;
  bt = await import(u('main/build/battletables.js'));
  sp = await import(u('main/build/streamplacement.js'));
});
after(() => tree?.dispose());

const errorsOf = (p) => [...loaded.shared.validateProject(p), ...loaded.generate.checkCapacity(p).problems].filter((x) => x.severity === 'error');
const usageRow = (log, bank) => {
  const line = log.find((l) => new RegExp(`^BANK\\s+${bank}\\s`).test(l));
  assert.ok(line, `no usage row for bank ${bank}`);
  const [, used, free] = line.match(/(\d+)\/\s*(\d+)\s*$/);
  return { used: Number(used), free: Number(free) };
};
const bisect = async (ok, hi = 255, min = 1) => {
  if (!(await ok(min))) return 0;
  let lo = min;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (await ok(mid)) lo = mid; else hi = mid - 1; }
  return lo;
};

// ---- (h) the resource matrix on ring builds ----
for (const id of SIX_CELLS) {
  for (const gameType of ['action', 'rpg']) {
    for (const placement of gameType === 'rpg' ? ['resident', 'banked'] : ['resident']) {
      for (const naming of gameType === 'rpg' ? [false, true] : [false]) {
        test(`(h) ring build resources: ${id} ${gameType} ${placement}${naming ? ' +naming' : ''}`, { skip }, async () => {
          const cell = cellById(id);
          const { project } = ringProject({ cell, gameType, n: 4, talkers: 'enter', bulkText: placement === 'banked' ? BULK : 0, mutate: naming ? (p) => { p.party[0].renamable = true; } : undefined });
          assert.deepEqual(errorsOf(project), [], 'the scene is admitted by validate (bypass) and checkCapacity');
          const mapper = loaded.cartridge.resolveMapper(project.cartridge.mapper);
          const built = await buildThrough(loaded, project);
          try {
            const { kernelHiBank, kernelLoBank } = loaded.cartridge.prgLayout(mapper);
            const hi = usageRow(built.log, kernelHiBank);
            const lo = usageRow(built.log, kernelLoBank);
            const fns = readFns(built.symbolPath);
            assert.ok(hi.free >= 0 && lo.free >= 0, `kernel-hi free ${hi.free}, kernel-lo free ${lo.free}`);
            // the dialogue overlay really is where the placement says (three numbers agree: asked, predicted, assembled)
            const banked = sp.streamworldDialogueBanked(project, mapper);
            assert.equal(banked, placement === 'banked', `the placement predicate says banked=${banked}, the scene asked for ${placement}`);
            assert.equal(fns.sw_dlg_single >= 0x8000 && fns.sw_dlg_single < 0xc000, banked, `sw_dlg_single at $${fns.sw_dlg_single?.toString(16)} must be ${banked ? 'in the switchable window' : 'resident'}`);
            // kernel-lo: the reservation covers the real code, with the margin assertCovers asks for
            const codeBytes = lo.used - (fns.reset - 0xc000);
            const reserved = loaded.generate.kernelCodeBytes(project, mapper);
            const margin = reserved - codeBytes;
            assert.ok(margin >= loaded.generate.KERNEL_SLACK && margin <= 2 * loaded.generate.KERNEL_SLACK, `kernelCodeBytes reserves ${reserved} for ${codeBytes} real bytes: margin ${margin} outside [${loaded.generate.KERNEL_SLACK}, ${2 * loaded.generate.KERNEL_SLACK}]`);
            let battle = 'n/a';
            if (gameType === 'rpg') {
              const predicted = sp.battleRegionBytesPlaced(project, mapper);
              const slot = loaded.cartridge.codeRegions(mapper, project.tilesets.length, 1)[0];
              const actual = usageRow(built.log, slot.nesasmBank).used;
              assert.equal(actual, predicted, `battleRegionBytesPlaced predicts ${predicted} bytes of battle region, nesasm used ${actual} (every *_BATTLE_ALLOWANCE active in this project, on a ring build)`);
              assert.ok(predicted <= bt.battleRegionCeiling(mapper), `battle region ${predicted} over its ceiling ${bt.battleRegionCeiling(mapper)}`);
              battle = `${actual}/${bt.battleRegionCeiling(mapper)}`;
            }
            console.log(`# resources ${id} ${gameType} ${placement}${naming ? '+naming' : ''}: kernel-hi free ${hi.free}, kernel-lo free ${lo.free}, kernel code ${codeBytes}/${reserved}, battle region ${battle}`);
          } finally { fs.rmSync(built.dir, { recursive: true, force: true }); }
        });
      }
    }
  }
}

// ---- (h+) the eight optional battle features, on ring builds ----
for (const id of SIX_CELLS) {
  for (const placement of ['resident', 'banked']) {
    test(`(h+) ring build, the eight battle features: ${id} rpg ${placement}`, { skip }, async () => {
      const cell = cellById(id);
      const mapper = loaded.cartridge.resolveMapper(cell.mapper);
      const slot = loaded.cartridge.codeRegions(mapper, 2, 1)[0];
      const measure = async (mutate) => {
        const { project } = ringProject({ cell, gameType: 'rpg', n: 4, talkers: 'enter', bulkText: placement === 'banked' ? BULK : 0, mutate: (p) => { featureBase(p); mutate?.(p); } });
        assert.deepEqual(errorsOf(project), [], 'the scene is admitted by validate (bypass) and checkCapacity');
        const built = await buildThrough(loaded, project);
        try {
          const { kernelLoBank } = loaded.cartridge.prgLayout(mapper);
          const lo = usageRow(built.log, kernelLoBank);
          const fns = readFns(built.symbolPath);
          const used = usageRow(built.log, slot.nesasmBank).used;
          const banked = sp.streamworldDialogueBanked(project, mapper);
          assert.equal(banked, placement === 'banked', 'the placement asked for is the placement predicted');
          assert.equal(fns.sw_dlg_single >= 0x8000 && fns.sw_dlg_single < 0xc000, banked, 'and the one assembled');
          const reserved = loaded.generate.kernelCodeBytes(project, mapper);
          const margin = reserved - (lo.used - (fns.reset - 0xc000));
          assert.ok(margin >= loaded.generate.KERNEL_SLACK && margin <= 2 * loaded.generate.KERNEL_SLACK, `kernelCodeBytes margin ${margin} outside [${loaded.generate.KERNEL_SLACK}, ${2 * loaded.generate.KERNEL_SLACK}]`);
          return { project, used, predicted: sp.battleRegionBytesPlaced(project, mapper), code: used - bt.battleTableBytes(project) };
        } finally { fs.rmSync(built.dir, { recursive: true, force: true }); }
      };
      const off = await measure();
      assert.equal(off.used, off.predicted, 'baseline: assembled == predicted');
      const rows = [];
      for (const f of RING_FEATURES) {
        const baseline = f.base ? await measure(f.base) : off;
        const on = await measure(f.on);
        assert.equal(loaded.shared[f.predicate](on.project), true, `${f.name}: ${f.predicate} is TRUE in the ring build that carries it`);
        assert.equal(loaded.shared[f.predicate](baseline.project), false, `${f.name}: ${f.predicate} is FALSE in its baseline`);
        assert.equal(on.used, on.predicted, `${f.name}: battleRegionBytesPlaced predicts ${on.predicted}, nesasm used ${on.used}`);
        assert.equal(on.code - baseline.code, bt[f.allowance], `${f.name}: the isolated code delta is ${on.code - baseline.code}, ${f.allowance} is ${bt[f.allowance]}`);
        assert.ok(on.predicted <= bt.battleRegionCeiling(mapper), `${f.name}: battle region ${on.predicted} over its ceiling`);
        rows.push(`${f.name} +${on.code - baseline.code}`);
      }
      const all = await measure((p) => { for (const f of RING_FEATURES) { f.on(p); } });
      for (const f of RING_FEATURES) assert.equal(loaded.shared[f.predicate](all.project), true, `all eight on: ${f.predicate}`);
      assert.equal(all.used, all.predicted, `all eight features on one ring build: predicted ${all.predicted}, nesasm used ${all.used}`);
      assert.ok(all.predicted <= bt.battleRegionCeiling(mapper), 'all eight: under the battle region ceiling');
      console.log(`# features ${id} rpg ${placement}: base ${off.used}; ${rows.join(', ')}; all eight ${all.used}/${bt.battleRegionCeiling(mapper)}`);
    });
  }
}

// ---- (i) the RPG depth pin: the structural region ceiling, not the workload one ----
// RPG_CEILING = 62 regions (UNROM 512; MMC1 and MMC3 keep CHR in ROM: their own counts) - 1 minimum CHR payload - 1 RPG code region, for ANY RPG project. RPG_CERTIFIED = the N of
// the ring gate's RPG cells in the S4c C2 certificate (handoff-next/s4c-c2-logs-final/s1b-<MMC1|MMC3|U512>-H-rpg-{resident,banked}.log, line 1). Hardcoded on purpose: a test that
// read the ceiling from the code under test proves nothing. The UNROM 512 difference (60 vs 59) is the one-tileset RPG: C3 measures that row.
const RPG_CEILING = { 'MMC1-H': 13, 'MMC3-H': 29, 'U512-H': 60 };
const RPG_CERTIFIED = { 'MMC1-H': 13, 'MMC3-H': 29, 'U512-H': 59 };
const RPG_TWO_TILESET = { 'MMC1-H': 13, 'MMC3-H': 29, 'U512-H': 59 };
const hRpg = (cell, n, tilesets) => {
  const p = createStreamedProject({ gameType: 'rpg', mapper: cell.mapper, mirroring: 'horizontal', gridW: 1, gridH: n, camera: true });
  return tilesets === 1 ? oneTilesetRpg(p) : p;
};
for (const [id, ceiling] of Object.entries(RPG_CEILING)) {
  test(`(i) depth pin: no RPG world deeper than ${ceiling} rows is admitted on ${id} (certified ${RPG_CERTIFIED[id]})`, { skip }, async () => {
    // Catches a change that lets an admitted RPG world go deeper than the structural ceiling: a battle bank that no longer takes a region (+1), a CHR region no longer charged
    // (+1), a height charge that wraps; and, from the other side, a ceiling that shrinks silently below what the gate certified.
    const cell = cellById(id);
    const mapper = loaded.cartridge.resolveMapper(cell.mapper);
    // 1. the packer: no input gives an RPG's streamed maps more than `ceiling` regions (the most is the lightest project, one tileset, no Save)
    let most = 0;
    for (const tilesets of [0, 1, 2, 3, 4]) for (const reserveFlashSave of [false, true]) most = Math.max(most, loaded.cartridge.screenRegions(mapper, tilesets, 1, { reserveFlashSave }).length);
    assert.equal(most, ceiling, `${mapper.name}: the most 8 KB regions any RPG project can give streamed worlds`);
    // 2. the lightest RPG (one tileset): `ceiling` is admitted, every height above it up to the 255 grid limit is refused by the Map Forge
    assert.deepEqual(errorsOf(hRpg(cell, ceiling, 1)).map((x) => x.message), [], `1 x ${ceiling} (one tileset) is admitted`);
    const over = errorsOf(hRpg(cell, ceiling + 1, 1));
    assert.equal(over.length, 1, `1 x ${ceiling + 1} (one tileset) is refused`);
    assert.equal(over[0].where, 'Map Forge');
    assert.match(over[0].message, new RegExp(`need ${ceiling + 1} of the ${ceiling} 8 KB program regions`));
    const tooDeep = [];
    for (let n = ceiling + 1; n <= 255; n++) { const e = errorsOf(hRpg(cell, n, 1)); if (e.length === 0 || !e.every((x) => x.where === 'Map Forge')) tooDeep.push(n); }
    assert.deepEqual(tooDeep, [], 'no height above the structural ceiling is admitted (one tileset)');
    // 3. the default two-tileset RPG (Main + Battle): its own ceiling, one shallower on UNROM 512 only
    const twoCeiling = RPG_TWO_TILESET[id];
    assert.deepEqual(errorsOf(hRpg(cell, twoCeiling, 2)).map((x) => x.message), [], `1 x ${twoCeiling} (two tilesets) is admitted`);
    const twoOver = [];
    for (let n = twoCeiling + 1; n <= 255; n++) { const e = errorsOf(hRpg(cell, n, 2)); if (e.length === 0 || !e.every((x) => x.where === 'Map Forge')) twoOver.push(n); }
    assert.deepEqual(twoOver, [], 'no height above the two-tileset ceiling is admitted (two tilesets)');
    // 4. both ceiling worlds really assemble
    for (const [n, tilesets] of [[ceiling, 1], [twoCeiling, 2]]) {
      const built = await buildThrough(loaded, hRpg(cell, n, tilesets));
      try { assert.ok(fs.existsSync(built.romPath), `1 x ${n} (${tilesets} tileset${tilesets > 1 ? 's' : ''}) builds`); } finally { fs.rmSync(built.dir, { recursive: true, force: true }); }
    }
  });
}

test('(i) depth pin: the gate workloads (ringProject, two tilesets) are admitted exactly as deep as the certified RPG cells -- and the lightest one-tileset RPG is one row deeper on UNROM 512 only', { skip }, async () => {
  const gate = {};
  for (const [id, certified] of Object.entries(RPG_CERTIFIED)) {
    const cell = cellById(id);
    const at = (talkers, placement) => bisect(async (n) => errorsOf(ringProject({ cell, gameType: 'rpg', n, talkers, bulkText: placement === 'banked' ? BULK : 0 }).project).length === 0);
    // the workloads the gate's campaign scenes use: no per-screen talkers (campaign scenes' `talkers ?? 'none'`), plus the never-reached 3000-character text when the overlay is banked
    gate[id] = { resident: await at('none', 'resident'), banked: await at('none', 'banked') };
    assert.deepEqual(gate[id], { resident: certified, banked: certified }, `${id}: the gate's workload ceiling is the certified N`);
  }
  // the SAME gate workload on a one-tileset project (what C3 will run): one row deeper on UNROM 512, unchanged on the CHR-ROM boards
  for (const [id, ceiling] of Object.entries(RPG_CEILING)) {
    const cell = cellById(id);
    const deeper = await bisect(async (n) => errorsOf(ringProject({ cell, gameType: 'rpg', n, talkers: 'none', bulkText: BULK, mutate: oneTilesetRpg }).project).length === 0);
    assert.equal(deeper, ceiling, `${id}: the one-tileset gate workload reaches the structural ceiling ${ceiling}`);
  }
});

// ---- (f) the banked-placement close frame at the deepest admitted world, talker on the second-deepest live screen ----
// MIXED = the close scene with an ordinary map (flip_tick assembled): at its own ceiling, one region shallower than the board's. UNIVERSAL = the streamed map alone.
const MIXED_CEILING = { 'MMC1-H': 12, 'MMC3-H': 28, 'U512-H': 59, 'MMC3-V': 247, 'MMC1-V': 247, 'U512-V': 247 };
const UNIVERSAL_CEILING = { 'MMC1-H': 13, 'MMC3-H': 29, 'U512-H': 60, 'MMC3-V': 255, 'MMC1-V': 255, 'U512-V': 255 }; // vertical: the 255-screen grid limit, not capacity
const hiLive = (ring, hi) => (ring === 1 ? hi >= 0x20 && hi <= 0x27 : (hi >= 0x20 && hi <= 0x23) || (hi >= 0x28 && hi <= 0x2b));
function assertQueue(r, { flip, parts }, label) {
  const p = r.packets;
  const head = flip ? 4 : 2; // [Flip, Flip,] Flash, arrow hide, then the close row
  assert.equal(p.length, head + parts, `${label}: ${p.length} packets queued, ${head + parts} expected`);
  let i = 0;
  if (flip) {
    assert.ok(p[0].cnt === 2 && p[1].cnt === 2 && hiLive(r.ring, p[0].hi) && hiLive(r.ring, p[1].hi), `${label}: the Flip's two packets are 2-byte bodies in a live nametable`);
    i = 2;
  }
  assert.ok(p[i].hi === 0x3f && p[i].lo === 0 && p[i].cnt === 32, `${label}: the Flash packet is the 32-byte palette write at $3F00`);
  assert.ok(hiLive(r.ring, p[i + 1].hi) && p[i + 1].cnt === 1, `${label}: the arrow hide is a 1-byte write in a live nametable`);
  const row = p.slice(i + 2);
  assert.ok(row.every((k) => hiLive(r.ring, k.hi)), `${label}: the close row is in live nametables`);
  assert.equal(row.reduce((n, k) => n + k.cnt, 0), 32, `${label}: the close row is 32 tiles in all`);
  assert.equal(r.vramLen, p.reduce((n, k) => n + 3 + k.cnt, 0), `${label}: vram_len is headers + data`);
}
for (const id of SIX_CELLS) {
  for (const placement of ['banked', 'resident']) {
    const cell = cellById(id);
    const mapper = () => loaded.cartridge.resolveMapper(cell.mapper);
    const scene = (n, mixed) => ceilingCloseProject({ cell, n, placement, mixed, flat: loaded.generate.flattenScreens }).project;
    const runAt = async (n, mixed, label) => {
      const project = scene(n, mixed);
      assert.deepEqual(errorsOf(project), [], `${label}: admitted at N=${n}`);
      assert.equal(sp.streamworldDialogueBanked(project, mapper()), placement === 'banked', `${label}: the placement predicted`);
      const r = await captureCloseFrame({ loaded, tree, cell, project, placement, n, flip: mixed });
      const shape = closeShape(cell.ring);
      assert.equal(r.overlayAddr >= 0x8000 && r.overlayAddr < 0xc000, placement === 'banked', `${label}: the dialogue overlay sw_dlg_single at $${r.overlayAddr?.toString(16)} is where the ${placement} placement says`);
      assert.equal(cell.ring === 1 ? r.col : r.row, n - 2, `${label}: the talker is on the second-deepest live screen (${n - 2}), got ${cell.ring === 1 ? r.col : r.row}`);
      assertQueue(r, { flip: mixed, parts: shape.parts }, label);
      assert.equal(r.vramLen, mixed ? shape.vramLen : shape.vramLen - 10, `${label}: vram_len`);
      console.log(`# close frame ${id} rpg ${placement}${mixed ? ' (ordinary map, Flip)' : ' (streamed map alone)'}: N=${n}, vram_len ${r.vramLen}, ${r.packets.length} packets, overlay $${r.overlayAddr.toString(16)}`);
    };
    test(`(f) close frame, ordinary map beside the world (Flip + Flash + arrow + row), at that scene's ceiling: ${id} rpg ${placement}`, { skip }, async () => {
      const ceiling = await bisect(async (n) => errorsOf(scene(n, true)).length === 0, 255, 4);
      assert.equal(ceiling, MIXED_CEILING[id], `${id}: the deepest world the mixed close scene admits`);
      assert.notEqual(errorsOf(scene(ceiling + 1, true)).length === 0, true, 'N + 1 is refused');
      await runAt(ceiling, true, `${id} mixed N=${ceiling}`);
    });
    const depths = id === 'U512-H' ? [RPG_CERTIFIED[id], RPG_CEILING[id]] : [UNIVERSAL_CEILING[id]];
    for (const n of depths) {
      test(`(f) close frame at the RPG ceiling, streamed map alone (Flash + arrow + row), N=${n}${id === 'U512-H' ? (n === RPG_CERTIFIED[id] ? ' (certified depth)' : ' (admitted, not yet measured: C3)') : ''}: ${id} rpg ${placement}`, { skip }, async () => {
        assert.equal(await bisect(async (m) => errorsOf(scene(m, false)).length === 0, 255, 4), UNIVERSAL_CEILING[id], `${id}: the deepest world the streamed map alone admits`);
        await runAt(n, false, `${id} alone N=${n}`);
      });
    }
  }
}
