#!/usr/bin/env node
// Repro for a defect found while building the battle-return scene (coverage campaign), NOT caused by the ring prototype: at 9abc85c, a touch encounter
// started by a monster in entity slot >= 5 never left BP_INTRO (bt_phase 0, bt_count 0). Slots 0-4 entered the menu (phase 1). Reproduced on a
// 5x5 streamed RPG project and on the ordinary map of a mixed one; the build under test is the working tree's own engine (no patch applied here).
// FIXED by 5138c1f (battle_begin uses Y so update_entities gets its slot back in X; the entity pass ends once game_state leaves ST_GAMEPLAY, so the
// FIRST contact wins): this is a regression guard for both halves. A pass is the END state of EVERY encounter, each tied to its own entry:
//   - the encounter is FRESH: a game_state change ST_GAMEPLAY -> ST_BATTLE witnessed on a frame, with bt_from_ent captured on that frame and equal
//     to the slot the fixture says must make contact (a timeout with no new encounter is a failure, never a result);
//   - the intro finishes (bt_phase reaches BP_MENU) and bt_from_ent never changes while the battle is up;
//   - the battle returns: game_state ST_GAMEPLAY and bt_phase BP_DONE, bt_from_ent still that slot, on the first frame the state leaves ST_BATTLE.
// Two fixtures per mode: EIGHT contacts, one per slot 0-7, in order (the ordinary map's monsters are spaced 24 px so all eight lie within MAX_Y), and an
// OVERLAP: slots 2 and 5 stand on the same spot, so both touch on the same frame and slot 2, the first, must win -- no encounter may begin over it.
// After slot 2's fight returns, slot 5 (still touching) is entitled to its own, which must also be fresh and complete; then the run ends.
//   node test/lua/ring_gate/repro_battle_slot5.mjs [streamed|ordinary] [last-y=<n>]
//   exit 0 only on the last line "all 8 fights (slots 0-7) and the overlap (slot 2 first, then 5) each fresh, fought out and returned to gameplay";
//   exit 1 otherwise. `last-y=<n>` moves the eighth monster (negative control: 236 on the ordinary map puts it beyond MAX_Y, so it never touches).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveProject } from '../../../main/project-io.js';
import { buildProject } from '../../../main/build/pipeline.js';
import { createStreamedProject } from '../../lib/streamedproject.js';
import NES from '../../../renderer/emulator/core/nes.js';

const mode = process.argv[2] ?? 'streamed';
const lastY = Number((process.argv.find((a) => a.startsWith('last-y=')) ?? '').slice(7)) || null;
const GAME_STATE = 0x25, BT_PHASE = 0x53, BT_FROM_ENT = 0x68; // engine/constants.asm
const ST_GAMEPLAY = 0, ST_BATTLE = 5, BP_MENU = 1, BP_DONE = 11, BTN_A = 0, BTN_DOWN = 5; // engine/constants.asm

/** Builds a fresh RPG project whose entity slots stand at the given [x, y] positions, boots it to gameplay at (120, 16). */
async function boot(places) {
  const project = mode === 'ordinary' ? createStreamedProject({ gameType: 'rpg', gridW: 2, gridH: 2, mixed: true }) : createStreamedProject({ gameType: 'rpg', gridW: 5, gridH: 5 });
  const map = mode === 'ordinary' ? project.maps[0] : project.maps.find((m) => m.streamed === true);
  const screen = mode === 'ordinary' ? 0 : 12;
  project.project.startScreen = screen;
  project.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
  map.screens[screen].entities = places.map(([x, y]) => ({ actorId: 0, x, y, props: {} }));
  project.project.startX = 120; project.project.startY = 16;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-slot5-'));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  fs.rmSync(dir, { recursive: true, force: true });
  const m = nes.cpu.mem;
  for (let i = 0; i < 200 && m[GAME_STATE] !== ST_GAMEPLAY; i++) nes.frame();
  for (let i = 0; i < 100; i++) nes.frame();
  return { nes, m };
}

