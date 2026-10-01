// Phase 3a slice S1: the OAM-busy flag (engine/boot.asm oam_busy_set_ui / oam_busy_set_draw / oam_busy_clear /
// oam_busy_nmi, engine/combat.asm oam_busy_init; plan section 3.5, tests T9a-d and brief note B2).
//
// The contract: while the main loop is rewriting the sprite shadow at $0200 the NMI must not DMA it. An overrun
// frame therefore leaves the PREVIOUS complete sprite frame on screen; a torn shadow (the player's tiles from this
// frame, the actors' from the last) is never displayed. oam_busy is stored inverted: 0 = the shadow is complete.
//
// How the tests decide "this DMA was a complete frame" (test/lib/oambusyscene.js): nes.ppu.sramDMA is wrapped and
// every DMA's 256 bytes are compared with the set of shadows the ENGINE itself declares complete, taken at the
// instruction where it does so: each arrival at main_loop_ready, the end of boot's draw, any draw_entities return
// made outside both brackets (a landing / redraw under forced blank), the end of a streamed dialogue's open / close
// rebuild, and the content of every manual (non-NMI) DMA (position-jump guard, Flash-Save resync). Those
// intentional-redraw snapshots are part of the oracle so that a valid transition cannot false-fail it; the
// sessions below drive real landings, a real guard fire, a real dialogue rebuild and a real Flash Save and show
// the oracle accepts them (and how many DMAs were accepted only via such a snapshot).
//
// Why the checks are not vacuous, each named where it is asserted:
//   - the oracle is fed a genuinely torn shadow: on the shipped per-tile draw routine (an oracle ROM: the very same
//     project with the streamed projection switched off) eight 16-tile actors overrun the frame naturally, and the
//     NMIs the flag made skip are counted, with how many of them found a shadow that was NOT a complete frame
//     (`wouldTear`): the DMAs the flag actually prevented. Without the flag those are torn DMAs.
//   - a liveness floor: the same runs must still DMA on every ordinary frame (a flag stuck at 1 tears nothing and
//     freezes every sprite).
//   - forced-NMI sweeps take an NMI at every (sampled) instruction of the draw span, so the tear cannot be missed
//     by where the natural vblank happens to fall.
// Sabotage evidence (run in a scratch copy of the tree, recorded in handoff-next/progress-phase3a-s1.md):
//   9a NMI test removed -> the natural-overrun and forced-NMI tests fail; 9b clear at main_loop_ready removed ->
//   the stuck-flag and liveness assertions fail; 9c set at main_loop_ui omitted -> the battle forced-NMI test fails.
//
// RAM addresses are transcribed by hand from engine/constants.asm (test/lib/oambusyscene.js `M`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createProject } from '../../shared/project.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { buildManifestRom, buildRom, bootNes, installRecorder, press, BTN, M, ST } from '../lib/oambusyscene.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';

// from engine/constants.asm
const WIN_ROW_SCREEN = 0x5b3;
const WIN_ROW_LOCAL = 0x5b4;
const SW_FC_DESR = 0x78a;
const SW_FC_DESRL = 0x78b;
const FLAT_SCREEN = 0x16;
const PC_HP = 0x398; // pc_hp, MAX_PARTY bytes

const once = (fn) => { let p = null; return () => (p ??= fn()); };
const EIGHT_BY_16 = Array(8).fill(16);

// ---- scenes (each built once per file) -----------------------------------------------------------------------
// The manifest scene with eight 16-tile actors on the two walk targets. sayOnFlash makes the project use text, which is
// what the cam_dirty NMI guard is gated on (TEXT_ENABLED), so its truth table can be exercised too.
const sceneShipped = once(() => buildManifestRom({ gt: 'action', sizes: EIGHT_BY_16, sayOnFlash: true, shippedDraw: true }));
const sceneProj = once(() => buildManifestRom({ gt: 'action', sizes: EIGHT_BY_16, sayOnFlash: true }));
const sceneNameRpg = once(() => buildManifestRom({ gt: 'rpg', nameStart: true, sizes: Array(8).fill(4) }));
const sceneNameAction = once(() => buildManifestRom({ gt: 'action', nameStart: true, nosfx: true, flashCmds: [{ op: 'say', text: 'Hi.' }] }));

function saverProject() {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
  const map = project.maps.find((m) => m.streamed);
  map.screens[0].entities = [{ actorId: project.sprites.actors.length - 1, x: 200, y: 40, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } } }];
  return project;
}
const sessionAction = once(() => buildRom(saverProject()));

