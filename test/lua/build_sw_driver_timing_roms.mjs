#!/usr/bin/env node
// Builds ONE streamed-project ROM + generates sw_driver_timing.lua (design-streamed-worlds.md's
// obligation 1, "Driver specification and timing... discharged by: the production driver measured
// in the real engine on UNROM 512 and the frame bound recomputed from it") -- see
// sw_driver_timing.lua.template's own header for the full measurement design.
//
//   node test/lua/build_sw_driver_timing_roms.mjs [outDir]
//     [--break=unconditional-arm|no-spawn|slow-driver|offmap-column|idle-extra-work]
//     [--idle-only] [--no-actors] [--row8] [--row8-drop] [--align-landing-y] [--skip-contact]
//     [--skip-release-fallback] [--skip-shake-flash]
//   Mesen --testRunner <outDir>/sw_driver_timing.lua <outDir>/sw_driver_timing.nes
//
// Fix round 1 (gates round-1, Task 1) workloads, always baked into the ordinary (non---row8/
// --idle-only/--break) build's busy walk -- see each flag's own comment below for the mechanism and
// its workload-drop sabotage counterpart:
//   (a) contact damage    -- placeDamageNpc, --skip-contact
//   (b) 8 actors, row arm -- --row8 (a separate build; see run_sw_driver_timing_check.sh)
//   (c) release-fallback  -- leg 1 holds Right+Down together; --skip-release-fallback
//   (d) unaligned 3-screen entering edge -- observed from win_row_screen/local; negative control is
//       the separate --align-landing-y build
//   (e) Shake/Flash/Sfx sharing a frame with an active strip -- placeShakeFlashActor, --skip-shake-flash
//
// No flags: the real, unbroken engine, run through the two-leg (Right then Down) busy phase, then
// idle -- the main obligation-1 result (missing-workload self-check, workload evidence, the
// expensive-path max the frame bound is recomputed from, the full-mainline-body max the frame
// inequality is recomputed from).
// --idle-only (no --break): the SAME unbroken engine, but through the idle-only harness shape (no
// busy phase, input never held) -- a true apples-to-apples baseline for the extra-cost control
// below, since the ordinary run's own "cheap" frames come from a busy phase that also walks real
// screen crossings, not a scenario that ever stands genuinely idle from boot.
// --break=unconditional-arm: project.code.overrides carries a COPY of engine/streamworld.asm (the
// real repo file is never touched) with sw_win_arm's own comparison chain replaced by an
// unconditional `jmp sw_win_arm_col_inc` -- every single frame pays the real column-arm work
// regardless of st_active or any desired/current match. Always run idle-only (implied) -- the extra-
// cost negative control ruling 4 requires alongside the missing-workload one already in the
// template, compared in the shell script against the plain --idle-only unbroken baseline (both runs
// share the same idle-only harness shape; only the engine code differs).
// --break=no-spawn: project.code.overrides carries a COPY of engine/streamworld.asm with the
// RIGHT-crossing handler's own `jsr spawn_entities` (the real per-crossing respawn call,
// sw_pr_c2/sw_cross_right's own tail) replaced by three NOPs -- fix round 2's own ownership/respawn
// evidence check (ent_active read before/after the Right crossing) must FAIL against this build even
// though sw_col still changes, closing the gap review round 2's own review-s4b-round2-no-spawn.mjs
// investigation found (a crossing that moves sw_col but never actually spawns the new screen's
// entities). Always idle-only is NOT implied here -- the busy phase is exactly what exercises the
// crossing this mode breaks, so this mode forces the ordinary two-leg busy phase regardless of
// --idle-only.
// --no-actors: the SAME grid/landing, but with 0 actors on every screen (instead of the real 8/4
// busy-actor placement below) -- the missing-workload negative control for the NEW full-mainline-
// body metric (fix round 2/ruling M): this build's own mainline max must be markedly cheaper than
// the real 8-actor build's, proving the reported mainline figure is sensitive to real actor AI cost,
// not a phantom number.
// --row8-drop: fix round 2, gates round-2 finding 1's own workload-drop control -- keeps every
// --row8 substitution (EXPECT_RESPAWN_EVIDENCE off, EXPECT_ROW8 on) but forces DOWN_TARGET_ACTORS
// back to 4, so the new row8/workload-(b) assertion (a fresh ROW arm on the Down-target screen with
// all eight ent_active slots occupied) has nothing to observe and must fail with its own dedicated
// exit code -- proving that assertion actually depends on the real eight-actor placement, not just
// on the --row8 flag being set.
// --break=slow-driver: project.code.overrides carries a COPY of engine/streamworld.asm with a
// `ldx #255 / dex / bne` delay loop (~1,276 cycles) inserted at sw_update_player's own entry --
// review round 2's own reproducer (handoff-next/review-s4b-gates-round2-evidence/builder.mjs's
// --review-slow), ported in-tree so the mandatory absolute-regression-ceiling negative control no
// longer depends on a frozen, review-only builder. Always runs the ordinary two-leg busy phase
// (never idle-only), so both EXPENSIVE_CEILING_CYCLES and MAINLINE_CEILING_CYCLES
// (sw_driver_timing.lua.template) see the real inflated cost.
// --break=offmap-column: workload (d)'s own off-map negative control (round-3 gate closure Task 1,
// gates round-3 finding 1) -- project.code.overrides carries a COPY of engine/streamworld.asm with
// a single `lda #255` inserted right after sw_stream_start_col's own label, forcing EVERY column
// strip's saved entering screen column (sw_ss_sc) to 255 -- off the real grid -- through the real
// off-map fill path, not a fabricated Lua read. Always runs the ordinary two-leg busy phase (never
// idle-only). Proves the new bounds check in sw_driver_timing.lua.template (workload (d)) actually
// reads and rejects the real saved entering column, not merely the window's own near-edge column
// (the old WIN_COL_SCREEN read), which stays in-bounds even when the real entering column is
// off-map.
// --break=idle-extra-work: fix round 2 (fix2, finding A4) -- a BOUNDED, stationary-demand extra-work
// cost control, distinct from --break=unconditional-arm. Inserts the SAME fixed ~1,276-cycle delay
// loop --break=slow-driver already uses (ldx #255/dex/bne, at sw_update_player's own entry) but
// always runs through the idle-only harness shape (implied, like unconditional-arm) instead of
// slow-driver's own forced busy walk. Unlike unconditional-arm, this mutation never reads or writes
// sw_col/sw_row/win_col_*/win_row_*/sw_fc_* -- the window's own desired/current origin can never
// drift, so its own idle-only average settles at one fixed extra cost above baseline instead of
// growing without bound, and the position-jump guard must never fire across its whole measured span
// (sw_driver_timing.lua.template's own pjgFireCount assertion, run against every idle-only build,
// unbroken baseline included -- see its own header comment).
//
// (test/lua/run_sw_driver_timing_check.sh runs the unbroken pass and the broken comparisons.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createProject, createMap, createScreen } from '../../shared/project.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/sw_driver_timing.lua.template');

