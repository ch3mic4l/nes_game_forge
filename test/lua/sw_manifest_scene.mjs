// Scene builder for the streamed-world frame-gate manifest (plan v5 §5.3/§5.4, slice S1).
//
// One streamed UNROM 512 project per call, shaped like build_sw_driver_timing_roms.mjs's busy walk
// (whose 8-chaser/strip/Flash frame is the reference busy frame) but with real per-actor art, so the
// draw cost the manifest gates is the cost of a real tile population:
//   - the two walk targets, (2,LR) and (2,LR+1), each carry all eight actors; `sizes[i]` is the tile
//     count of actor i's art (a grid metasprite of that many 8x8 tiles, every facing);
//   - `wide` adds one far-away actor whose art reaches +-128, which removes the inside fast path for
//     the whole project (bounds are project-global, plan §3.2) -- the every-tile-straddling row;
//   - `nameStart` starts the game on the (2,LR) target with hero naming on, so the naming grid is up
//     over a screen holding eight live actors (M4c);
//   - `standStart` starts on the same target (the standing rows M1/M3/M4/M6, patrolling non-contact actors);
//   - `sayOnFlash` turns the Down target's slot-7 actor into a touch Flash+Say actor at (240,190) on the walk's
//     corridor, so a dialogue opens while a row strip is in flight (M9 without Flip);
//   - `flashAt` = [x, y] moves the touch Shake/Flash/Sfx npc (default (12,15)); the authored coincidence scene
//     puts it on the Down walk's corridor at (242,225), so its touch Flash restore lands on a row-arm frame;
//   - `flashBeh` / `flashCmds` replace the Flash actor's behaviour (default 'npc') and touch-event commands: a
//     'chaser' whose event is `[{ op: 'flash' }]` re-touches the player on its own, the authored repeated-Flash route;
//   - `stretch` = N (phase 3a S1 fix round 1, F4) populates N CONSECUTIVE screens of the walk column, ending at the map's
//     last row: (2,LR+3-N) down to (2,LR+2) (the start moves to the column beside the first), each with two moving chasers, four static touch-Flash npcs on the corridor at x = 242 (y 40..82, 14 px
//     apart: a touch Flash on every pass) and two moving chasers whose event is `Flash` (they re-touch on their own): the
//     sustained populated route, so backlog and deadline are measured across many dense intervals, not two screens;
//     `stretchTouchYs` (default [40, 54, 68, 82]) moves those four touch npcs, for a test re-authoring the schedule;
//   - `ordinaryStart` adds an ordinary second map carrying the same eight actors and starts on it (M0);
//   - `anim` (phase 3a S1 fix round 1, F1) is the ANIMATION axis of the sweep. null = the legacy art: one frame,
//     duration 8, which never advances (the curve's rows before fix round 1). Otherwise
//       { frames: F | [F x8], dur: D | [D x8] | [[d per frame] x8], alt: bool }
//     -- per actor slot 0-7 (slot 7 is the touch-Flash and damage npcs): the number of frames, the duration of
//     each frame (a scalar applies to every frame; 1..255, what validateProject admits), and `alt`, which makes
//     the odd frames a one-tile pose so the actor's max-tile pose is not the only one on screen. The maximum
//     metasprite of the actor is unchanged, so the project's tile count and art bounds are too: only the
//     entity_animate advance/wrap work and the pose mix move. Actors with different duration vectors are out of
//     phase with one another; actors with the same vector advance on the same body.
//   - `ring` (phase 3b S1b) = { mapper, mirroring, ring: 1|2, n } puts the same workload on a RING cartridge (shared/cartridge.js, the plan's six
//     mapper/mirroring cells): an N x 1 world (ring 1, vertical mirroring: the player walks RIGHT) or a 1 x N world (ring 2, horizontal mirroring: the
//     player walks DOWN) of `n` screens, the two eight-actor targets on the 3rd- and 2nd-to-last screens (the deepest rows/banks, the last one left empty so a Move/walk past the second
//     target still scrolls, as the four-screen grid's last row does), the start on the screen before them, and the touch Shake/Flash/Sfx npc / damage npc on the walk's own corridor. Absent, every path below is exactly what it was.
// Every scene is passed through normalizeProject and must validate with zero errors before it is built (an
// admitted, authorable project, not a hand-rolled one).
// The action fixture is 3x61 (the packing ceiling); the RPG fixture is 3x30 with no Sfx, because a
// 3x61 RPG grid is "61 of the 59 regions" and Flash+Sfx does not fit its kernel-lo. Both choices are
// stated in the slice report.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';
import { streamProjBounds } from '../../shared/streamlayout.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');
const GRID_W = 3;