const DOOR_TARGET_SCREEN = 18;
function rpgProject() {
  const project = createStreamedProject({ gameType: 'rpg', gridW: 5, gridH: 5 });
  project.project.startScreen = 12;
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const { startX: X, startY: Y } = project.project;
  project.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
  project.sprites.actors[1] = { name: 'Door', behavior: 'npc', hp: 1, damage: 0 };
  project.sprites.actors[2] = { name: 'Brute', damage: 1, hp: 255, battle: { atk: 255, acc: 255, speed: 255, def: 255 } };
  const map = project.maps.find((m) => m.streamed);
  map.screens[12].entities = [
    { actorId: 0, x: X, y: Y + 32, props: {} },
    { actorId: 1, x: X + 60, y: Y - 40, props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: DOOR_TARGET_SCREEN, x: 64, y: 64 }] }] } } }
  ];
  map.screens[DOOR_TARGET_SCREEN].entities = [{ actorId: 2, x: 112, y: 150, props: {} }];
  return project;
}
const sessionRpg = once(() => buildRom(rpgProject()));

const dialogueProject = () => createStreamedProject({ gameType: 'action', dialogue: ['Hello there traveller.', 'Second.'] });
const sceneDialogue = once(() => buildRom(dialogueProject()));

// ---- driving helpers -------------------------------------------------------------------------------------------
function env(built, opts = {}) {
  const nes = bootNes(built.rom);
  const rec = installRecorder(nes, built.code, opts);
  return { nes, rec, code: built.code, get mem() { return nes.cpu.mem; } };
}
const tap = (e, button, hold = 2, after = 10) => { press(e.nes, [button]); e.rec.run(hold); press(e.nes, []); e.rec.run(after); };
function walkTo(e, tx, ty, budget = 600) {
  const { mem } = e;
  for (let i = 0; i < budget; i++) {
    const b = [];
    if (mem[M.PLAYER_X] > tx + 2) b.push(BTN.LEFT); else if (mem[M.PLAYER_X] < tx - 2) b.push(BTN.RIGHT);
    if (mem[M.PLAYER_Y] > ty + 2) b.push(BTN.UP); else if (mem[M.PLAYER_Y] < ty - 2) b.push(BTN.DOWN);
    if (!b.length) break;
    press(e.nes, b);
    e.rec.run(1);
  }
  press(e.nes, []);
}
const activeActors = (mem) => { let n = 0; for (let i = 0; i < 8; i++) if (mem[M.ENT_ACTIVE + i]) n++; return n; };
/** The manifest scene's first leg (Right) then Down onto the screen holding the eight actors. */
function walkToActors(e) {
  e.rec.run(40);
  press(e.nes, [BTN.RIGHT]); e.rec.run(160);
  press(e.nes, [BTN.DOWN]); e.rec.run(100);
  press(e.nes, []); e.rec.run(4);
  assert.ok(activeActors(e.mem) >= 7, `the player should be on the screen holding the actors (active: ${activeActors(e.mem)})`);
}
/** Force a position-jump guard fire: move the window's current origin 6 blocks off its desired one (the lag trip). */
function pokeGuard(mem) {
  const des = mem[SW_FC_DESR] * 15 + mem[SW_FC_DESRL];
  const t = des + 6 <= 29 ? des + 6 : des - 6;
  mem[WIN_ROW_SCREEN] = Math.floor(t / 15);
  mem[WIN_ROW_LOCAL] = t % 15;
  mem[M.ST_ACTIVE] = 2;
}
const fmt = (rec) => `frames=${rec.frame} nmis=${rec.nmis.length} dmas=${rec.dmas.length} (manual ${rec.dmas.filter((d) => !d.inNmi).length}) skipped(overrun)=${rec.skipped().length} wouldTear=${rec.wouldTear().length} snaps=${rec.snaps.size}`;

/** The three universal checks. */
function assertNoTear(rec, what) {
  const torn = rec.tornDmas();
  assert.equal(torn.length, 0, `${what}: ${torn.length} NMI DMA(s) copied a shadow that was never a complete frame` + (torn[0] ? ` (first at frame ${torn[0].frame}, ${rec.nearest(torn[0])} bytes from the nearest complete shadow)` : ''));
  const bd = rec.busyDmas();
  assert.equal(bd.length, 0, `${what}: ${bd.length} NMI(s) DMA'd while oam_busy was set` + (bd[0] ? ` (first at frame ${bd[0].frame})` : ''));
}

// =====================================================================================================================
// T9a -- no torn shadow is ever DMA'd across an overrun
// =====================================================================================================================