const args = process.argv.slice(2);
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
const KNOWN_BREAKS = ['unconditional-arm', 'no-spawn', 'slow-driver', 'offmap-column', 'idle-extra-work'];
if (breakMode && !KNOWN_BREAKS.includes(breakMode)) {
  throw new Error(`unknown --break mode: ${breakMode}`);
}
const idleOnly = args.includes('--idle-only') || breakMode === 'unconditional-arm' || breakMode === 'idle-extra-work';
const noActors = args.includes('--no-actors');
// Round-3 gate closure Task 1: --skip-down-leg is the workload-drop sabotage demonstration for the
// new sawColCrossing/sawRowCrossing "both strip orientations" assertion (sw_driver_timing.lua.
// template) -- runs leg 1 (Right) in full, then skips leg 2 (Down) entirely, proving the new
// EXIT_NO_ROW_CROSSING check correctly fires when the row-orientation workload is genuinely absent.
const skipDownLeg = args.includes('--skip-down-leg');
// Fix round 1 (gates round-1, Task 1) workload-drop sabotage flags -- each omits exactly one of the
// five required workloads (a-e) so its own new assertion in sw_driver_timing.lua.template can be
// shown, in real Mesen, to fail when that workload is genuinely absent:
//   --skip-contact           workload (a) -- the DOWN_TARGET damage npc becomes a plain chaser
//                             (damage 0), so the player is never actually hit.
//   --skip-release-fallback  workload (c) -- leg 1 holds Right ONLY (the old shape), so the leg1->
//                             leg2 handoff is a fresh Down press (sw_up_axis_newy), never the
//                             release-fallback branch (sw_update_player's own fallback reassignment
//                             at engine/streamworld.asm:3317-3319).
//   --skip-shake-flash       workload (e) -- the RIGHT_TARGET touch actor's Shake/Flash/Sfx event is
//                             dropped (the actor and its 'touch' trigger are removed outright), so
//                             flash_tick never has an authored packet to queue during the walk.
// Workload (b) (eight actors on the row-arm target) and (d) (the unaligned three-screen entering
// edge) are measured, not toggled -- --row8 below is an ADDITIONAL build variant for (b), not a
// sabotage flag, since dropping either shape entirely still leaves a real (if smaller/aligned)
// column/row arm to observe; their own sabotage coverage is a separate, geometry-based negative
// build (see run_sw_driver_timing_check.sh's own --align-landing-y invocation for (d)).
const skipContact = args.includes('--skip-contact');
const skipReleaseFallback = args.includes('--skip-release-fallback');
const skipShakeFlash = args.includes('--skip-shake-flash');
// --row8: workload (b) -- the row-arm (Down) target carries 8 total entities (7 real chasers plus
// the workload (a) damage npc) instead of the default 4 (3 chasers plus the npc), matching the
// column-arm (Right) target's own MAX_ENTITIES=8 ceiling on BOTH orientations. Forces
// EXPECT_RESPAWN_EVIDENCE off (see below): with both targets at 8, the ent_active SUM before and
// after a crossing can coincide even on a genuine respawn (8 different actors summing to the same
// 8), so this build cannot re-prove respawn evidence itself -- the default (4-actor) build already
// does, per the brief's own "use a separate build for that control rather than shrinking this one".
// --row8-drop: workload (b)'s own drop control (fix round 2, finding 1) -- see the header comment
// for the full mechanism. Implies --row8 (same EXPECT_RESPAWN_EVIDENCE/EXPECT_ROW8 substitutions)
// but is handled separately below so DOWN_TARGET_ACTORS stays at 4 regardless.
const row8Drop = args.includes('--row8-drop');
const row8 = args.includes('--row8') || row8Drop;
// --align-landing-y: workload (d)'s own negative control -- passed through to the .lua.template as
// ALIGN_LANDING_Y, which skips the pre_down phase (no real Down hold before leg 1). win_row_local
// then stays at its landing value of 0 (engine/streamworld.asm:2628-2636), so the column arm's
// vertical entering edge starts exactly on a screen-row boundary and spans exactly two screens
// instead of three. Proves the new EXIT_NO_UNALIGNED_3SCREEN check correctly fires when the
// geometry genuinely does not straddle a third screen, rather than always passing by construction.
const alignLandingY = args.includes('--align-landing-y');
const reportArg = args.find((a) => a.startsWith('--report='));
const reportMetric = reportArg ? reportArg.slice('--report='.length) : 'expensive';
// R4: the nmi-extrapolated report mode is removed -- it extrapolated a single organic run's own
// (vram_len, cycles) samples to a cited worst-case queue depth instead of measuring a real mixed-
// queue frame, and the orchestrator ruled it must not be replaced with another extrapolation.
// nmi-max-len stays: it reports the largest vram_len this run actually observed, a real measurement.
const VALID_REPORT_METRICS = ['cheap', 'expensive', 'mainline', 'nmi', 'nmi-max-len'];
if (!VALID_REPORT_METRICS.includes(reportMetric)) {
  throw new Error(`unknown --report metric: ${reportMetric}`);
}
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sw-driver-timing';