export const eightSplit = (n, k = 8) => {
  const out = []; let left = n;
  for (let i = 0; i < k; i++) { const t = Math.min(16, Math.ceil(left / (k - i))); out.push(t); left -= t; }
  return out;
};

const perSlot = (v, i, dflt) => (Array.isArray(v) ? v[i] : (v ?? dflt));
const durationOf = (anim, i, f) => { if (!anim) return 8; const d = perSlot(anim.dur, i, 8); return Array.isArray(d) ? d[f % d.length] : d; };

/**
 * Fix round 2 (R2-F1a): what the NORMALIZED project actually holds is checked against what the scene meant to build, by
 * an independent computation (own tile geometry, own bound arithmetic; nothing here reads the builder's tables). Throws
 * on any difference, as the builder does for validation errors:
 *   - every actor with sized art uses the intended animation (all three directions) whose frames are the intended count,
 *     durations and metasprites (the intended tile count, on the intended grid offsets; alt = a one-tile odd pose);
 *   - the far actor of a wide scene uses a one-frame animation of the +-128 metasprite and is placed;
 *   - streamProjBounds (what the engine's inside-class bounds are generated from) equals the bounds of the intended
 *     art: WIDE means the far actor's art really gives -128..127 on both axes, TIGHT means nothing gives more than the
 *     largest grid actually placed.
 */
