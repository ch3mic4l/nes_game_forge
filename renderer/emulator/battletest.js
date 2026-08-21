// Battle-test — fire a chosen encounter without walking into it (ROADMAP item
// 3's last bullet).
//
// The honesty rule this feature has to keep is the same one play from here and
// the invincibility/encounters-off/collision-off toggles already settled:
// nothing here is compiled into the ROM, and the ROM the emulator runs is byte
// for byte the ROM the user ships. This is testplay.js's sibling, not the
// toggles' — a discrete, formation-carrying, one-shot action, not a standing
// per-session mode, so it goes through none of shared/testoverrides.js's trap
// table. There is nothing to arm and nothing to disarm: applyBattleTest runs
// once, to a defined completion, and returns or throws.
//
// engine/rpg.asm's battle_begin is complete on its own -- it sets game_state,
// bt_phase and every other bt_* field a fight needs, and clears every party
// member's status -- but it does not touch mon_slot_actor, bt_esc or
// bt_from_ent; those are each real caller's own job (touch_encounter,
// start_encounter, script_op_battle all set them before jumping in). Calling
// the real routine, rather than replicating its writes by hand, means any
// future change to battle_begin is inherited instead of drifted from.
//
// check_encounter is a real jsr target of update_player, called once every
// gameplay frame that reaches that point (not every frame outright: see the
// preflight checks below, and update_player's own screen_fresh/game_state
// gates, engine/player.asm). Landing there with runToAddress and then setting
// REG_PC straight to battle_begin reproduces exactly the tail-call shape
// check_encounter -> start_encounter -> battle_begin already uses: the stack
// already holds the real return address update_player's own jsr pushed, so
// battle_begin's final rts pops it correctly. This is not routed through
// Emulator.applyTestIntercept/interceptsByTrap -- there is no persistent trap
// table entry to arm, only a one-time REG_PC assignment using the same
// fabricate-nothing discipline the toggle redirects already established.
//
// The completion boundary is two real engine steps, both checked against a
// real result rather than inferred from a side effect that a partial run
// could also produce:
//   1. stepOut() past battle_begin's own rts. Its return value is the check
//      -- battle_begin's very first two instructions are `lda #ST_BATTLE`/
//      `sta game_state`, so a stepOut() that bails early on a breakpoint or
//      its own instruction-limit exhaustion can still leave game_state
//      reading ST_BATTLE with bt_esc, bt_from_ent and the status clears never
//      having run. Checking game_state afterward cannot tell those apart;
//      only stepOut() itself, mid-callee, can.
//   2. A program-address rendezvous with the next main_loop
//      (engine/boot.asm), not a single runFrame(). main_loop still calls
//      update_entities after update_player returns, in the same frame, with
//      no game_state gate of its own -- and update_player's own tail after
//      check_encounter returns has to run first too. A bare runFrame() stops
//      at the next PPU frame edge, which can land before update_entities has
//      run at all or after a second battle tick already has, depending on
//      where in the frame the redirect happened to land; its {hit|exhausted}
//      result was also being discarded. runToAddress(main_loop) instead runs
//      exactly the rest of this frame's world update and stops there,
//      checked against its own boolean rather than assumed.
//
// That second step is deliberately not skipped or dodged: an overlapping
// monster's own touch_encounter can replace the formation this just wrote,
// or -- if it is the very actor requested -- re-run battle_begin itself,
// leaving the formation reading correct while bt_esc and bt_from_ent are not.
// A door can also fire (main_loop_warp has no game_state gate either),
// moving the field to its destination out from under an already-running
// fight; and a pickup or another touch event can mutate the bag or arm a
// pending event the same way. All of this is real, pre-existing engine
// behaviour -- the same exposure a real wandering encounter has when the
// player stands on more than one trigger at once -- and not worth bending
// the frame order to dodge. It is caught here instead, loudly, by comparing
// the field state this cares about from just before the redirect to just
// after the rendezvous, rather than silently running a different fight (or
// a fight in a different place) than the one asked for.

import { missingEquates } from '../../shared/enginesyms.js';
import { isRamAddress, isCodeAddress } from '../../shared/testoverrides.js';

const NO_ENTITY = 0xff;
const FORMATION_SIZE = 4; // RPG_LIMITS.monstersPerBattle / .encounterActors (shared/project.js)
const MAX_ITEMS = 8; // engine/constants.asm