// Fix round 2 (finding D/ruling M): the review round 2 finding was specific and demonstrated --
// review-s4b-round2-high.mjs proved the OLD 12x2 grid (landing (5,0)) undermeasured the real worst
// case because a small grid never lets 8-bit signed world coordinates and the region-packed PRG
// layout (61 8 KB regions on UNROM 512, ~1 region per grid ROW regardless of width -- see this
// slice's own empirical finding while writing the ruling-N tests) exercise their own high-byte
// paths. 3 wide x 61 tall (the packing ceiling itself) landing at (1,58) -- an interior column, two
// rows from the tall edge -- is the legal worst-case shape this obligation's own text calls for
// ("a legal 3x61-region map landing at (1,58)"), folded into the real builder rather than kept as a
// separate prototype script.
const GRID_W = 3;
const GRID_H = 61;
const LANDING_COL = 1;
const LANDING_ROW = 58;
const screenIndex = (col, row) => row * GRID_W + col;
const LANDING_SCREEN_INDEX = screenIndex(LANDING_COL, LANDING_ROW);
// The Right-leg's landing screen -- MAX_ENTITIES=8 real chasers with contact damage, the same
// canonical "busiest legal" shape design-streamed-worlds.md's own §5.2413 entry and
// proto-tools/diag_f18_busy_frame.mjs already established for the ordinary (non-streamed) engine's
// own worst mainline body -- reused here rather than inventing a second worst-case definition. The
// LANDING screen itself carries 0 actors (see below) so ent_active reads a clean 0-before/N-after
// transition on the crossing that first reaches this screen -- real ownership/respawn evidence, not
// merely sw_col changing.
const RIGHT_TARGET_COL = LANDING_COL + 1;
const RIGHT_TARGET_ROW = LANDING_ROW;
const RIGHT_TARGET_INDEX = screenIndex(RIGHT_TARGET_COL, RIGHT_TARGET_ROW);
const RIGHT_TARGET_ACTORS = 8;
// The Down-leg's landing screen (reached from the Right-target screen) -- a DIFFERENT actor count
// (4, not 8) so its own ent_active transition (8 -> 4) is unambiguous evidence of a real respawn on
// the SECOND (row-orientation) crossing too, distinct from merely "the count happens to match again
// by coincidence". Still real, busy chasers -- covers "unaligned strip fetches in both orientations"
// (ruling M) with genuine per-frame AI workload on both legs of the walk, not a synthetic probe.
const DOWN_TARGET_COL = RIGHT_TARGET_COL;
const DOWN_TARGET_ROW = LANDING_ROW + 1;
const DOWN_TARGET_INDEX = screenIndex(DOWN_TARGET_COL, DOWN_TARGET_ROW);
// Workload (b): --row8 raises this to 8 (matching RIGHT_TARGET_ACTORS), the real worst-case
// MAX_ENTITIES ceiling on the row axis too, not just the column axis. One of the slots is always
// the workload (a) damage npc (placeDamageNpc below), so the chaser count itself is one less than
// this total.
const DOWN_TARGET_ACTORS = (row8 && !row8Drop) ? 8 : 4;
// Fix round 1 (gates round-1, Task 1) workload (d)'s own pre-phase: a real row crossing is the only
// thing observed to move win_row_local off its landing-reset value of 0 (empirically confirmed --
// see the .lua.template's own PRE_DOWN_FRAMES comment); holding Down within a single screen, short
// of a crossing, left it at 0 through 80+ real frames. Rather than let that crossing happen ad hoc
// (which would land the player on LANDING_ROW at an unpredictable Y, disturbing leg 1/leg 2's own
// established geometry -- RIGHT_TARGET_ROW/DOWN_TARGET_ROW are both defined off LANDING_ROW), the
// ordinary (non---align-landing-y) build instead STARTS one row further north and lets the pre_down
// phase's own crossing land the player back on LANDING_ROW -- the exact screen leg 1 already expects
// -- before any busy phase begins. --align-landing-y's own negative control starts directly on
// LANDING_ROW (skipping pre_down and this whole extra row), so it never crosses at all.
const PRE_LANDING_ROW = LANDING_ROW - 1;
const PRE_LANDING_SCREEN_INDEX = screenIndex(LANDING_COL, PRE_LANDING_ROW);

