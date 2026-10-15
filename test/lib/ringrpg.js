// Helpers for the RPG-on-a-ring lifecycle tests (phase 3b S5, C1): build a ring project (RPG or action) through the bypass copy
// (test/lib/ringbypass.js -- only the refusal is neutralized, engine and generator are production), boot it headlessly under jsnes, and observe
// the engine at the instants a transition lands. Addresses come from the BUILD's own equates (buildSymbols), as test/lib/ringcloseframe.js does.
import fs from 'node:fs';
import { ringProject } from '../lua/ring_gate/ringworld.mjs';
import { bootRom, dumpVram, readState, runSteps } from '../lua/ring_gate/ringrun_jsnes.mjs';
import { judge } from '../lua/ring_gate/ringjudge.mjs';
import { checkAddresses } from '../lua/ring_gate/ringaddr.mjs';
import { ringExpected, displayedLiveIndex } from './ringoracle.js';
import { TYPING } from '../lua/ring_gate/ringscene.mjs';
import { createMap } from '../../shared/project.js';
import { createStreamedProject } from './streamedproject.js';
import { buildThrough } from './ringbypass.js';
import { buildSymbols, readFns, BULK } from './ringrun.js';

export const BTN = { A: 0, B: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7 };
/** all six ring cells: V = ring 1 (live NTs $2000/$2400, walks RIGHT), H = ring 2 (live NTs $2000/$2800, walks DOWN) */
export const SIX_CELLS = ['MMC3-V', 'MMC1-V', 'U512-V', 'MMC3-H', 'MMC1-H', 'U512-H'];
export const fwdButton = (cell) => (cell.ring === 1 ? BTN.RIGHT : BTN.DOWN);

/** Presses `button` for one frame, then runs `frames` more. `onFrame` (optional, default none) is called after every frame the tap runs, the press frame included. */
export const tap = (nes, button, frames = 14, onFrame) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  onFrame?.();
  for (let i = 0; i < frames; i++) { nes.frame(); onFrame?.(); }
};

/**
 * Builds a ring project through the bypass copy. `mutate(project)` runs last; `title: true` adds the one-screen title map Continue needs.
 * Returns { project, gridW, gridH, sym, fns, at(name), boot(), judgeNow(nes,label), dispose() }; the temp dir is the caller's to dispose.
 */
export async function buildRing({ loaded, cell, gameType = 'rpg', placement = 'resident', n = 4, talkers = 'none', start = {}, title = false, mutate }) {
  const { project, gridW, gridH } = ringProject({
    cell, gameType, n, talkers, start, bulkText: placement === 'banked' ? BULK : 0,
    mutate: (p) => {
      if (title) {
        p.maps.push(createMap(p.maps.length, 'Title'));
        p.project.titleMap = p.maps.length - 1;
        p.project.titleScreen = 0;
      }
      mutate?.(p);
    }
  });
  const built = await buildThrough(loaded, project);
  const sym = buildSymbols(built.dir);
  const addrBad = checkAddresses(sym);
  if (addrBad.length) throw new Error(`transcribed RAM addresses disagree with the build: ${addrBad.join('; ')}`);
  const fns = readFns(built.symbolPath);
  const at = (name) => {
    const v = sym.get(name);
    if (!Number.isFinite(v)) throw new Error(`${name} is not an equate of this build`);
    return v;
  };
  const ctxOf = () => ({ project, ring: cell.ring, gridW, gridH, typing: TYPING });
  return {
    project, gridW, gridH, sym, fns, at, cell, placement, romPath: built.romPath,
    boot: () => bootRom(built.romPath),
    /** settles, records the live nametables and judges them against the independent oracle (terrain + attributes + camera); returns the verdict */
    judgeNow(nes, label) {
      const [rec] = runSteps(nes, [{ op: 'check', label }]);
      return judge(rec, ctxOf());
    },
    /**
     * Judges a display-enable snapshot (watchDisplayEnable with capture) against the same independent oracle, BEFORE any later frame can repair it: the live nametables and
     * attributes, the camera registers, the nametable select $2000 published (the judge's PPUCTRL check) and, here, the $2005 pair actually written -- which the camera rule
     * fixes as (cam_x_lo, cam_y_lo). Returns the verdict; `fails` names every disagreement.
     */
    judgeShot(shot, label) {
      const v = judge({ ...shot.rec, label }, ctxOf());
      const s = shot.rec.state;
      const camera = ringExpected({ project, ring: cell.ring, gridW, gridH, player: { col: s.sw_col, row: s.sw_row, px: s.player_x, py: s.player_y } }).camera;
      if (shot.scrollX !== camera.cam_x_lo) v.fails.push(`$2005 published x scroll ${shot.scrollX}, the camera rule wants ${camera.cam_x_lo}`);
      if (shot.scrollY !== camera.cam_y_lo) v.fails.push(`$2005 published y scroll ${shot.scrollY}, the camera rule wants ${camera.cam_y_lo}`);
      v.ok = v.fails.length === 0;
      return v;
    },
    dispose: () => fs.rmSync(built.dir, { recursive: true, force: true })
  };
}