export function assertSceneArt(project, { sizes, anim, wide, wideActor, intended, turn = null, boundTile = null }) {
  const fail = (m) => { throw new Error('scene art is not what was intended: ' + m); };
  // the bound-tile curve's one tile, by the NORMALIZED coordinates (normalizeProject reads row/col and drops anything else): an ordinary map with
  // exactly one bound tile at the stated row/col/switch/metatile, and no other map holds one
  const bound = project.maps.flatMap((m, mi) => m.screens.flatMap((sc, si) => (sc.boundTiles ?? []).map((b) => ({ mi, si, ...b }))));
  if (boundTile) { if (bound.length !== 1 || JSON.stringify({ switchId: bound[0].switchId, row: bound[0].row, col: bound[0].col, metatileId: bound[0].metatileId }) !== JSON.stringify(boundTile)) fail(`the bound tile is ${JSON.stringify(bound)}, wanted exactly ${JSON.stringify(boundTile)}`); }
  else if (bound.length) fail(`unexpected bound tiles ${JSON.stringify(bound)}`);
  const tilesAre = (ms, n) => Boolean(ms) && ms.tiles.length === n && ms.tiles.every((t, i) => t.x === (i % 4) * 8 && t.y === Math.floor(i / 4) * 8);
  for (const [id, { slot, k }] of intended) {
    const a = project.sprites.actors[id];
    const an = project.sprites.animations[a.anims.walkDown];
    if (turn && id < 8) {
      // direction-specific turn animations (the mutation's `turn`, review 3's R3-F1): each direction's own looping animation of the
      // stated length and duration, whose frame f is the intended grid (or the alternate one-tile pose) of the base cycle's f % F
      const F0 = perSlot(anim?.frames, slot, 1);
      for (const [dir, len] of [['walkSide', turn.side], ['walkUp', turn.up], ['walkDown', turn.down]]) {
        const t = project.sprites.animations[a.anims[dir]];
        if (!t || t.loop !== true || t.frames.length !== (len ?? F0)) fail(`actor ${id} (${a.name}) ${dir}: ${t ? t.frames.length : 'no'} frames, wanted ${len ?? F0} looping`);
        t.frames.forEach((fr, f) => {
          const want = anim?.alt && (f % F0) % 2 === 1 && k > 1 ? 1 : k;
          if (fr.duration !== (len === undefined ? durationOf(anim, slot, f) : (turn.dur ?? 1)) || !tilesAre(project.sprites.metasprites[fr.metaspriteId], want)) fail(`actor ${id} (${a.name}) ${dir} frame ${f}: duration ${fr.duration} / metasprite ${fr.metaspriteId} is not the ${want}-tile grid at duration ${turn.dur ?? 1}`);
        });
      }
      continue;
    }
    if (a.anims.walkUp !== a.anims.walkDown || a.anims.walkSide !== a.anims.walkDown) fail(`actor ${id} (${a.name}): the three directions name different animations`);
    if (!an) fail(`actor ${id} (${a.name}): animation ${a.anims.walkDown} does not exist`);
    const F = perSlot(anim?.frames, slot, 1);
    if (an.frames.length !== F || an.loop !== true) fail(`actor ${id} (${a.name}, slot ${slot}): animation ${a.anims.walkDown} has ${an.frames.length} frames (loop ${an.loop}), wanted ${F} looping`);
    an.frames.forEach((fr, f) => {
      if (fr.duration !== durationOf(anim, slot, f)) fail(`actor ${id} (${a.name}) frame ${f}: duration ${fr.duration}, wanted ${durationOf(anim, slot, f)}`);
      const want = anim?.alt && f % 2 === 1 && k > 1 ? 1 : k;
      if (!tilesAre(project.sprites.metasprites[fr.metaspriteId], want)) fail(`actor ${id} (${a.name}, slot ${slot}) frame ${f}: metasprite ${fr.metaspriteId} is not the ${want}-tile grid`);
    });
  }
  if (wide) {
    const a = project.sprites.actors[wideActor];
    const an = project.sprites.animations[a?.anims?.walkDown];
    const ms = an && project.sprites.metasprites[an.frames[0]?.metaspriteId];
    const two = ms && ms.tiles.length === 2 && ms.tiles[0].x === -128 && ms.tiles[0].y === -128 && ms.tiles[1].x === 127 && ms.tiles[1].y === 127;
    if (!a || a.anims.walkUp !== a.anims.walkDown || a.anims.walkSide !== a.anims.walkDown || an.frames.length !== 1 || !two) fail('the far actor does not draw the +-128 metasprite in one frame');
  }
  const placed = new Set();
  for (const m of project.maps) if (m.streamed === true) for (const s of m.screens) for (const e of s.entities ?? []) placed.add(e.actorId);
  if (wide && !placed.has(wideActor)) fail('the far actor is not placed on a streamed screen');
  if (!wide && wideActor !== -1) fail('a tight scene carries a far actor');
  for (const id of placed) if (!intended.has(id) && id !== wideActor) fail(`actor ${id} is placed but has no intended art`);
  const maxK = Math.max(0, ...[...placed].filter((id) => intended.has(id)).map((id) => intended.get(id).k));
  let want;
  if (wide) want = { OXMIN: -128, OXMAX: 127, OYMIN: -128, OYMAX: 127 };
  else if (maxK === 0) want = { OXMIN: 0, OXMAX: 0, OYMIN: 0, OYMAX: 0 };
  else want = { OXMIN: 0, OXMAX: 8 * (Math.min(maxK, 4) - 1), OYMIN: 0, OYMAX: 8 * (Math.ceil(maxK / 4) - 1) };
  const got = streamProjBounds(project);
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`projection bounds ${JSON.stringify(got)}, wanted ${JSON.stringify(want)} (${wide ? 'wide' : 'tight'} art)`);
}