const project = createProject('Streamed Driver Timing Check', 'action');
project.cartridge.mapper = 30; // UNROM 512 -- the only streamed-capable board, and the board
project.cartridge.mirroring = 'fourscreen'; // obligation 1 itself names ("measured... on UNROM 512")
project.cartridge.camera = true;
// Workload (e): one Sfx asset for the touch-triggered event's own 'sfx' command to reference.
project.sfx.push({ name: 'Blip', volume: 15, steps: [{ note: 8, duration: 4 }] });

const map = createMap(0, 'Streamed');
map.gridW = GRID_W;
map.gridH = GRID_H;
map.streamed = true;
map.tilesetId = 0;
map.screens = Array.from({ length: GRID_W * GRID_H }, () => createScreen());
project.maps = [map];
project.project.startMap = 0;
project.project.startScreen = alignLandingY ? LANDING_SCREEN_INDEX : PRE_LANDING_SCREEN_INDEX;
project.project.startX = 120;
// Phase 2 slice "landing" (engine/streamworld.asm:2627-2648) replaced the old "landing always sets
// win_col_local/win_row_local to 0" behaviour with sw_camera_window_install's real, player-centred
// clamp/centre computation (sw_camera_window_recompute) -- so win_row_local at a landing now
// depends on startY in general, and is 0 only at whichever startY happens to be that formula's own
// fixed point for this screen. --align-landing-y's whole point is a landing that is ALREADY
// screen-aligned on the row axis (no pre_down misalignment needed), so it needs that fixed-point
// startY specifically, not a plain sane value: computed here (not hand-picked) by re-deriving the
// same clamp/centre/window formula test/unit/streamworldmove.test.js's own predictDesiredWindow and
// build_sw_render_roms.mjs's own computeWindow use (independent re-transcriptions, not imported),
// and searching the legal startY range for the one row.local===0 solution, asserted below rather
// than merely assumed.
function clampWindowAxis(desiredScreen, desiredLocal, gridSize) {
  const maxScreen = gridSize - 2;
  if (desiredScreen > maxScreen || (desiredScreen === maxScreen && desiredLocal !== 0)) {
    return { screen: maxScreen, local: 0 };
  }
  return { screen: desiredScreen, local: desiredLocal };
}
function computeWindowRow({ swRow, playerY, gridH }) {
  const worldY = swRow * 240 + playerY;
  const camPy = Math.min(Math.max(worldY - 112, 0), (gridH - 1) * 240);
  const camScreenRow = Math.floor(camPy / 240);
  const camLocalPxY = camPy % 240;
  const camBlockY = camScreenRow * 15 + Math.floor(camLocalPxY / 16);
  const desiredBlockY = Math.max(camBlockY - 7, 0);
  return clampWindowAxis(Math.floor(desiredBlockY / 15), desiredBlockY % 15, gridH);
}
// player_y's own legal range is [0, MAX_Y] (engine/constants.asm's MAX_Y=224, 240-16) -- see
// MAX_Y's own use in test/unit/streamworldmove.test.js's landing-case table.
const MAX_Y = 224;
let alignLandingYStartY = null;
for (let y = 0; y <= MAX_Y; y++) {
  if (computeWindowRow({ swRow: LANDING_ROW, playerY: y, gridH: GRID_H }).local === 0) {
    alignLandingYStartY = y;
    break;
  }
}
if (alignLandingYStartY === null) {
  throw new Error('--align-landing-y: no startY in [0, MAX_Y] lands with win_row_local === 0');
}
// The non---align-landing-y build keeps the old plain startY=120: its own alignment comes from a
// real pre_down crossing (below), not from landing itself, so it has no fixed-point requirement.
project.project.startY = alignLandingY ? alignLandingYStartY : 120;

function placeChasers(screenIdx, count, offset = 0) {
  if (noActors || count <= 0) return;
  const screen = map.screens[screenIdx];
  screen.entities = screen.entities ?? [];
  for (let i = 0; i < count; i++) {
    const actorId = project.sprites.actors.length;
    // damage: 0 -- a real 'chaser' still runs its own per-frame pursuit AI every frame it is
    // active (the actual busy cost this fixture needs), but MAX_HEARTS is clamped [1,6]
    // (shared/project.js) and this harness holds input for hundreds of frames right next to a
    // pack of MAX_ENTITIES=8 chasers -- real contact damage killed the player and sent
    // update_player down player_died's own reset/respawn cascade well before the measurement
    // window finished (confirmed empirically, first attempt), a large one-off cost spike
    // unrelated to what this fixture is trying to measure. Suppressing damage keeps the AI real
    // and busy without that confound; disclosed as a deviation from design-streamed-worlds.md's
    // own canonical "8 chasers WITH contact damage" ordinary-engine shape.
    project.sprites.actors.push({ name: `Chaser${screenIdx}_${i}`, behavior: 'chaser', hp: 1, damage: 0 });
    const slot = offset + i;
    screen.entities.push({ actorId, x: 20 + (slot % 4) * 40, y: 20 + Math.floor(slot / 4) * 40, props: { trigger: 'interact' } });
  }
}