test('T9a: on the shipped per-tile draw routine (natural overrun, 8 x 16 tiles) no NMI DMAs a torn shadow, overrun frames skip their DMA, and a position-jump guard fire (manual DMA) does not false-fail', { skip }, async () => {
  const e = env(await sceneShipped());
  const { nes, rec } = e;
  rec.run(40);
  press(nes, [BTN.RIGHT]); rec.run(160);
  press(nes, [BTN.DOWN]); rec.run(220);
  press(nes, []); rec.run(10);
  // the intentional complete-redraw with a manual DMA: the position-jump guard (NMI off, forced blank ~33 frames)
  const manualBefore = rec.dmas.filter((d) => !d.inNmi).length;
  pokeGuard(e.mem);
  rec.run(70);
  const manual = rec.dmas.filter((d) => !d.inNmi).length - manualBefore;
  press(nes, [BTN.UP]); rec.run(120); press(nes, []); rec.run(20);
  console.log(`# T9a shipped routine: ${fmt(rec)} guard-manual-DMAs=${manual}`);

  assertNoTear(rec, 'T9a shipped');
  assert.ok(rec.skipped().length >= 1, 'the workload must overrun at least once (an NMI arriving while the shadow is being rewritten), or this test proves nothing');
  assert.ok(rec.wouldTear().length >= 1, 'at least one skipped NMI must have found a genuinely torn shadow: those are the DMAs the flag prevented');
  assert.ok(manual >= 1, 'the guard fire must have done its manual DMA (the flag never gates a manual DMA)');
  // liveness: sprites are not frozen -- the overwhelming majority of ordinary frames still DMA
  const nmiDmas = rec.dmas.filter((d) => d.inNmi).length;
  assert.ok(nmiDmas >= rec.frame * 0.5, `sprites must keep updating: ${nmiDmas} NMI DMAs in ${rec.frame} frames`);
});

test('T9a: on the shipped engine (streamed projection) the same walk, guard fire and up-leg DMA only complete shadows; overrun frames (if any) skip cleanly', { skip }, async () => {
  const e = env(await sceneProj());
  const { nes, rec } = e;
  rec.run(40);
  press(nes, [BTN.RIGHT]); rec.run(160);
  press(nes, [BTN.DOWN]); rec.run(220);
  press(nes, []); rec.run(10);
  pokeGuard(e.mem);
  rec.run(70);
  press(nes, [BTN.UP]); rec.run(120); press(nes, []); rec.run(20);
  console.log(`# T9a projection build: ${fmt(rec)}`);
  assertNoTear(rec, 'T9a projection');
  const nmiDmas = rec.dmas.filter((d) => d.inNmi).length;
  assert.ok(nmiDmas >= rec.frame * 0.5, `sprites must keep updating: ${nmiDmas} NMI DMAs in ${rec.frame} frames`);
  assert.ok(rec.dmas.some((d) => !d.inNmi), 'the guard fire must have done its manual DMA');
});

// =====================================================================================================================
// T9b -- an NMI forced inside draw_entities DMAs nothing
// =====================================================================================================================

test('T9b: an NMI forced at sampled instructions across the whole draw_entities span DMAs nothing while the shadow is being rewritten; the same NMI outside the span does DMA', { skip }, async () => {
  const e = env(await sceneProj());
  const { rec, mem } = e;
  walkToActors(e);
  // size the span with an unforced walk (the shortest of a few frames, so an index below it is always reached)
  let len = Infinity;
  for (let i = 0; i < 6; i++) { rec.force = { entry: 'draw_entities', index: 1e9 }; rec.spanLen = 0; rec.run(1); if (rec.spanLen) len = Math.min(len, rec.spanLen); }
  rec.force = null;
  assert.ok(Number.isFinite(len) && len > 200, `draw_entities should be a real span (${len} instructions)`);
  const indices = new Set([0, 1, 2, len - 2, len - 1].map((k) => Math.max(0, Math.min(len - 1, k))));
  const SAMPLES = 140;
  for (let s = 0; s < SAMPLES; s++) indices.add(Math.floor((s * (len - 1)) / (SAMPLES - 1)));
  let fired = 0, missed = 0;
  for (const k of indices) {
    const before = rec.forcedLog.length;
    for (let attempt = 0; attempt < 4 && rec.forcedLog.length === before; attempt++) { rec.force = { entry: 'draw_entities', index: k }; rec.run(1); }
    rec.force = null;
    if (rec.forcedLog.length > before) fired++; else missed++;
    rec.run(2);
  }
  console.log(`# T9b: draw_entities span=${len} instructions, forced NMIs fired=${fired} missed=${missed}, ${fmt(rec)}`);
  assert.ok(fired >= indices.size * 0.9, `the sweep must actually land (fired ${fired} of ${indices.size})`);
  const forced = rec.nmis.filter((n) => n.forced && n.done);
  assert.equal(forced.length, fired, 'every forced NMI ran to its RTI');
  for (const n of forced) {
    assert.notEqual(n.busy, 0, `frame ${n.frame}: a forced NMI inside draw_entities must find oam_busy set`);
    assert.equal(n.dmaAfter, n.dmaBefore, `frame ${n.frame}: a forced NMI inside draw_entities must DMA nothing`);
  }
  assertNoTear(rec, 'T9b');
  // control: the same forced NMI at the top of an ordinary frame (busy clear) DOES DMA, so "nothing" above is the flag, not the forcing
  const nBefore = rec.nmis.length;
  rec.force = { entry: 'read_pad', index: 0 };
  rec.run(2);
  const ctl = rec.nmis.slice(nBefore).find((n) => n.forced && n.done);
  assert.ok(ctl, 'control NMI should have fired');
  assert.equal(ctl.busy, 0);
  assert.equal(ctl.camDirty, 0);
  assert.equal(ctl.dmaAfter - ctl.dmaBefore, 1, 'control: an NMI outside the draw span DMAs the previous complete shadow');
  assert.equal(mem[M.OAM_BUSY], 0);
  assertNoTear(rec, 'T9b control');
});