/** Engine RAM this needs, by the names engine/constants.asm gives them. */
export const REQUIRED_RAM = [
  'mon_slot_actor',
  'bt_esc',
  'bt_from_ent',
  'talk_ent',
  'script_active',
  'game_state',
  'paused',
  'warp_ready',
  'bt_phase',
  // Field context the entity pass (above) can mutate without touching the
  // formation at all -- a door taken, an event newly armed, a pickup
  // collected -- checked unchanged across the completion boundary rather
  // than left for a later frame to discover silently. Chosen by reading what
  // take_door and entity_pickup (engine/entities.asm, engine/boot.asm) each
  // actually write, not by guessing at a proxy for it:
  //  - take_door sets flat_screen AND player_x/player_y unconditionally,
  //    every time -- a door back to the SAME screen leaves flat_screen alone
  //    but still relocates and redraws around the player, so flat_screen
  //    alone is not the whole signal a door left.
  //  - entity_pickup unconditionally clears the entity and increments
  //    pickups, then calls add_item -- which is itself a no-op once the bag
  //    is full (engine/ui.asm). inv_count/inv_items alone read unchanged for
  //    exactly that case, even though a pickup genuinely fired and an entity
  //    genuinely vanished; pickups is the one counter that still moves.
  'flat_screen',
  'player_x',
  'player_y',
  'pending_ent',
  'inv_count',
  'inv_items',
  'pickups'
];

/** Plain numeric constants this needs -- not addresses, so not address-kind checked. */
export const REQUIRED_CONSTANTS = ['ST_GAMEPLAY', 'ST_BATTLE', 'BP_INTRO'];

/** Engine labels it waits on and redirects to, out of the build's own symbol table. */
export const CHECK_ENCOUNTER = 'check_encounter';
export const BATTLE_BEGIN = 'battle_begin';
// The completion boundary's rendezvous point: reaching this label a second
// time means a whole frame -- update_player's own tail past check_encounter,
// then update_entities, then everything main_loop does after it -- has run.
export const MAIN_LOOP = 'main_loop';
export const REQUIRED_SYMBOLS = [CHECK_ENCOUNTER, BATTLE_BEGIN, MAIN_LOOP];

// Multi-byte arrays this pokes or reads across their whole span, by name and
// size -- isRamAddress on the base alone (below) passes a mon_slot_actor
// sitting at $1FFF, and every slot past the first then writes into PPU/IO
// space ($2000+). Checked against the *last* byte each array touches, not
// merely its base, for the same reason a fencepost is checked at the fence.
const ARRAY_FIELDS = { mon_slot_actor: FORMATION_SIZE, inv_items: MAX_ITEMS };

/**
 * Why battle-test cannot operate on this build, or null if it can. Absent
 * entirely on an action build (engine/rpg.asm is `.if BATTLE_ENABLED`), so
 * this fails the same way for "no battle system at all" as it would for a
 * genuinely broken build -- the caller distinguishes those with generated
 * BATTLE_ENABLED (assets/config.inc), the same discriminator the toggles use,
 * not by inspecting this message.
 */
export function battleTestProblem({ ram, symbols }) {
  if (!ram) return 'the engine constants for this build could not be read';
  const missingRam = missingEquates(ram, [...REQUIRED_RAM, ...REQUIRED_CONSTANTS]);
  if (missingRam.length) return `engine/constants.asm no longer defines ${missingRam.join(', ')}`;
  const badRam = REQUIRED_RAM.filter((name) => !isRamAddress(ram[name]));
  if (badRam.length) return `${badRam.join(', ')} ${badRam.length > 1 ? 'are' : 'is'} not a usable RAM address`;
  const badArrays = Object.entries(ARRAY_FIELDS).filter(([name, size]) => !isRamAddress(ram[name] + size - 1));
  if (badArrays.length) {
    return badArrays.map(([name, size]) => `${name}+${size - 1}`).join(', ') + ' is not a usable RAM address';
  }
  const missingSymbols = REQUIRED_SYMBOLS.filter((name) => typeof symbols?.[name] !== 'number');
  if (missingSymbols.length) return `the build's symbols do not name ${missingSymbols.join(', ')}`;
  const badSymbols = REQUIRED_SYMBOLS.filter((name) => !isCodeAddress(symbols[name]));
  if (badSymbols.length) return `${badSymbols.join(', ')} ${badSymbols.length > 1 ? 'are' : 'is'} not a usable code address`;
  return null;
}