// Workload (a): a single STATIONARY ('npc', never chases -- unlike the pursuit AI above, its
// position is deterministic) damage actor on the DOWN_TARGET screen, placed directly in the
// walking corridor (fixed X, matching where leg 1's own rightward walk leaves the player; a Y a
// short way into the screen, well inside leg 2's own remaining travel budget after the row
// crossing) so the busy walk provably touches it exactly once. damage:3 (nonzero, unlike the
// chasers above) is what makes entity_contact (engine/combat.asm) actually call hurt_player.
// --skip-contact turns it into a fourth ordinary chaser (damage 0) instead -- same position, same
// slot count, but never hits the player, proving the new EXIT_NO_CONTACT_DAMAGE check depends on a
// real hit, not merely on the actor's presence.
function placeDamageNpc(screenIdx) {
  if (noActors) return;
  const screen = map.screens[screenIdx];
  screen.entities = screen.entities ?? [];
  const actorId = project.sprites.actors.length;
  // damage: 1, not MAX_HEARTS's own default of 3 -- a hit that KILLS the player takes the
  // catastrophic path immediately: hurt_player (engine/combat.asm) sets player_iframes=IFRAME_TIME,
  // but lose_hearts then drains player_hp to 0 in that same call and player_died zeroes
  // player_iframes right back to 0 before this frame ends (confirmed via a real Mesen debug probe:
  // damage=3 exactly matched the default MAX_HEARTS=3, game_state read ST_GAMEOVER a few frames
  // later, and player_iframes' own 0->60 transition never survived to be observed) -- the same
  // "real contact damage killed the player" confound placeChasers' own damage:0 already disclaims
  // for the chasers, but workload (a) needs a REAL, SURVIVABLE hit, not a lethal one.
  project.sprites.actors.push({
    name: 'DamageNpc', behavior: 'npc', hp: 1, damage: skipContact ? 0 : 1
  });
  // x=234 -- empirically confirmed (fix round 1 debug probe) to match the player's own clamped X
  // (242, screen-local) once leg 1's rightward walk hits the map's own right edge (RIGHT_TARGET is
  // the last column, GRID_W-1) and leg 2 continues down at that fixed X -- not the corridor's own
  // midpoint X, which the pre-fix placement (x=108) wrongly assumed.
  screen.entities.push({ actorId, x: 234, y: 40, props: { trigger: 'interact' } });
}

// RIGHT_TARGET_ACTORS is the real MAX_ENTITIES=8 ceiling; the workload (e) actor below takes one of
// those 8 slots (7 chasers + 1 shake/flash npc), same pattern as DOWN_TARGET's damage npc.
placeChasers(RIGHT_TARGET_INDEX, Math.max(0, RIGHT_TARGET_ACTORS - 1));
placeChasers(DOWN_TARGET_INDEX, Math.max(0, DOWN_TARGET_ACTORS - 1));
placeDamageNpc(DOWN_TARGET_INDEX);

// Workload (e): a 'touch'-triggered Shake+Flash+Sfx event on RIGHT_TARGET, positioned right at the
// entry corridor (a few pixels past the screen's own left edge, matching cross_right's own landing
// X) so it fires within the first few frames after the Right crossing -- while the column strip
// that same crossing just armed is still very likely draining (st_active nonzero). A real flash_
// tick vram_buf packet (CLAUDE.md's single-writer section: "flip_tick, flash_tick and one frozen-
// world tick are the three producers that can share a frame") sharing a frame with a real active
// strip, not an assumption that streaming itself ever touches vram_buf (engine/streamworld.asm's
// own sw_ns_draw_block does not -- confirmed by reading it: no vram_buf/vram_len write anywhere in
// that routine). --skip-shake-flash removes this actor's event (and its 'touch' trigger) entirely,
// leaving a plain non-interactive chaser in its place -- proves the new EXIT_NO_VRAM_STRIP_
// COOCCURRENCE check actually depends on the authored packet, not on incidental crossing
// bookkeeping alone.
//
// y=15, not the busy walk's own startY=120: fix round 1's own pre_down phase (added this round for
// workload (d)) crosses PRE_LANDING_ROW->LANDING_ROW by holding Down alone before leg 1 begins, and
// a genuine row crossing resets the player's local Y the same way landing itself does (win_row_
// local's own reset, engine/streamworld.asm:2628-2636) -- confirmed via a real Mesen probe (read
// player_y $11) both at the pre_down->busy_right handoff and again at the end of leg 1: stable at
// 15 across the whole walk (leg 1 is pure-X, per workload (c)'s own comment above). The npc must
// sit at the Y leg 1 ACTUALLY walks at, not the pre-pre_down startY the walk used to hold.
function placeShakeFlashActor(screenIdx) {
  if (noActors) return;
  const screen = map.screens[screenIdx];
  screen.entities = screen.entities ?? [];
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'ShakeFlashNpc', behavior: skipShakeFlash ? 'chaser' : 'npc', hp: 1, damage: 0 });
  const props = skipShakeFlash
    ? { trigger: 'interact' }
    : {
        trigger: 'touch',
        event: {
          pages: [{
            cond: { type: 'none', arg: 0 },
            commands: [{ op: 'shake', frames: 10 }, { op: 'flash' }, { op: 'sfx', sfx: 0 }]
          }]
        }
      };
  screen.entities.push({ actorId, x: 12, y: 15, props });
}
placeShakeFlashActor(RIGHT_TARGET_INDEX);