/** Runs until the streamed field is live (game_state 0, map_is_streamed 1) and a further 100 frames have settled it. A title is passed with Start. */
export function bootToField(nes, at, { budget = 900, title = false } = {}) {
  const m = () => nes.cpu.mem;
  const live = () => m()[at('game_state')] === 0 && m()[at('map_is_streamed')] === 1;
  if (title) {
    for (let k = 0; k < 90; k++) nes.frame();
    if (m()[at('game_state')] !== 3) throw new Error(`no title screen (game_state ${m()[at('game_state')]})`);
    for (let i = 0; i < 40 && !live(); i++) tap(nes, BTN.START, 15);
  }
  for (let i = 0; i < budget && !live(); i++) nes.frame();
  if (!live()) throw new Error(`the streamed field never went live (game_state ${m()[at('game_state')]})`);
  for (let i = 0; i < 100; i++) nes.frame();
}

/**
 * Records the engine's state at every moment rendering turns ON (a $2001 write that sets a display bit while none was set): the first
 * frame of a landing's picture. Follows a power cycle (reloadROM replaces the mapper). Returns the live array of snapshots.
 * `capture: true` adds ppuctrlNt / scrollX / scrollY (the PPU's registers at that instant) and `rec`, a judge()-ready record of the live nametables.
 */
export function watchDisplayEnable(nes, at, names = [], { capture = false } = {}) {
  const shots = [];
  let prev = 0;
  const install = () => {
    const orig = nes.mmap.write.bind(nes.mmap);
    nes.mmap.write = (address, value) => {
      if (address === 0x2001) {
        if ((value & 0x18) && !(prev & 0x18)) {
          const m = nes.cpu.mem;
          const s = { frame: shots.length };
          for (const n of ['game_state', 'screen_fresh', 'st_active', 'sw_col', 'sw_row', 'pending_ent', 'map_is_streamed', ...names]) s[n] = m[at(n)];
          s.variables = Array.from(m.slice(at('variables'), at('variables') + 4));
          if (capture) {
            // what the picture is at THIS instant, before the frame's NMI can repair it: the PPU's own registers (the $2000 nametable select and the $2005 pair, as the
            // landing wrote them) and the live nametables + attributes as VRAM holds them right now
            const p = nes.ppu;
            s.ppuctrlNt = p.f_nTblAddress;
            s.scrollX = p.regHT * 8 + p.regFH;
            s.scrollY = p.regVT * 8 + p.regFV;
            s.rec = { label: 'display-enable', kind: 'settled', state: readState(nes), vram: dumpVram(nes), frames: shots.length };
          }
          shots.push(s);
        }
        prev = value;
      }
      return orig(address, value);
    };
  };
  install();
  const reload = nes.reloadROM.bind(nes);
  nes.reloadROM = () => { reload(); prev = 0; install(); };
  return shots;
}

/**
 * Moves the battle menu highlight to a command and confirms it (the shape of test/unit/rpg.test.js's chooseCommand).
 * `onFrame` (optional, default none) is called after EVERY frame the helper runs (each menu step and the confirm), so a caller can assert per-frame invariants.
 */
export function chooseCommand(nes, at, command, onFrame) {
  for (let i = 0; i < 8 && nes.cpu.mem[at('bt_sel')] !== command; i++) tap(nes, BTN.DOWN, 4, onFrame);
  if (nes.cpu.mem[at('bt_sel')] !== command) throw new Error('the battle menu never reached that command');
  tap(nes, BTN.A, 6, onFrame);
}

/** Walks `button` (DOWN by default) into the slime planted 32 px that way from the start, then fights with A until the field is back. Returns when game_state is 0 again. */
export function fightSlime(nes, at, button = BTN.DOWN) {
  const m = () => nes.cpu.mem;
  for (let step = 0; step < 200 && m()[at('game_state')] === 0; step++) { nes.buttonDown(1, button); nes.frame(); nes.buttonUp(1, button); }
  for (let i = 0; i < 30 && m()[at('game_state')] !== at('ST_BATTLE'); i++) nes.frame();
  if (m()[at('game_state')] !== at('ST_BATTLE')) throw new Error('walking into the slime did not start a fight');
  for (let i = 0; i < 5; i++) nes.frame();
  const duringBattle = { st_active: m()[at('st_active')] };
  chooseCommand(nes, at, at('BC_FIGHT'));
  tap(nes, BTN.A, 20);
  for (let round = 0; round < 80 && m()[at('game_state')] === at('ST_BATTLE'); round++) tap(nes, BTN.A, 12);
  if (m()[at('game_state')] !== 0) throw new Error('the battle never ended');
  return duringBattle;
}