test('T9e: the NMI OAM-DMA gate is exactly (oam_busy == 0 && cam_dirty == 0): the flag adds a condition and leaves the cam_dirty hold intact', { skip }, async () => {
  const built = await sceneProj();
  // nmi_oam_guard is `lda <cam_dirty / bne` (4 bytes) on a streamed project that uses text: the third row below needs it
  assert.equal(built.code.nmi_oam_guard_end - built.code.nmi_oam_guard_start, 4, 'the cam_dirty guard should be present in this build');
  assert.equal(built.code.oam_busy_nmi_end - built.code.oam_busy_nmi, 4, 'the oam_busy test should be present in this build');
  const e = env(built);
  const { rec, mem } = e;
  walkToActors(e);
  const cases = [
    { busy: 0, dirty: 0, dma: true },
    { busy: 1, dirty: 0, dma: false },
    { busy: 0, dirty: 1, dma: false },
    { busy: 1, dirty: 1, dma: false }
  ];
  for (const c of cases) {
    let armed = true;
    rec.on('read_pad', () => { if (armed) { mem[M.OAM_BUSY] = c.busy; mem[M.CAM_DIRTY] = c.dirty; } });
    rec.on('music_tick', () => { if (armed) { armed = false; mem[M.OAM_BUSY] = 0; mem[M.CAM_DIRTY] = 0; } });
    const before = rec.nmis.length;
    rec.force = { entry: 'read_pad', index: 0 };
    rec.run(2);
    rec.hooks.clear();
    const n = rec.nmis.slice(before).find((x) => x.forced && x.done);
    assert.ok(n, `case ${JSON.stringify(c)}: forced NMI should have fired`);
    assert.equal(n.busy, c.busy);
    assert.equal(n.camDirty, c.dirty);
    assert.equal(n.dmaAfter - n.dmaBefore, c.dma ? 1 : 0, `oam_busy=${c.busy} cam_dirty=${c.dirty}: DMA ${c.dma ? 'must' : 'must not'} happen`);
  }
  assert.equal(mem[M.CAM_DIRTY], 0);
  assert.equal(mem[M.OAM_BUSY], 0);
});

// =====================================================================================================================
// B2 -- forced interrupts on the other paths that write the shadow
// =====================================================================================================================

test('B2(a): an NMI forced inside the strip-arm (sw_stream_start_row) during a downward walk never DMAs a torn shadow, the strip still completes, and the frame that is not busy still DMAs', { skip }, async () => {
  const e = env(await sceneProj());
  const { rec, mem } = e;
  rec.run(40);
  press(e.nes, [BTN.RIGHT]); rec.run(160);
  // probe the span length once
  press(e.nes, [BTN.DOWN]);
  rec.force = { entry: 'sw_stream_start_row', index: 1e9, once: false };
  let idle = 0;
  const armsBefore = rec.forcedLog.length;
  for (let i = 0; i < 400 && !rec.spanLen; i++) rec.run(1);
  rec.force = null;
  const len = rec.spanLen;
  assert.ok(len >= 3, `sw_stream_start_row should be a real span (${len})`);
  const indices = [0, 1, Math.floor(len / 2), len - 2, len - 1].map((k) => Math.max(0, Math.min(len - 1, k)));
  let fired = 0;
  for (let i = 0; i < 700 && fired < indices.length * 2; i++) {
    const before = rec.forcedLog.length;
    if (!rec.force) rec.force = { entry: 'sw_stream_start_row', index: indices[fired % indices.length] };
    rec.run(1);
    if (rec.forcedLog.length > before) { fired++; rec.force = null; }
    if (mem[M.GAME_STATE] !== ST.GAMEPLAY) idle++;
  }
  rec.force = null;
  press(e.nes, []); rec.run(60);
  const forced = rec.nmis.filter((n) => n.forced && n.done);
  const notBusy = forced.filter((n) => n.busy === 0 && n.camDirty === 0);
  console.log(`# B2(a): strip-arm span=${len} instr, forced NMIs=${forced.length} (not-busy ${notBusy.length}, which must DMA), ${fmt(rec)} st_active=${mem[M.ST_ACTIVE]} armsBefore=${armsBefore}`);
  assert.ok(forced.length >= indices.length, `the strip-arm sweep must land (fired ${forced.length})`);
  for (const n of forced) {
    if (n.busy !== 0 || n.camDirty !== 0) assert.equal(n.dmaAfter, n.dmaBefore, `frame ${n.frame}: a busy/held forced NMI must DMA nothing`);
    else assert.equal(n.dmaAfter - n.dmaBefore, 1, `frame ${n.frame}: an idle forced NMI must DMA the previous complete shadow (the flag must not over-block)`);
  }
  assertNoTear(rec, 'B2(a)');
  assert.equal(mem[M.ST_ACTIVE], 0, 'the strip must have completed');
  assert.equal(mem[M.OAM_BUSY], 0);
});