/** `formation` (1-4 real actor ids), padded/truncated to the engine's own fixed 4 slots, $FF for empty. */
function padFormation(formation) {
  const ids = (Array.isArray(formation) ? formation : []).slice(0, FORMATION_SIZE);
  return [...ids, ...new Array(FORMATION_SIZE - ids.length).fill(NO_ENTITY)];
}

/**
 * Start `formation` as a battle right now, in a freshly-loaded-and-running
 * emulator, and leave it inside that fight with the formation confirmed.
 *
 * @param {import('./runcontrol.js').Emulator} emulator a live, running RPG build
 * @param {number[]} formation up to 4 monster actor ids; shorter is padded with $FF
 * @param {{ram: object, symbols: object}} build engine constants and the symbol table
 * @throws if the build can't operate this, the world isn't in a state this
 *   makes sense from, the engine never reached a safe point to start from, or
 *   the fight that started is not the one asked for
 */
export function applyBattleTest(emulator, formation, { ram, symbols }) {
  const problem = battleTestProblem({ ram, symbols });
  if (problem) throw new Error(problem);

  const padded = padFormation(formation);
  if (padded.every((id) => id === NO_ENTITY)) {
    throw new Error('a formation with no monsters would be an instant, contentless victory');
  }

  // Explicit preflight, checked directly -- not inferred from whether
  // runToAddress happens to time out below, which cannot tell "properly
  // refused" apart from "coincidentally never reached for an unrelated
  // reason" (a dialogue box times out check_encounter identically to a
  // refusal would, since ui_tick never calls update_player either way).
  const gameState = emulator.peek(ram.game_state);
  if (gameState !== ram.ST_GAMEPLAY) {
    throw new Error(`battle-test only runs from gameplay: game_state is ${gameState}, not ST_GAMEPLAY`);
  }
  if (emulator.peek(ram.paused) !== 0) {
    throw new Error('battle-test cannot run while the game is paused');
  }
  if (emulator.peek(ram.warp_ready) !== 0) {
    throw new Error('battle-test cannot run with a door already owed this frame');
  }

  if (!emulator.runToAddress(symbols[CHECK_ENCOUNTER], { frames: 30 })) {
    throw new Error('did not reach a safe point to start the fight -- the world may still be mid-transition');
  }

  // The field state the entity pass below can mutate without ever touching
  // the formation -- snapshotted here, at the moment battle-test takes over,
  // so "unchanged across the completion boundary" has a real baseline rather
  // than an assumed one.
  const flatScreenBefore = emulator.peek(ram.flat_screen);
  const playerXBefore = emulator.peek(ram.player_x);
  const playerYBefore = emulator.peek(ram.player_y);
  const pendingEntBefore = emulator.peek(ram.pending_ent);
  const invCountBefore = emulator.peek(ram.inv_count);
  const invItemsBefore = Array.from({ length: MAX_ITEMS }, (_, slot) => emulator.peek(ram.inv_items + slot));
  const pickupsBefore = emulator.peek(ram.pickups);

  for (let slot = 0; slot < FORMATION_SIZE; slot++) emulator.poke(ram.mon_slot_actor + slot, padded[slot]);
  emulator.poke(ram.bt_esc, 1); // fleeable: the least committal default for an exploratory tool
  emulator.poke(ram.bt_from_ent, NO_ENTITY); // nothing to despawn -- not tied to any entity
  // Forced defensively, even though game_state === ST_GAMEPLAY should already
  // guarantee both clean (start_dialog sets talk_ent and ST_DIALOG together;
  // script_active is what that state machine runs on) -- battle_begin reads
  // both unconditionally, and a stale value in either makes battle_end do the
  // wrong thing afterward (re-touch an unrelated entity; jump back into
  // script_resume instead of gameplay).
  emulator.poke(ram.talk_ent, NO_ENTITY);
  emulator.poke(ram.script_active, 0);

  emulator.nes.cpu.REG_PC = (symbols[BATTLE_BEGIN] - 1) & 0xffff;

  // Stage 1: battle_begin itself, to its own real rts -- checked against
  // stepOut()'s own result, not merely against game_state afterward. Its
  // first two instructions are `lda #ST_BATTLE`/`sta game_state`, so a
  // stepOut() that bailed early (a breakpoint, or its own instruction-limit
  // exhaustion) can still leave game_state reading ST_BATTLE with the rest of
  // battle_begin's body -- bt_esc, bt_from_ent, every status clear -- never
  // having run.
  const battleBeginReturned = emulator.stepOut();
  if (!battleBeginReturned || emulator.peek(ram.game_state) !== ram.ST_BATTLE) {
    throw new Error('battle_begin did not run to completion');
  }

  // Stage 2: a program-address rendezvous with the next main_loop, not a bare
  // runFrame() -- see the file header for why a single PPU frame edge is not
  // the same boundary. Reaching main_loop again means update_player's own
  // tail past check_encounter, then update_entities, then the rest of the
  // frame, have all genuinely run -- checked against runToAddress()'s own
  // boolean, not assumed from however far the CPU got.
  if (!emulator.runToAddress(symbols[MAIN_LOOP], { frames: 2 })) {
    throw new Error('the entity pass never settled -- main_loop was not reached again after battle_begin');
  }

  const actual = [0, 1, 2, 3].map((slot) => emulator.peek(ram.mon_slot_actor + slot));
  const overwritten = padded.some((id, slot) => actual[slot] !== id);
  if (overwritten) {
    throw new Error(
      `the requested formation was overwritten before the fight settled -- asked for [${padded}], found [${actual}]`
    );
  }
  // The formation can still read correct while the fight's own metadata does
  // not: an overlapping monster that happens to BE the actor requested
  // re-runs battle_begin during the entity pass, leaving mon_slot_actor
  // unchanged while bt_esc and bt_from_ent are overwritten underneath it.
  if (emulator.peek(ram.bt_esc) !== 1) {
    throw new Error('bt_esc no longer reads fleeable -- an overlapping monster re-ran battle_begin during the entity pass');
  }
  if (emulator.peek(ram.bt_from_ent) !== NO_ENTITY) {
    throw new Error('bt_from_ent points at an entity again -- an overlapping monster re-ran battle_begin during the entity pass');
  }
  // A door: main_loop_warp has no game_state gate, so an overlapping door
  // still fires. take_door sets flat_screen AND player_x/player_y
  // unconditionally, every time it runs -- checked separately, not merged
  // into one "moved" question, because a door back to the SAME screen
  // leaves flat_screen reading exactly what it already did while still
  // relocating and redrawing around the player; flat_screen alone would
  // miss that case entirely.
  if (emulator.peek(ram.flat_screen) !== flatScreenBefore) {
    throw new Error('the entity pass moved the field to a different screen -- an overlapping door was taken mid-battle-start');
  }
  if (emulator.peek(ram.player_x) !== playerXBefore || emulator.peek(ram.player_y) !== playerYBefore) {
    throw new Error('the entity pass moved the player -- an overlapping door was taken mid-battle-start, even to this same screen');
  }
  // A touch or entry event newly armed: it would fire once this fight ends,
  // on whatever entity happened to be standing there, not anything the
  // player did.
  if (emulator.peek(ram.pending_ent) !== pendingEntBefore) {
    throw new Error('the entity pass armed a pending event -- it will fire on this battle-test, not on anything the player did');
  }
  // A pickup collected mid-pass. inv_count/inv_items alone are not the whole
  // signal: entity_pickup (engine/entities.asm) unconditionally clears the
  // entity and increments pickups before calling add_item, and add_item is
  // itself a silent no-op once the bag is already full (engine/ui.asm) --
  // so a full-bag pickup leaves inv_count/inv_items reading unchanged while
  // an entity still vanished. pickups is the one counter that still moves
  // either way.
  const invCountAfter = emulator.peek(ram.inv_count);
  const invItemsAfter = Array.from({ length: MAX_ITEMS }, (_, slot) => emulator.peek(ram.inv_items + slot));
  if (
    invCountAfter !== invCountBefore ||
    invItemsAfter.some((id, slot) => id !== invItemsBefore[slot]) ||
    emulator.peek(ram.pickups) !== pickupsBefore
  ) {
    throw new Error('the entity pass changed the bag -- a pickup was collected as a side effect of starting this fight');
  }
  if (emulator.peek(ram.game_state) !== ram.ST_BATTLE || emulator.peek(ram.bt_phase) !== ram.BP_INTRO) {
    throw new Error('the fight did not settle into its opening phase');
  }
}
