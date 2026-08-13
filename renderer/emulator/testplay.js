// Play from here — boot the ROM, then start the player where the Map Forge was
// pointing instead of where the project's ⚑ Start is.
//
// The honesty rule this feature has to keep: a test-play override must never be
// able to end up in a built ROM. So nothing here is compiled in. The ROM the
// emulator runs is byte for byte the ROM the user ships, and the override is
// RAM written from outside after boot — the same thing a cheat device does, and
// unavailable to the cartridge by construction rather than by a flag somebody
// has to remember to clear. Reset the emulator and the game boots where the
// project says it does, which is the demonstration of that.
//
// It is done through the engine's own door: `warp_scr`/`warp_x`/`warp_y` and
// `warp_ready`, which `main_loop` drains through `take_door`. A door already
// means "put the player on that screen at that position", so the tileset, the
// PRG bank, the redraw and the actor respawn are the engine's existing code
// path rather than a second one that has to agree with it. Poking `flat_screen`
// directly would move the player without redrawing anything.
//
// *Where* in the frame the poke lands is the whole difficulty, and it is why
// this walks the loop rather than running frames:
//
//   - `game_state` is forced to ST_GAMEPLAY at the top of `main_loop`. A
//     cartridge with a title screen boots into it, and every state but gameplay
//     freezes the world — including the warp. The redraw the warp performs is
//     what replaces the title art, so skipping the title costs nothing extra.
//   - The warp bytes go in at `main_loop_warp`, the engine's own name for the
//     instant it is about to read `warp_ready` — after the frame's movement,
//     before the decision. Written any earlier they are only a request: a door
//     the player happens to be standing on at the start position fires during
//     that same update and overwrites all four bytes, and the test play then
//     lands wherever that door goes with nothing to say so.
//   - Reaching that point means one tick of the world runs at the authored
//     start, because the decision lives after the movement. So the tick is made
//     unable to leave a mark: every entity slot is parked first, which is what a
//     pickup, a contact hit, an encounter and a stray door all come out of, and
//     the player is made invincible for it, which is what `player_hazard` checks
//     before a damage tile can take a heart. `spawn_entities` refills the
//     slots from the destination screen on the way in, so parking them is undone
//     by the very redraw the warp performs.
//   - Control comes back at `main_loop`, not after a guessed number of frames.
//     `take_door` runs to `redraw_screen`, which drives the PPU under forced
//     blank and turns rendering back on before it returns, so the top of the
//     loop is the first moment the machine is presentable again.
//
// Arriving is then checked rather than assumed, because every one of those
// steps is a claim about an engine the Code Forge is allowed to rewrite — and
// `game_state` is part of what is checked, so anything that took the game over
// during that tick fails loudly rather than leaving the player somewhere
// unexplained.

import { missingEquates } from '../../shared/enginesyms.js';

/** Engine RAM this needs, by the names `engine/constants.asm` gives them. */
export const REQUIRED_RAM = [
  'game_state',
  'flat_screen',
  'player_x',
  'player_y',
  'player_iframes',
  'ent_active',
  'MAX_ENTITIES',
  'warp_scr',
  'warp_x',
  'warp_y',
  'warp_ready',
  'ST_GAMEPLAY'
];

/** Engine labels it waits on, out of the build's own symbol table. */
export const MAIN_LOOP = 'main_loop';
export const MAIN_LOOP_WARP = 'main_loop_warp';
export const REQUIRED_SYMBOLS = [MAIN_LOOP, MAIN_LOOP_WARP];

/**
 * Why this ROM cannot be started from somewhere, or null if it can. Checked up
 * front so the failure names what is missing — an override that pokes
 * `undefined` writes to address 0, which is the engine's scratch pointer.
 */
export function startOverrideProblem({ ram, symbols }) {
  if (!ram) return 'the engine constants for this build could not be read';
  const missingRam = missingEquates(ram, REQUIRED_RAM);
  if (missingRam.length) return `engine/constants.asm no longer defines ${missingRam.join(', ')}`;
  const missingSymbols = REQUIRED_SYMBOLS.filter((name) => typeof symbols?.[name] !== 'number');
  if (missingSymbols.length) return `the build's symbols do not name ${missingSymbols.join(', ')}`;
  return null;
}

/**
 * Put the player on `screen` at `x`,`y` in a freshly loaded emulator, and leave
 * it at the top of the main loop with that screen drawn and rendering on.
 *
 * @param {import('./runcontrol.js').Emulator} emulator with the ROM loaded and not yet run
 * @param {{screen: number, x: number, y: number}} where a flat screen index and a pixel position
 * @param {{ram: object, symbols: object}} build engine constants and the symbol table
 * @throws if anything it waits for does not happen, leaving the caller to decide
 *   what to do with an emulator that is now part-way through a start it did not get
 */
export function applyStartOverride(emulator, where, { ram, symbols }) {
  const problem = startOverrideProblem({ ram, symbols });
  if (problem) throw new Error(problem);

  if (!emulator.runToAddress(symbols[MAIN_LOOP])) {
    throw new Error('the ROM did not reach its main loop');
  }

  // The tick that carries the engine to the decision point, made inert. Two,
  // not one, invincible frames: `update_player` counts the byte down before it
  // gets as far as `player_hazard`, so a single frame's worth is already spent
  // by the time the damage tile is probed.
  const iframes = emulator.peek(ram.player_iframes);
  emulator.poke(ram.game_state, ram.ST_GAMEPLAY);
  emulator.poke(ram.player_iframes, 2);
  for (let slot = 0; slot < ram.MAX_ENTITIES; slot++) emulator.poke(ram.ent_active + slot, 0);

  if (!emulator.runToAddress(symbols[MAIN_LOOP_WARP])) {
    throw new Error('the engine did not reach the point where it takes a door');
  }
  emulator.poke(ram.warp_scr, where.screen);
  emulator.poke(ram.warp_x, where.x);
  emulator.poke(ram.warp_y, where.y);
  emulator.poke(ram.warp_ready, 1);

  if (!emulator.runToAddress(symbols[MAIN_LOOP])) {
    throw new Error('the engine did not come back round its main loop');
  }
  emulator.poke(ram.player_iframes, iframes);

  if (emulator.peek(ram.game_state) !== ram.ST_GAMEPLAY) {
    throw new Error('something at the start position took over the game before the warp');
  }
  const arrived =
    emulator.peek(ram.flat_screen) === where.screen &&
    emulator.peek(ram.player_x) === where.x &&
    emulator.peek(ram.player_y) === where.y &&
    emulator.peek(ram.warp_ready) === 0;
  if (!arrived) {
    throw new Error(
      `the engine did not take the door: it is on screen ${emulator.peek(ram.flat_screen)} at ` +
        `${emulator.peek(ram.player_x)},${emulator.peek(ram.player_y)}`
    );
  }
}