test('B2(b): an NMI forced at every instruction of the battle sprite rebuild (main_loop_ui -> ui_tick -> battle_tick -> battle_draw_sprites, RPG) DMAs nothing; the next unforced frame DMAs a complete shadow', { skip }, async () => {
  const e = env(await sessionRpg());
  const { rec, mem } = e;
  rec.run(60); tap(e, BTN.START, 2, 30);
  assert.equal(mem[M.GAME_STATE], ST.GAMEPLAY);
  const X = 120, Y = 112;
  walkTo(e, X, Y + 30); rec.run(40);
  assert.equal(mem[M.GAME_STATE], ST.BATTLE, 'walking into the slime should start a fight');
  rec.run(30); // intro settled, sitting in the command menu
  for (let i = 0; i < 6; i++) { rec.force = { entry: 'battle_draw_sprites', index: 1e9 }; rec.spanLen = 0; rec.run(1); }
  rec.force = null;
  const len = rec.spanLen;
  assert.ok(len >= 20, `battle_draw_sprites should be a real span (${len} instructions)`);
  let fired = 0;
  for (let k = 0; k < len; k++) {
    const before = rec.forcedLog.length;
    rec.force = { entry: 'battle_draw_sprites', index: k };
    rec.run(1);
    rec.force = null;
    if (rec.forcedLog.length > before) fired++;
    rec.run(1);
  }
  console.log(`# B2(b): battle_draw_sprites span=${len} instructions, forced NMIs fired=${fired}, ${fmt(rec)}`);
  assert.equal(mem[M.GAME_STATE], ST.BATTLE, 'still in battle');
  assert.ok(fired >= len * 0.9, `the sweep must land (fired ${fired} of ${len})`);
  const forced = rec.nmis.filter((n) => n.forced && n.done);
  for (const n of forced) {
    assert.notEqual(n.busy, 0, `frame ${n.frame}: a battle frame rebuilds the whole shadow inside ui_tick, so oam_busy must already be set there`);
    assert.equal(n.dmaAfter, n.dmaBefore, `frame ${n.frame}: a forced NMI inside the battle rebuild must DMA nothing`);
  }
  assertNoTear(rec, 'B2(b)');
  // NOTE: an idle battle menu rewrites the same bytes every frame, so a half-finished rebuild is byte-identical to a complete
  // one and the content oracle cannot see a tear here (wouldTear is 0 in the log line). The check that bites is the entry
  // assertion above (oam_busy set at every forced NMI, no DMA) -- sabotage 9c (main_loop_ui set omitted) fails exactly it.
  // the resulting DMA (next unforced frame) is a complete shadow that also shows the battle party: exists and is complete
  rec.run(3);
  const last = rec.dmas.at(-1);
  assert.ok(last.inNmi && rec.snaps.has(last.key), 'the next unforced frame DMAs a complete shadow');
});

for (const [name, scene] of [['RPG (banked draw_nameentry_cursor)', sceneNameRpg], ['action (kernel draw_nameentry_cursor)', sceneNameAction]]) {
  test(`B2(c): an NMI forced at every instruction of the naming cursor draw (${name}) DMAs nothing; the resulting DMA is a complete shadow`, { skip }, async () => {
    const e = env(await scene());
    const { rec, mem } = e;
    rec.run(80);
    assert.equal(mem[M.GAME_STATE], ST.NAMEENTRY, 'the hero naming grid should be up');
    for (let i = 0; i < 4; i++) { rec.force = { entry: 'draw_nameentry_cursor', index: 1e9 }; rec.spanLen = 0; rec.run(1); }
    rec.force = null;
    const len = rec.spanLen;
    assert.ok(len >= 10, `the cursor draw should be a real span (${len} instructions)`);
    let fired = 0;
    for (let k = 0; k < len; k++) {
      const before = rec.forcedLog.length;
      rec.force = { entry: 'draw_nameentry_cursor', index: k };
      rec.run(1);
      rec.force = null;
      if (rec.forcedLog.length > before) fired++;
      rec.run(1);
    }
    console.log(`# B2(c) ${name}: cursor span=${len} instructions, forced NMIs fired=${fired}, ${fmt(rec)}`);
    assert.equal(mem[M.GAME_STATE], ST.NAMEENTRY);
    assert.ok(fired >= len * 0.9, `the sweep must land (fired ${fired} of ${len})`);
    for (const n of rec.nmis.filter((x) => x.forced && x.done)) {
      assert.notEqual(n.busy, 0, `frame ${n.frame}: the naming cursor is drawn inside the main-loop draw bracket`);
      assert.equal(n.dmaAfter, n.dmaBefore, `frame ${n.frame}: a forced NMI inside the naming cursor draw must DMA nothing`);
    }
    assertNoTear(rec, 'B2(c)');
    rec.run(3);
    assert.ok(rec.snaps.has(rec.dmas.at(-1).key), 'the next unforced frame DMAs a complete shadow');
  });
}