/** The tile the PPU would display at screen tile (row, col), from the scroll registers the last frame left and the nametables read through the mirror. */
export function displayedTile(nes, vram, row, col) {
  const p = nes.ppu;
  const sx = p.regH * 256 + p.regHT * 8 + p.regFH;
  const sy = p.regV * 240 + p.regVT * 8 + p.regFV;
  const x = (sx + 8 * col) % 512;
  const y = (sy + 8 * row) % 480;
  const base = 0x2000 + Math.floor(x / 256) * 0x400 + Math.floor(y / 240) * 0x800;
  return vram[base][Math.floor((y % 240) / 8) * 32 + Math.floor((x % 256) / 8)];
}
export const vramOf = dumpVram;

// The lightest valid RPG (one tileset; the board's universal ceiling on UNROM 512). Defined once, in the leaf module the ring gate also uses.
import { oneTilesetRpg } from '../lua/ring_gate/ringlayout.mjs';
export { oneTilesetRpg };

/**
 * C1's own banked-close scene (the gate's ringclose.mjs is read-only here): a streamed RPG of `n` screens whose talker stands on the SECOND-deepest live screen (n - 2), where
 * the dialogue's camera nudge has real local scroll to floor on both axes (the last screen's camera is clamped to local 0). The window the dialogue draws spans that screen and
 * the last one, so the deepest row's bank/address arithmetic runs.
 *   mixed: true  -- carries the ordinary map the gate's scene has (a switch-bound tile, so flip_tick assembles and the full Flip + Flash + arrow + close-row queue exists). An ordinary
 *                   map needs a region of its own, so this scene is one region shallower than the board's universal ceiling.
 *   mixed: false -- the streamed map alone: the deepest world the board admits, no flip_tick (the Flash is armed, the Flip cannot be).
 * `tilesets: 1` is oneTilesetRpg. `placement: 'banked'` adds never-reached text sized to push the dialogue overlay into the battle bank, as the gate's scene does.
 * Returns { project, talkerScreen }. `flat` is the copy's own flattenScreens (it resolves the start screen through the patched tree, as ringclose.mjs does).
 */
export function ceilingCloseProject({ cell, n, placement, mixed, tilesets = 1, flat }) {
  const vertical = cell.ring === 1;
  const p = createStreamedProject({ gameType: 'rpg', mixed, mapper: cell.mapper, mirroring: cell.mirroring, gridW: vertical ? n : 1, gridH: vertical ? 1 : n, camera: true });
  if (tilesets === 1) oneTilesetRpg(p);
  const streamed = p.maps.find((map) => map.streamed === true);
  p.party[0].renamable = false;
  const talkerScreen = n - 2;
  const pos = CLOSE_TALKER[cell.ring];
  const add = (name) => { p.sprites.actors.push({ name, behavior: 'npc', hp: 1, damage: 0 }); return p.sprites.actors.length - 1; };
  const say = (text) => ({ trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text }] }] } });
  if (mixed) {
    const before = p.maps[0];
    p.metatiles[1].tiles = [5, 6, 7, 8];
    before.screens[0].boundTiles = [{ switchId: 5, row: 0, col: 0, metatileId: 1 }];
  }
  const screen = streamed.screens[talkerScreen];
  screen.entities = screen.entities ?? [];
  screen.entities.push({ actorId: add('Talker'), x: pos.x, y: pos.y, props: say('Hello there, traveler.') });
  // a Flash command somewhere in the project is what assembles flash_tick / the palette burst (PALETTE_FX_ENABLED); the scene never walks to it
  streamed.screens[0].entities = [{ actorId: add('Flasher'), x: 40, y: 40, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }] }] } } }];
  if (placement === 'banked') {
    const commands = [];
    for (let i = 0; i * 100 < BULK; i++) commands.push({ op: 'say', text: `BULK ${i} `.padEnd(100, String.fromCharCode(65 + (i % 26))) });
    streamed.screens[streamed.screens.length - 1].entities = [{ actorId: add('Bulk'), x: 232, y: 216, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }];
  }
  const { mapBase } = flat(p);
  p.project.startScreen = mapBase[p.maps.indexOf(streamed)] + talkerScreen;
  p.project.startX = pos.x;
  p.project.startY = pos.y;
  return { project: p, talkerScreen };
}
/** where the talker stands per ring (the gate scene's own positions, test/lua/ring_gate/ringclose.mjs TALKER, restated: the camera is mid-scroll on the ring's own axis there) */
const CLOSE_TALKER = { 1: { x: 200, y: 112 }, 2: { x: 120, y: 200 } };