// `root` = the repository whose pipeline/project modules build the ROM (the parent-commit worktree
// for the "parent alongside" measurement).
//
// buildSceneProject is the project half: the normalized, validated, ASSERTED project (no assembler), so the
// harness itself can be unit-tested (test/unit/streamscene.test.js). buildScene assembles it.
export async function buildScene({ root = REPO, outDir, ...opts }) {
  const { buildProject } = await import(path.join(root, 'main/build/pipeline.js'));
  const { project, icon } = await buildSceneProject({ root, ...opts });
  return assembleScene({ root, buildProject, project, icon, outDir });
}

export async function buildSceneProject({
  root = REPO, gt = 'action', sizes = null, wide = false, beh = null, nosfx = gt === 'rpg', ring = null,
  gridH = gt === 'rpg' ? 30 : 61, start = null, anim = null, flashAt = null, flashBeh = 'npc', flashCmds = null, gauntlet = null, stretch = 0, stretchTouchYs = [40, 54, 68, 82], nameStart = false, standStart = false, ordinaryStart = false, sayOnFlash = false, mutate = null
}) {
  const { createProject, createMap, createScreen, normalizeProject, validateProject } = await import(path.join(root, 'shared/project.js'));
  if (ring && (stretch || gauntlet || ordinaryStart)) throw new Error('a ring scene has no stretch / gauntlet / ordinary-start variant');
  if (ring && !(Number.isInteger(ring.n) && ring.n >= 4 && (ring.ring === 1 || ring.ring === 2))) throw new Error(`bad ring spec ${JSON.stringify(ring)}`);
  const LR = gridH - 3;
  const GW = ring ? (ring.ring === 1 ? ring.n : 1) : GRID_W;
  const GH = ring ? (ring.ring === 1 ? 1 : ring.n) : gridH;
  const idx = (c, r) => r * GW + c;
  const project = createProject('Manifest Scene', gt);
  project.cartridge.mapper = ring ? ring.mapper : 30;
  project.cartridge.mirroring = ring ? ring.mirroring : 'fourscreen';
  project.cartridge.camera = true;
  if (!nosfx) project.sfx.push({ name: 'Blip', volume: 15, steps: [{ note: 8, duration: 4 }] });
  const map = createMap(0, 'Streamed');
  map.gridW = GW; map.gridH = GH; map.streamed = true; map.tilesetId = 0;
  map.screens = Array.from({ length: GW * GH }, () => createScreen());
  project.maps = [map];
  if (ring?.terrain) {
    // S1b round 2 (row 7): a DISTINGUISHABLE-terrain ring, so a strip drawn from the wrong source or to the wrong place shows. Every block's metatile is a function of (screen, col, row) over 23 ids,
    // each with its own four tiles and a palette (id & 3): the formula of ring_gate/ringworld.mjs terrainId (s1b_unit.mjs asserts the two equal). A scene WITHOUT the flag is byte-identical to before.
    for (let id = 1; id <= 24; id++) project.metatiles[id] = { id, name: `Seam ${id}`, tiles: [id * 4, id * 4 + 1, id * 4 + 2, id * 4 + 3], palette: id & 3, collision: id === 24 ? 'solid' : 'open' };
    map.screens.forEach((screen, sIdx) => { for (let i = 0; i < screen.metatiles.length; i++) screen.metatiles[i] = 1 + ((sIdx * 5 + (i & 15) * 7 + (i >> 4) * 3 + (i >> 4)) % 23); });
  }
  project.project.startMap = 0;
  project.project.startScreen = ring ? ((nameStart || standStart) ? ring.n - 3 : ring.n - 4) : (nameStart || standStart) ? idx(2, LR) : idx(1, stretch ? LR + 3 - stretch - 1 : LR - 1);
  project.project.startX = start?.x ?? 120; project.project.startY = start?.y ?? 120;
  if (nameStart) project.party[0].renamable = true;

  const S = sizes ?? [null, null, null, null, null, null, null, null];
  const flashProps = {
    trigger: 'touch',
    event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: flashCmds ?? [{ op: 'shake', frames: 10 }, { op: 'flash' }, ...(nosfx ? [] : [{ op: 'sfx', sfx: 0 }])] }] }
  };
  const sayProps = { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }, { op: 'say', text: 'Ouch. That was bright.' }] }] } };
  const actorAt = (i, name, behavior, damage) => ({ name, behavior, hp: 1, damage });
  const actorIds = [];
  for (let i = 0; i < 7; i++) { actorIds.push(project.sprites.actors.length); project.sprites.actors.push(actorAt(i, `Chaser${i}`, beh ?? 'chaser', ring?.chaserDamage ?? 0)); }
  const flashId = project.sprites.actors.length; project.sprites.actors.push(actorAt(7, 'ShakeFlashNpc', flashBeh, 0));
  // only a stretch scene carries the extra actor: every other scene's actor table (and so the curve's evidence) is unchanged
  const flashChaserId = stretch ? project.sprites.actors.length : -1; if (stretch) project.sprites.actors.push(actorAt(7, 'FlashChaser', 'chaser', 0));
  const dmgId = project.sprites.actors.length; project.sprites.actors.push(actorAt(7, 'DamageNpc', 'npc', 1));
  // only a banked-dialogue ring scene carries the bulk-text actor (it takes slot 7's art like the other npcs)
  const bulkId = ring?.bulk > 0 ? project.sprites.actors.length : -1; if (bulkId >= 0) project.sprites.actors.push(actorAt(7, 'Bulk', 'npc', 0));
  const place = (screenIdx, list) => { const scr = map.screens[screenIdx]; scr.entities = scr.entities ?? []; for (const e of list) scr.entities.push(e); };
  const chaserEnts = (screenTag) => Array.from({ length: 7 }, (_, i) => ({ actorId: actorIds[i], x: 20 + (i % 4) * 40, y: 20 + Math.floor(i / 4) * 40, props: { trigger: 'interact' } }));
  // Right target: 7 chasers + the touch Shake/Flash/Sfx npc (slot 7). Down target: 7 chasers + the damage npc.
  // `gauntlet` = [x, y0, dy]: eight touch-Flash npcs in a line down the walk path instead of the chasers, one static
  // touch npc per dy pixels: the densest of the schedules SWEPT here, not a proven maximum (no such proof is claimed).
  const gauntletEnts = () => Array.from({ length: 8 }, (_, i) => ({ actorId: flashId, x: gauntlet[0], y: gauntlet[1] + i * gauntlet[2], props: flashProps }));
  const stretchEnts = () => [
    ...Array.from({ length: 2 }, (_, i) => ({ actorId: actorIds[i], x: 20 + i * 40, y: 30 + i * 60, props: { trigger: 'interact' } })),
    ...stretchTouchYs.map((y) => ({ actorId: flashId, x: 242, y, props: flashProps })),
    ...[80, 170].map((y) => ({ actorId: flashChaserId, x: 100, y, props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: flashCmds ?? [{ op: 'flash' }] }] } } }))
  ];
  // a ring scene's corridor runs along the ring axis (V: right at the start's y; H: down at the start's x), so the touch npcs sit on it
  const ringAt = (along, across) => (ring.ring === 1 ? [along, across] : [across, along]);
  if (ring) {
    // across = 120: the player's own row/column, so a walk along the ring axis really touches them (measured by the S1b counters)
    const [fx, fy] = flashAt ?? ringAt(40, 120);
    const [dx, dy] = sayOnFlash ? ringAt(90, 120) : ringAt(200, 120);
    place(ring.n - 3, [...chaserEnts(), { actorId: flashId, x: fx, y: fy, props: flashProps }]);
    place(ring.n - 2, [...chaserEnts(), { actorId: dmgId, x: dx, y: dy, props: sayOnFlash ? sayProps : { trigger: 'interact' } }]);
    if (ring.bulk > 0) {
      // never-reached text on the empty last screen, sized to push music+sfx+text past the resident kernel-hi ceiling so the dialogue overlay is placed in the
      // battle bank (streamworldDialogueBanked), as ringworld.ringProject's bulkText does
      const commands = [];
      for (let i = 0; i * 100 < ring.bulk; i++) commands.push({ op: 'say', text: `BULK ${i} `.padEnd(100, String.fromCharCode(65 + (i % 26))) });
      place(ring.n - 1, [{ actorId: bulkId, x: 232, y: 216, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }]);
    }
  } else
  if (stretch) { for (let j = 0; j < stretch; j++) place(idx(2, LR + 3 - stretch + j), stretchEnts()); } else
  if (gauntlet) { place(idx(2, LR), gauntletEnts()); place(idx(2, LR + 1), gauntletEnts()); } else {
  place(idx(2, LR), [...chaserEnts(), { actorId: flashId, x: flashAt ? flashAt[0] : 12, y: flashAt ? flashAt[1] : 15, props: flashProps }]);
  place(idx(2, LR + 1), [...chaserEnts(), sayOnFlash ? { actorId: dmgId, x: 240, y: 190, props: sayProps } : { actorId: dmgId, x: 234, y: 40, props: { trigger: 'interact' } }]); }

  let icon = -1; let wideActor = -1; const intended = new Map(); // actor id -> {slot, k}
  if (sizes) {
    const grid = (n) => Array.from({ length: n }, (_, i) => [(i % 4) * 8, Math.floor(i / 4) * 8]);
    const mk = (id, offs) => ({ id, name: 'm' + id, tiles: offs.map(([x, y], i) => ({ x, y, tile: 0x30 + (i & 15), palette: i & 3, hflip: (i & 1) === 1, vflip: (i & 2) === 2 })) });
    const msBase = project.sprites.metasprites.length; const anBase = project.sprites.animations.length;
    // Only the sizes a scene uses get art: every metasprite and animation costs kernel-lo table bytes, and the
    // hero-naming scenes on an action project have almost none to spare.
    const used = [...new Set(S.map((v) => v ?? 0))].sort((a, b) => a - b);
    const animOf = new Map();
    if (!anim) {
      used.forEach((k, j) => {
        project.sprites.metasprites.push(mk(msBase + j, grid(k)));
        project.sprites.animations.push({ id: anBase + j, name: 'sz' + k, loop: true, frames: [{ metaspriteId: msBase + j, duration: 8 }] });
        animOf.set(k, anBase + j);
      });
    } else {
      const msOfSize = new Map();
      used.forEach((k, j) => { project.sprites.metasprites.push(mk(msBase + j, grid(k))); msOfSize.set(k, msBase + j); });
      let msAlt = -1;
      if (anim.alt) { msAlt = project.sprites.metasprites.length; project.sprites.metasprites.push(mk(msAlt, grid(1))); }
      for (let i = 0; i < 8; i++) {
        const k = S[i] ?? 0;
        const F = perSlot(anim.frames, i, 1);
        const durOf = (f) => { const d = perSlot(anim.dur, i, 8); return Array.isArray(d) ? d[f % d.length] : d; };
        const key = JSON.stringify([k, F, Array.from({ length: F }, (_, f) => durOf(f)), !!anim.alt]);
        if (animOf.has(key)) continue;
        const id = project.sprites.animations.length;
        project.sprites.animations.push({ id, name: `a${id}`, loop: true, frames: Array.from({ length: F }, (_, f) => ({ metaspriteId: anim.alt && f % 2 === 1 && k > 1 ? msAlt : msOfSize.get(k), duration: durOf(f) })) });
        animOf.set(key, id);
      }
      animOf.slot = (i) => { const k = S[i] ?? 0; const F = perSlot(anim.frames, i, 1); const durOf = (f) => { const d = perSlot(anim.dur, i, 8); return Array.isArray(d) ? d[f % d.length] : d; }; return animOf.get(JSON.stringify([k, F, Array.from({ length: F }, (_, f) => durOf(f)), !!anim.alt])); };
    }
    // actors 0-6 are the chasers (S[0..6]); the flash npc and the damage npc both take S[7]
    const bySlot = new Map(); const slotOf = new Map();
    actorIds.forEach((id, i) => { bySlot.set(id, S[i]); slotOf.set(id, i); }); bySlot.set(flashId, S[7]); if (stretch) { bySlot.set(flashChaserId, S[7]); slotOf.set(flashChaserId, 7); } if (bulkId >= 0) { bySlot.set(bulkId, S[7]); slotOf.set(bulkId, 7); } bySlot.set(dmgId, S[7]); slotOf.set(flashId, 7); slotOf.set(dmgId, 7);
    const maxK = Math.max(...S.map((v) => v ?? 0));
    for (const [id, k] of bySlot) {
      const a = project.sprites.actors[id];
      const an = anim ? animOf.slot(slotOf.get(id)) : animOf.get(k ?? 0);
      a.anims = { walkDown: an, walkUp: an, walkSide: an };
      intended.set(id, { slot: slotOf.get(id), k: k ?? 0 });
      if (k === maxK && icon < 0) icon = id;
    }
    if (wide) {
      // every appended id is the ACTUAL array length at the moment of appending (fix round 2, R2-F1a): the animation
      // presets append a variable number of metasprites and animations per scene, so no count computed earlier is safe
      const wideMs = project.sprites.metasprites.length;
      project.sprites.metasprites.push(mk(wideMs, [[-128, -128], [127, 127]]));
      const wideAn = project.sprites.animations.length;
      project.sprites.animations.push({ id: wideAn, name: 'wide', loop: true, frames: [{ metaspriteId: wideMs, duration: 8 }] });
      const wid = project.sprites.actors.length; wideActor = wid;
      project.sprites.actors.push({ name: 'WideFar', behavior: 'npc', hp: 1, damage: 0, anims: { walkDown: wideAn, walkUp: wideAn, walkSide: wideAn } });
      place(ring ? 0 : idx(0, 0), [{ actorId: wid, x: 100, y: 100, props: { trigger: 'interact' } }]);
    }
  }
  if (ordinaryStart) {
    const om = createMap(1, 'Ordinary');
    om.tilesetId = 0; om.gridW = 1; om.gridH = 1; om.screens = [createScreen()];
    om.screens[0].entities = [...chaserEnts(), { actorId: dmgId, x: 200, y: 40, props: { trigger: 'interact' } }];
    project.maps.push(om);
    project.project.startMap = 1; project.project.startScreen = 0;
  }

  // the sweep's authored mutation (test/lua/sw_sweep_mutate.mjs): still BEFORE normalization and validation
  const mutated = mutate ? mutate(project, { createMap, createScreen }) : null;
  // An admitted project: what a loaded, normalized project would be, with zero validation errors.
  Object.assign(project, normalizeProject(project));
  const admission = validateProject(project).filter((p) => p.severity === 'error');
  if (admission.length) throw new Error('scene is not an admitted project: ' + JSON.stringify(admission.slice(0, 3)));
  if (sizes) assertSceneArt(project, { sizes: S, anim, wide, wideActor, intended, turn: mutated?.turn ?? null, boundTile: mutated?.boundTile ?? null });
  return { project, icon, sceneArt: sizes ? { sizes: S, anim, wide } : null };
}

async function assembleScene({ root, buildProject, project, icon, outDir }) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-manifest-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const code = parseSymbolFile(await fs.promises.readFile(built.symbolPath, 'utf8'));
    const pending = new Map();
    scanEquates(await fs.promises.readFile(path.join(dir, 'build', 'constants.asm'), 'utf8'), pending);
    scanEquates(await fs.promises.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8'), pending);
    const ram = new Map(); resolveEquates(pending, ram);
    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'scene.nes');
    await fs.promises.copyFile(built.romPath, romPath);
    const symbols = { code, ram: Object.fromEntries(ram), icon, warnings: (built.warnings ?? []).map((w) => (typeof w === 'string' ? w : w.message ?? JSON.stringify(w))) };
    await fs.promises.writeFile(path.join(outDir, 'symbols.json'), JSON.stringify(symbols));
    return { romPath, symbols, project };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