test('B2(d): an NMI forced inside a streamed dialogue rebuild (open and close; build_oam and draw_entities under the cam_dirty hold) DMAs nothing; the dialogue rebuild snapshots are DMA\'d intact afterwards', { skip }, async () => {
  const e = env(await sceneDialogue());
  const { rec, mem } = e;
  rec.run(60);
  // the second NPC sits on screen (1, 0) at (40, 16): a real camera scroll, so the open really nudges and rebuilds the shadow
  const goto = () => {
    for (let i = 0; i < 600; i++) {
      const b = [];
      if (mem[M.SW_COL] < 1) { b.push(BTN.RIGHT); if (mem[M.PLAYER_Y] > 18) b.push(BTN.UP); } else {
        if (mem[M.PLAYER_X] > 42) b.push(BTN.LEFT); else if (mem[M.PLAYER_X] < 38) b.push(BTN.RIGHT);
        if (mem[M.PLAYER_Y] > 18) b.push(BTN.UP); else if (mem[M.PLAYER_Y] < 14) b.push(BTN.DOWN);
      }
      if (!b.length) break;
      press(e.nes, b); rec.run(1);
    }
    press(e.nes, []); rec.run(5);
  };
  goto();
  const held = () => mem[M.CAM_DIRTY] > 0;
  // span lengths of the two calls inside the rebuild (cond: only walks entered under the cam_dirty hold)
  const spans = {};
  for (const entry of ['build_oam', 'draw_entities']) {
    rec.force = { entry, index: 1e9, cond: held }; rec.spanLen = 0;
    tap(e, BTN.B, 2, 5);
    for (let i = 0; i < 40 && !rec.spanLen; i++) rec.run(1);
    rec.force = null;
    spans[entry] = rec.spanLen;
    // close the box again
    for (let i = 0; i < 12 && mem[M.GAME_STATE] === ST.DIALOG; i++) { tap(e, BTN.B, 2, 40); }
    rec.run(20);
  }
  console.log(`# B2(d): rebuild spans (under cam_dirty): ${JSON.stringify(spans)}`);
  assert.ok(spans.build_oam > 5 && spans.draw_entities > 5, 'the dialogue open must rebuild the shadow under the cam_dirty hold');
  let fired = 0, phases = { open: 0, close: 0 };
  for (const entry of ['build_oam', 'draw_entities']) {
    const len = spans[entry];
    for (const k of [0, 1, Math.floor(len / 3), Math.floor(len / 2), len - 1]) {
      // OPEN
      let before = rec.forcedLog.length;
      rec.force = { entry, index: Math.min(k, len - 1), cond: held };
      press(e.nes, [BTN.B]); rec.run(2); press(e.nes, []); rec.run(3);
      if (rec.forcedLog.length > before) { fired++; phases.open++; }
      rec.force = null;
      assert.equal(mem[M.GAME_STATE], ST.DIALOG, 'the dialogue should be open');
      rec.run(160);
      // CLOSE: arm just before the press that closes it
      before = rec.forcedLog.length;
      rec.force = { entry, index: Math.min(k, len - 1), cond: held };
      for (let i = 0; i < 14 && mem[M.GAME_STATE] === ST.DIALOG; i++) tap(e, BTN.B, 2, 40);
      if (rec.forcedLog.length > before) { fired++; phases.close++; }
      rec.force = null;
      rec.run(20);
    }
  }
  console.log(`# B2(d): forced NMIs fired=${fired} (open ${phases.open}, close ${phases.close}), ${fmt(rec)}`);
  assert.ok(phases.open >= 8, `forced NMIs must land in the open rebuild (${phases.open})`);
  assert.ok(phases.close >= 1, `forced NMIs must land in a close rebuild (${phases.close})`);
  const forced = rec.nmis.filter((n) => n.forced && n.done);
  for (const n of forced) {
    assert.ok(n.camDirty > 0 || n.busy !== 0, `frame ${n.frame}: a forced NMI inside a dialogue rebuild must find the shadow protected (cam_dirty=${n.camDirty} oam_busy=${n.busy})`);
    assert.equal(n.dmaAfter, n.dmaBefore, `frame ${n.frame}: a forced NMI inside a dialogue rebuild must DMA nothing`);
  }
  assertNoTear(rec, 'B2(d)');
  assert.ok(rec.snaps.size > 0 && [...rec.snaps.values()].some((s) => s.has('streamed dialogue rebuild')), 'the dialogue rebuild snapshots were taken');
});

// =====================================================================================================================
// T9c -- the flag is clear everywhere outside the draw span, across scripted sessions
// =====================================================================================================================