// ---- the eight optional battle features whose *_BATTLE_ALLOWANCE terms battleRegionBytes charges (phase 3b S5 C1, review fix F4) ----
/**
 * A scene every feature variant shares: a metasprite + animation catalog, two spells, a Potion actor and a Monster actor with a one-spell list, so each feature is switched on by
 * ONE field and the "off" project differs from the "on" one by exactly that field (an isolated delta). Appended after the ring scene's own actors.
 */
export function featureBase(p) {
  p.sprites.metasprites.push({ id: 0, name: 'M', tiles: [[0, 0, 32], [8, 0, 33], [0, 8, 34], [8, 8, 35]].map(([x, y, tile]) => ({ x, y, tile, palette: 0, hflip: false, vflip: false })) });
  p.sprites.animations.push({ id: 0, name: 'A', loop: true, frames: [{ metaspriteId: 0, duration: 16 }] });
  p.spells.push(
    { id: 0, name: 'Ember', mpCost: 3, kind: 'damage', amountMin: 10, amountMax: 10, element: 'fire', scope: 'one', anim: null },
    { id: 1, name: 'Venom', mpCost: 2, kind: 'poison', amountMin: 1, amountMax: 1, element: 'none', scope: 'one', anim: null }
  );
  p.sprites.actors.push({ name: 'Potion', behavior: 'pickup', hp: 1, damage: 0 });
  p.sprites.actors.push({
    name: 'Monster', behavior: 'npc', hp: 5, damage: 1,
    battle: { atk: 4, def: 2, mag: 0, mdef: 0, acc: 170, eva: 4, speed: 3, mp: 0, xp: 6, gold: 4, weak: 'none', strong: 'none', drop: null, dropPct: 0, heal: 0, spellIds: [0], battleTile: null, battleW: 4, battleH: 4, battlePalette: 2, attackAnim: null, level: null }
  });
}
const monsterOf = (p) => p.sprites.actors[p.sprites.actors.length - 1];
const potionOf = (p) => p.sprites.actors.length - 2;
/**
 * The features: `predicate` (a shared/project.js export that must be TRUE in the "on" project and FALSE in its baseline), `allowance` (the battletables.js constant whose term the
 * feature switches on), `base` (optional: a baseline that already pays what this feature must NOT be charged for -- the party's attack animation is isolated from the shared
 * battle-animation base by starting from a monster that already has one, as bankedbytes.test.js does) and `on`.
 */
export const RING_FEATURES = [
  { name: 'items', predicate: 'projectUsesItems', allowance: 'ITEM_LIST_FILTER_BATTLE_ALLOWANCE', on: (p) => { p.items = [{ id: 0, name: 'Potion', actorId: potionOf(p), metaspriteId: null, effect: { kind: 'heal', amount: 20 } }]; } },
  { name: 'magic power', predicate: 'projectUsesMagicPower', allowance: 'MAGIC_POWER_BATTLE_ALLOWANCE', on: (p) => { p.party[0].baseMag = 5; p.party[0].magPerLevel = 1; } },
  { name: 'magic defence', predicate: 'projectUsesMagicDefence', allowance: 'MAGIC_DEFENCE_BATTLE_ALLOWANCE', on: (p) => { p.party[0].baseMdef = 5; p.party[0].mdefPerLevel = 1; } },
  { name: 'monster spell list', predicate: 'projectUsesMonsterSpellList', allowance: 'MONSTER_SPELL_LIST_BATTLE_ALLOWANCE', on: (p) => { monsterOf(p).battle.spellIds = [0, 1]; } },
  { name: 'battle animation', predicate: 'projectUsesAnyBattleAnimation', allowance: 'BATTLE_ANIM_BATTLE_ALLOWANCE', on: (p) => { monsterOf(p).battle.attackAnim = 0; } },
  { name: 'party attack animation', predicate: 'projectUsesPartyAttackAnim', allowance: 'PARTY_ATTACK_ANIM_BATTLE_ALLOWANCE', base: (p) => { monsterOf(p).battle.attackAnim = 0; }, on: (p) => { monsterOf(p).battle.attackAnim = 0; p.party[0].attackAnim = 0; } },
  { name: 'hit feedback', predicate: 'projectUsesHitFeedback', allowance: 'HIT_FEEDBACK_BATTLE_ALLOWANCE', on: (p) => { p.rpg.hitFeedback = true; } },
  { name: 'miss', predicate: 'projectUsesMiss', allowance: 'MISS_BATTLE_ALLOWANCE', on: (p) => { p.rpg.miss = true; } }
];