if (breakMode === 'unconditional-arm' || breakMode === 'no-spawn' || breakMode === 'slow-driver' || breakMode === 'offmap-column' || breakMode === 'idle-extra-work') {
  const stockPath = path.join(ROOT, 'engine', 'streamworld.asm');
  const stockText = fs.readFileSync(stockPath, 'utf8');
  let patched;
  if (breakMode === 'slow-driver') {
    // review round 2's own reproducer (review-s4b-gates-round2-evidence/builder.mjs's
    // --review-slow), ported verbatim: a real ~1,276-cycle delay loop at sw_update_player's own
    // entry, every frame.
    const needle = 'sw_update_player:\n';
    if (!stockText.includes(needle)) {
      throw new Error('sw_update_player\'s own label text did not match the expected shape -- engine/streamworld.asm has changed since this override was written; update the needle');
    }
    patched = stockText.replace(needle, needle + '  ldx #255\nreview_slow_loop:\n  dex\n  bne review_slow_loop\n');
  } else if (breakMode === 'idle-extra-work') {
    // Fix round 2 (fix2, finding A4): the SAME fixed delay loop as slow-driver, at the same
    // entry point -- deliberately reused rather than invented fresh, since the point of this
    // control is a KNOWN, already-measured fixed cost (~1,276 cycles), not a new unmeasured one --
    // but this mutation is always run idle-only (see idleOnly above), and never touches window
    // state, so its own idle-only average is a bounded, non-drifting regression signal.
    const needle = 'sw_update_player:\n';
    if (!stockText.includes(needle)) {
      throw new Error('sw_update_player\'s own label text did not match the expected shape -- engine/streamworld.asm has changed since this override was written; update the needle');
    }
    patched = stockText.replace(needle, needle + '  ldx #255\nidle_extra_work_loop:\n  dex\n  bne idle_extra_work_loop\n');
  } else if (breakMode === 'unconditional-arm') {
    const needle =
      'sw_win_arm:\n' +
      '  lda win_col_screen\n' +
      '  cmp sw_fc_desc\n' +
      '  bne sw_win_arm_col_try\n' +
      '  lda win_col_local\n' +
      '  cmp sw_fc_desl\n' +
      '  beq sw_win_arm_row\n' +
      'sw_win_arm_col_try:\n' +
      '  lda st_active\n' +
      '  bne sw_win_arm_row\n';
    if (!stockText.includes(needle)) {
      throw new Error('sw_win_arm\'s own comparison chain text did not match the expected shape -- engine/streamworld.asm has changed since this override was written; update the needle');
    }
    // Fix round 1 (finding 4): tried two bounded redesigns of this mutation
    // itself (an inc-then-immediate-dec that re-invoked sw_stream_start_col
    // twice per frame, and a local-only cycle that never touched
    // win_col_screen at all) before settling on leaving the mutation as-is.
    // Both hung the ROM outright (Lua exit 99, TIMEOUT) rather than merely
    // mismeasuring: sw_stream_start_col leaves its own streaming-strip state
    // (sw_ss_sc/st_ftile/st_fnt/st_vary and friends) mid-transaction for a
    // later per-frame pump to drain, and something downstream waits on that
    // transaction completing in the shape the real engine always gives it
    // (one arm step per frame, always progressing) -- neither redesign
    // preserved that shape closely enough to avoid stalling it, and a coder
    // sabotaging engine/streamworld.asm's own state machine to chase a test
    // harness's encoding range is a materially riskier change than fixing
    // the harness. The real defect this control exists to catch (an
    // unconditionally-armed engine) is unbounded by construction -- forced
    // every frame with no gate, current drifts off the authored grid
    // entirely and stays getting worse, so there is no bounded "steady
    // state" cost to design toward that remains a faithful reproduction of
    // an unconditional arm. See sw_driver_timing.lua.template's own
    // IDLE_AVG_SCALE comment for the actual fix: widen the encoding instead
    // of bounding the defect.
    patched = stockText.replace(needle, 'sw_win_arm:\n  jmp sw_win_arm_col_inc\nsw_win_arm_col_try:\n');
  } else if (breakMode === 'offmap-column') {
    // Round-3 gate closure Task 1 (gates round-3 finding 1): forces the entering column
    // sw_stream_start_col saves (sw_ss_sc) to 255 -- off the real grid -- through the real
    // off-map fill path, so workload (d)'s bounds check must reject it.
    const needle = 'sw_stream_start_col:\n';
    if (!stockText.includes(needle)) {
      throw new Error('sw_stream_start_col\'s own label text did not match the expected shape -- engine/streamworld.asm has changed since this override was written; update the needle');
    }
    patched = stockText.replace(needle, needle + '  lda #255\n');
  } else {
    // no-spawn: the Right-crossing handler's own tail (sw_pr_c2, near sw_cross_right) --
    // review-s4b-round2-no-spawn.mjs's own reproducer, folded into the real builder.
    const needle = '  jsr sw_cross_right\n  jsr sw_locate_current\n  jsr spawn_entities\n';
    if (!stockText.includes(needle)) {
      throw new Error('the Right-crossing handler\'s own call sequence did not match the expected shape -- engine/streamworld.asm has changed since this override was written; update the needle');
    }
    patched = stockText.replace(needle, '  jsr sw_cross_right\n  jsr sw_locate_current\n  nop\n  nop\n  nop\n');
  }
  project.code = { overrides: [{ name: 'streamworld.asm', text: patched }], files: [] };
}

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-driver-timing-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const romBytes = Buffer.from(await fs.promises.readFile(built.romPath));

    const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
    const codeSymbols = parseSymbolFile(symbolsText);
    // 'nmi'/'nmi_rti' (engine/boot.asm:430/701) -- round-3 gate closure Task 1: a real NMI-span
    // measurement (nmi entry to nmi_rti exit) during THIS SAME busy walk, instead of the old
    // hardcoded jsnes WORST_NMI_CYCLES=1543. Already-established anchors (flash_nmi_timing.lua.
    // template resolves nmi_rti the same way for its own two-producer-NMI deadline check).
    for (const name of ['update_player', 'update_entities', 'main_loop_after_player', 'main_loop_body_start', 'main_loop_ready', 'nmi', 'nmi_rti', 'sw_position_jump_guard']) {
      if (!Number.isFinite(codeSymbols[name])) throw new Error(`${name} was not a named symbol in game.fns`);
    }

    const constantsText = await fs.promises.readFile(path.join(dir, 'build', 'constants.asm'), 'utf8');
    const configText = await fs.promises.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
    const pending = new Map();
    scanEquates(constantsText, pending);
    scanEquates(configText, pending);
    const ramSymbols = new Map();
    resolveEquates(pending, ramSymbols);
    // 'vram_len' (engine/constants.asm:97) -- the queue depth at nmi entry, read alongside the new
    // NMI span so a real measured (bytes, cycles) sample table can be built for Task 1's own
    // per-byte extrapolation, rather than assuming an instruction-level cycle count by hand.
    // Fix round 1 additions: win_row_screen/win_row_local (workload d's own entering-edge span),
    // player_iframes + IFRAME_TIME (workload a's own hit evidence), pad/pad_new/sw_axis_pref +
    // BTN_UP/BTN_DOWN/BTN_LEFT/BTN_RIGHT (workload c's own release-fallback evidence).
    const RAM_NAMES = [
      'game_state', 'ST_GAMEPLAY', 'map_is_streamed', 'sw_col', 'sw_row', 'st_active', 'ent_active',
      'vram_len', 'win_row_screen', 'win_row_local',
      'player_iframes', 'IFRAME_TIME', 'pad', 'pad_new', 'sw_axis_pref',
      'BTN_UP', 'BTN_DOWN', 'BTN_LEFT', 'BTN_RIGHT',
      // Fix round 2 (gates round-2, finding 2): vram_ready + MIXED_VBLANK_MAX_BYTES -- workload
      // (e)'s own strengthened mixed-vblank co-occurrence check anchors on the SAME preconditions
      // engine/boot.asm's nmi_vram_dispatch reduced-streaming branch (~490) actually tests, instead
      // of the weaker vram_len>0 alone.
      'vram_ready', 'MIXED_VBLANK_MAX_BYTES',
      // Round-3 gate closure Task 1 (gates round-3 finding 1): sw_ss_sc -- the actual saved
      // entering screen column sw_stream_start_col writes (engine/streamworld.asm:1571), which
      // workload (d)'s bounds check now reads instead of the window's own near-edge win_col_screen.
      'sw_ss_sc'
    ];
    for (const name of RAM_NAMES) {
      if (!ramSymbols.has(name)) throw new Error(`${name} did not resolve out of this build's own constants.asm/config.inc`);
    }

    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'sw_driver_timing.nes');
    await fs.promises.writeFile(romPath, romBytes);

    const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    const substitutions = {
      __UPDATE_PLAYER__: `0x${codeSymbols.update_player.toString(16)}`,
      __MAIN_LOOP_AFTER_PLAYER__: `0x${codeSymbols.main_loop_after_player.toString(16)}`,
      __MAIN_LOOP_BODY_START__: `0x${codeSymbols.main_loop_body_start.toString(16)}`,
      __MAIN_LOOP_READY__: `0x${codeSymbols.main_loop_ready.toString(16)}`,
      __GAME_STATE__: `0x${ramSymbols.get('game_state').toString(16)}`,
      __ST_GAMEPLAY__: `${ramSymbols.get('ST_GAMEPLAY')}`,
      __MAP_IS_STREAMED__: `0x${ramSymbols.get('map_is_streamed').toString(16)}`,
      __SW_COL__: `0x${ramSymbols.get('sw_col').toString(16)}`,
      __SW_ROW__: `0x${ramSymbols.get('sw_row').toString(16)}`,
      __ST_ACTIVE__: `0x${ramSymbols.get('st_active').toString(16)}`,
      __ENT_ACTIVE__: `0x${ramSymbols.get('ent_active').toString(16)}`,
      __NMI__: `0x${codeSymbols.nmi.toString(16)}`,
      __NMI_RTI__: `0x${codeSymbols.nmi_rti.toString(16)}`,
      __SW_POSITION_JUMP_GUARD__: `0x${codeSymbols.sw_position_jump_guard.toString(16)}`,
      __VRAM_LEN__: `0x${ramSymbols.get('vram_len').toString(16)}`,
      __WIN_ROW_SCREEN__: `0x${ramSymbols.get('win_row_screen').toString(16)}`,
      __WIN_ROW_LOCAL__: `0x${ramSymbols.get('win_row_local').toString(16)}`,
      __SW_SS_SC__: `0x${ramSymbols.get('sw_ss_sc').toString(16)}`,
      __VRAM_READY__: `0x${ramSymbols.get('vram_ready').toString(16)}`,
      __MIXED_VBLANK_MAX_BYTES__: `${ramSymbols.get('MIXED_VBLANK_MAX_BYTES')}`,
      __GRID_W__: `${GRID_W}`,
      __GRID_H__: `${GRID_H}`,
      __DOWN_TARGET_COL__: `${DOWN_TARGET_COL}`,
      __DOWN_TARGET_ROW__: `${DOWN_TARGET_ROW}`,
      __EXPECT_ROW8__: row8 ? 'true' : 'false',
      // Fix round 2 (fix2, finding A4): true for every idle-only build except --break=
      // unconditional-arm, whose own drift is expected, eventually, to retrigger the guard.
      __EXPECT_GUARD_SILENCE__: (idleOnly && breakMode !== 'unconditional-arm') ? 'true' : 'false',
      __PLAYER_IFRAMES__: `0x${ramSymbols.get('player_iframes').toString(16)}`,
      __IFRAME_TIME__: `${ramSymbols.get('IFRAME_TIME')}`,
      __PAD__: `0x${ramSymbols.get('pad').toString(16)}`,
      __PAD_NEW__: `0x${ramSymbols.get('pad_new').toString(16)}`,
      __SW_AXIS_PREF__: `0x${ramSymbols.get('sw_axis_pref').toString(16)}`,
      __BTN_UP__: `${ramSymbols.get('BTN_UP')}`,
      __BTN_DOWN__: `${ramSymbols.get('BTN_DOWN')}`,
      __BTN_LEFT__: `${ramSymbols.get('BTN_LEFT')}`,
      __BTN_RIGHT__: `${ramSymbols.get('BTN_RIGHT')}`,
      __IDLE_ONLY__: idleOnly ? 'true' : 'false',
      __SKIP_DOWN_LEG__: skipDownLeg ? 'true' : 'false',
      __SKIP_RELEASE_FALLBACK__: skipReleaseFallback ? 'true' : 'false',
      __ALIGN_LANDING_Y__: alignLandingY ? 'true' : 'false',
      __EXPECT_RESPAWN_EVIDENCE__: (noActors || row8) ? 'false' : 'true',
      // Workloads (a) and (e) both need a real placed actor (the damage npc / the shake-flash
      // npc); --no-actors places neither, so their own checks would otherwise false-fire on a
      // build that never claimed to carry them.
      __EXPECT_ACTOR_WORKLOADS__: noActors ? 'false' : 'true',
      __REPORT_METRIC__: reportMetric
    };
    let generated = template;
    for (const [token, value] of Object.entries(substitutions)) {
      const occurrences = generated.split(token).length - 1;
      if (occurrences !== 1) {
        throw new Error(`expected exactly one occurrence of ${token} in the template, found ${occurrences}`);
      }
      generated = generated.split(token).join(value);
    }
    const luaPath = path.join(outDir, 'sw_driver_timing.lua');
    await fs.promises.writeFile(luaPath, generated, 'utf8');

    console.log(`built -> ${romPath} (${romBytes.length} bytes)${breakMode ? ` BROKEN(${breakMode})` : ''}${idleOnly ? ' idle-only' : ''}${noActors ? ' no-actors' : ''}${row8 ? ' row8' : ''}${row8Drop ? ' row8-drop' : ''}${alignLandingY ? ' align-landing-y' : ''}${skipContact ? ' skip-contact' : ''}${skipReleaseFallback ? ' skip-release-fallback' : ''}${skipShakeFlash ? ' skip-shake-flash' : ''}, lua -> ${luaPath}`);
    console.log(`landing: screen(${LANDING_COL},${LANDING_ROW}) index ${LANDING_SCREEN_INDEX}, start screen index ${project.project.startScreen}, grid ${GRID_W}x${GRID_H}, startY=${project.project.startY}`);
    console.log(`right target: screen(${RIGHT_TARGET_COL},${RIGHT_TARGET_ROW}) index ${RIGHT_TARGET_INDEX} actors=${noActors ? 0 : RIGHT_TARGET_ACTORS}`);
    console.log(`down target: screen(${DOWN_TARGET_COL},${DOWN_TARGET_ROW}) index ${DOWN_TARGET_INDEX} actors=${noActors ? 0 : DOWN_TARGET_ACTORS}`);
    console.log(`update_player=0x${codeSymbols.update_player.toString(16)} main_loop_body_start=0x${codeSymbols.main_loop_body_start.toString(16)} main_loop_after_player=0x${codeSymbols.main_loop_after_player.toString(16)} update_entities=0x${codeSymbols.update_entities.toString(16)}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main();