function assertSession(e, what, reached) {
  const { rec } = e;
  console.log(`# T9c ${what}: reached [${reached.join(', ')}]; instructions sampled=${rec.spanSamples}; ${fmt(rec)}; landing-only-accepted DMAs=${rec.dmasVia('draw_entities outside the brackets', true).length} manual=${rec.dmas.filter((d) => !d.inNmi).length} dialogue-rebuild-only DMAs=${rec.dmasVia('streamed dialogue rebuild', true).length}`);
  assert.equal(rec.spanViolationCount, 0, `oam_busy must be 0 at every sampled instruction outside [set at main_loop_ui/main_loop_draw .. clear at main_loop_ready]: ${rec.spanViolations.slice(0, 3).join(' | ')}`);
  assert.ok(rec.spanSamples > 500000, `the sampler must have run (${rec.spanSamples} instructions)`);
  assertNoTear(rec, `T9c ${what}`);
  assert.equal(e.mem[M.OAM_BUSY], 0);
}

test('T9c (RPG): title -> start -> walk -> crossing -> battle (win) -> door -> battle (lose) -> game over -> restart -> title -> start; oam_busy is 0 outside the draw span throughout', { skip }, async () => {
  const e = env(await sessionRpg(), { trackSpan: true });
  const { rec, mem } = e;
  const reached = [];
  const X = 120, Y = 112;
  rec.run(60);
  assert.equal(mem[M.GAME_STATE], ST.TITLE); reached.push('title');
  tap(e, BTN.START, 2, 30);
  assert.equal(mem[M.GAME_STATE], ST.GAMEPLAY); assert.equal(mem[M.MAP_IS_STREAMED], 1); reached.push('start');
  // walk + crossing: leave the start screen to the right (a continuous streamed crossing, strips armed), and come back
  const flat0 = mem[FLAT_SCREEN];
  let stripSeen = false;
  press(e.nes, [BTN.RIGHT]); for (let i = 0; i < 260; i++) { rec.run(1); if (mem[M.ST_ACTIVE]) stripSeen = true; } press(e.nes, []);
  const flatMid = mem[FLAT_SCREEN];
  press(e.nes, [BTN.LEFT]); for (let i = 0; i < 260; i++) { rec.run(1); if (mem[M.ST_ACTIVE]) stripSeen = true; } press(e.nes, []);
  reached.push('walk'); if (stripSeen) reached.push('strip'); if (flatMid !== flat0) reached.push('crossing');
  assert.ok(stripSeen, 'a strip must have been armed on the walk');
  assert.equal(mem[FLAT_SCREEN], flat0, 'back on the start screen');
  walkTo(e, X, Y + 30); rec.run(40);
  assert.equal(mem[M.GAME_STATE], ST.BATTLE); reached.push('battle');
  for (let i = 0; i < 60 && mem[M.GAME_STATE] === ST.BATTLE; i++) tap(e, BTN.A, 2, 12);
  assert.equal(mem[M.GAME_STATE], ST.GAMEPLAY); reached.push('battle won');
  // The door: a warp landing rebuilds the shadow under forced blank OUTSIDE both brackets. An NMI that arrives the instant
  // rendering is re-enabled (forced at the landing routine's closing rts) sees oam_busy == 0 and DMAs that rebuilt shadow,
  // which is legitimate and complete -- the oracle must accept it (via the landing snapshot) and it must not be skipped.
  let landingLabels = '';
  const nmiBeforeDoor = rec.nmis.length;
  rec.force = { entry: 'sw_redraw_screen_landing', index: 'last' };
  walkTo(e, X + 60, Y - 38); rec.run(60);
  assert.equal(mem[FLAT_SCREEN], DOOR_TARGET_SCREEN, 'the door should have landed on the target screen'); reached.push('door (warp landing)');
  const landingNmi = rec.nmis.slice(nmiBeforeDoor).find((n) => n.forced && n.done);
  assert.ok(landingNmi, 'the NMI forced at the end of the landing should have fired');
  assert.equal(landingNmi.busy, 0, 'a landing is outside the busy bracket');
  assert.equal(landingNmi.dmaAfter - landingNmi.dmaBefore, 1, 'an NMI right after a landing must DMA the rebuilt shadow (the flag must not freeze it)');
  const landingDma = rec.dmas[landingNmi.dmaBefore];
  // (the landing shadow here is a player-only frame that an earlier main_loop_ready also produced, so the labels also name
  // main_loop_ready; the landing rebuild is nonetheless declared complete at its own draw_entities return, before this NMI)
  assert.ok(landingDma.labels.includes('draw_entities outside the brackets'), `the landing rebuild must have been declared complete before the NMI DMA'd it (declared by: ${landingDma.labels.join(', ')})`);
  landingLabels = landingDma.labels.join(', ');
  walkTo(e, 112, 148); rec.run(40);
  assert.equal(mem[M.GAME_STATE], ST.BATTLE); reached.push('battle 2');
  for (let i = 0; i < 200 && mem[M.GAME_STATE] === ST.BATTLE; i++) tap(e, BTN.A, 2, 12);
  assert.equal(mem[M.GAME_STATE], ST.GAMEOVER); assert.equal(mem[PC_HP], 0); reached.push('game over');
  rec.run(200); tap(e, BTN.START, 2, 20);
  assert.equal(mem[M.GAME_STATE], ST.TITLE); reached.push('restart -> title');
  rec.run(30); tap(e, BTN.START, 2, 40);
  assert.equal(mem[M.GAME_STATE], ST.GAMEPLAY); reached.push('start again');
  rec.run(60);
  reached.push(`NMI right after the door landing DMA'd its rebuilt shadow (declared by: ${landingLabels})`);
  assertSession(e, 'RPG', reached);
  assert.ok(rec.counts.drawRebuilds >= 3, `landings outside the brackets must have been exercised (${rec.counts.drawRebuilds})`);
});