/**
 * Holds Down until a FRESH battle begins, then plays it out. Returns { ok, slot, why }; `expect` is the slot that must have made contact.
 * `fresh` = the state was ST_GAMEPLAY when the wait began and a later frame showed ST_BATTLE; the slot is read on that very frame.
 */
function encounter({ nes, m }, label, expect) {
  const fail = (why) => { console.log(`${label}: <-- FAIL ${why}`); return { ok: false, slot: m[BT_FROM_ENT] }; };
  if (m[GAME_STATE] !== ST_GAMEPLAY) return fail(`not in gameplay when the wait began (game_state ${m[GAME_STATE]}): no fresh encounter possible`);
  nes.buttonDown(1, BTN_DOWN);
  let fresh = false;
  for (let i = 0; i < 600 && !fresh; i++) { nes.frame(); fresh = m[GAME_STATE] === ST_BATTLE; }
  nes.buttonUp(1, BTN_DOWN);
  if (!fresh) return fail('no fresh encounter began within 600 frames');
  const slot = m[BT_FROM_ENT];
  if (slot !== expect) return fail(`the battle came from slot ${slot}, the fixture requires slot ${expect}`);
  let menu = false;
  for (let i = 0; i < 300 && !menu && m[GAME_STATE] === ST_BATTLE; i++) {
    nes.frame();
    if (m[BT_FROM_ENT] !== slot) return fail(`bt_from_ent changed to ${m[BT_FROM_ENT]} during the intro: an encounter began over slot ${slot}'s`);
    menu = m[BT_PHASE] === BP_MENU;
  }
  if (!menu) return fail(`stuck before the menu (game_state ${m[GAME_STATE]}, bt_phase ${m[BT_PHASE]}) -- BP_INTRO hang`);
  for (let f = 0; f < 80 * 14 && m[GAME_STATE] === ST_BATTLE; f++) {
    if (f % 14 === 0) nes.buttonDown(1, BTN_A); else if (f % 14 === 1) nes.buttonUp(1, BTN_A);
    nes.frame();
    if (m[GAME_STATE] === ST_BATTLE && m[BT_FROM_ENT] !== slot) return fail(`bt_from_ent changed to ${m[BT_FROM_ENT]} mid-battle: an encounter began over slot ${slot}'s`);
  }
  nes.buttonUp(1, BTN_A);
  if (m[GAME_STATE] !== ST_GAMEPLAY || m[BT_PHASE] !== BP_DONE || m[BT_FROM_ENT] !== slot) {
    return fail(`not returned: game_state ${m[GAME_STATE]}, bt_phase ${m[BT_PHASE]}, bt_from_ent ${m[BT_FROM_ENT]} (wanted ${ST_GAMEPLAY}, ${BP_DONE}, ${slot})`);
  }
  console.log(`${label}: fresh encounter from slot ${slot}, menu reached, returned to gameplay`);
  return { ok: true, slot };
}

// the eight-contact fixture: one monster per slot, in the order the walking player meets them; the ordinary map's eighth is 208 (<= MAX_Y 224) unless last-y moves it
const spacing = mode === 'ordinary' ? 24 : 28;
const places = Array.from({ length: 8 }, (_, i) => [120, i === 7 && lastY !== null ? lastY : 40 + spacing * i]);
let pass = true;
{
  const rig = await boot(places);
  for (let k = 0; k < 8 && pass; k++) pass = encounter(rig, `battle ${k}`, k).ok;
}
// the overlap fixture: slots 2 and 5 on one spot, the other six parked off the player's column
if (pass) {
  const rig = await boot(Array.from({ length: 8 }, (_, i) => (i === 2 || i === 5 ? [120, 60] : [40, 40 + 24 * i])));
  pass = encounter(rig, 'overlap first', 2).ok && encounter(rig, 'overlap second', 5).ok;
}
console.log(pass ? 'all 8 fights (slots 0-7) and the overlap (slot 2 first, then 5) each fresh, fought out and returned to gameplay' : 'NOT PASSED');
process.exit(pass ? 0 : 1);