test('T9c (action): title -> start -> walk -> Flash Save (manual resync DMA) -> power cycle -> title -> Continue (Load) -> walk; oam_busy is 0 outside the draw span throughout', { skip }, async () => {
  const e = env(await sessionAction(), { trackSpan: true });
  const { rec, nes } = e;
  const reached = [];
  rec.run(60);
  assert.equal(e.mem[M.GAME_STATE], ST.TITLE); reached.push('title');
  tap(e, BTN.START, 2, 30);
  assert.equal(e.mem[M.GAME_STATE], ST.GAMEPLAY); reached.push('start');
  walkTo(e, 200, 40); reached.push('walk');
  const manualBefore = rec.dmas.filter((d) => !d.inNmi).length;
  tap(e, BTN.B, 2, 90);
  assert.equal(rec.dmas.filter((d) => !d.inNmi).length - manualBefore, 1, 'the Flash Save resync does exactly one manual DMA'); reached.push('Save (manual resync DMA)');
  walkTo(e, 120, 100);
  const px = e.mem[M.PLAYER_X];
  nes.reloadROM(); // power cycle: the flash sector survives
  rec.run(60);
  assert.equal(e.mem[M.GAME_STATE], ST.TITLE); reached.push('power cycle -> title');
  tap(e, BTN.SELECT, 2, 60);
  assert.equal(e.mem[M.GAME_STATE], ST.GAMEPLAY); assert.notEqual(e.mem[M.PLAYER_X], px, 'Continue restored the saved position'); reached.push('Continue (Load)');
  press(nes, [BTN.RIGHT]); rec.run(80); press(nes, []); rec.run(20); reached.push('walk after load');
  assertSession(e, 'action', reached);
  assert.ok(rec.counts.drawRebuilds >= 2, `landings outside the brackets must have been exercised (${rec.counts.drawRebuilds})`);
});

// =====================================================================================================================
// T9d -- the flag exists only in a streaming project
// =====================================================================================================================

/** The highest value $F8 holds at any instruction boundary once boot's RAM clear has run (power-on RAM is garbage). */
function watchBusy(rom, frames = 120) {
  const nes = bootNes(rom);
  let maxBusy = 0;
  const original = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = function watch() { maxBusy = Math.max(maxBusy, nes.cpu.mem[M.OAM_BUSY]); return original(); };
  for (let i = 0; i < 6; i++) nes.frame();
  maxBusy = 0;
  for (let i = 0; i < frames; i++) nes.frame();
  return maxBusy;
}

test('T9d: an ordinary-only project has every oam_busy site zero-size (no bytes, no writes to $F8 at run time); a streaming project has each at its counted size and actually toggles the flag', { skip }, async () => {
  // Every site is bracketed by a pair of unconditional labels (start / *_end); the bytes between them are the site.
  // Counted sizes: set_ui `lda #1 / sta zp` = 4, set_draw = 4, clear `lda #0 / sta zp` = 4, nmi `lda zp / bne` = 4,
  // init_session's `sta zp` = 2.
  const SITES = { oam_busy_set_ui: 4, oam_busy_set_draw: 4, oam_busy_clear: 4, oam_busy_nmi: 4, oam_busy_init: 2 };
  for (const [what, project] of [['ordinary action', createProject('Ordinary', 'action')], ['ordinary rpg', createProject('Ordinary', 'rpg')]]) {
    const built = await buildRom(project);
    for (const k of Object.keys(SITES)) assert.equal(built.code[`${k}_end`] - built.code[k], 0, `${what}: ${k} must emit no bytes`);
    assert.equal(watchBusy(built.rom), 0, `${what}: $F8 is never written`);
  }
  const streamed = await buildRom(createStreamedProject({ gameType: 'action' }));
  for (const [k, size] of Object.entries(SITES)) assert.equal(streamed.code[`${k}_end`] - streamed.code[k], size, `streaming: ${k} must be ${size} bytes`);
  assert.equal(watchBusy(streamed.rom), 1, 'streaming: the flag really is raised during the draw');
});
