// Pure helpers for the debugger's invincibility / encounters-off / collision-off
// toggles: which engine symbols each one needs, whether a given build has them,
// and the PC/RAM targets each toggle resolves to. Kept free of DOM/Node APIs,
// the same reasoning switchvars.js and testplay.js already give for that split.
//
// All three toggles are one mechanism with two actions, not two mechanisms:
// "poke a RAM byte when execution reaches this PC" (invincibility) and
// "redirect execution to this other PC when it reaches this one" (encounters,
// collision). Both actions are keyed by a trap address the emulator checks
// once per instruction, the same way it already checks breakpoints.
//
// Invincibility traps `update_player`'s own entry and pokes `player_iframes`
// to 2 there, rather than once a frame regardless of what runs: `build_oam`
// reads the byte for the damage flicker on every frame, including a paused,
// menu, dialogue or transition frame that skips `update_player` entirely, so
// a value poked outside that routine's own cadence can go stale exactly where
// `and #$02` reads it and parks the player. Trapping the routine that owns the
// byte's decay means the poke only ever happens on a frame that was going to
// decrement it anyway.
//
// Encounters-off and collision-off both trap a routine's entry and redirect to
// its own exit tail, so the flags/registers the exit already computes (a real
// `cmp #0` for collision, nothing at all for encounters, since its caller
// re-loads A on the next instruction regardless) come from hardware actually
// executing that tail — never synthesized. Neither trap touches the stack: the
// `jsr` that reached the trapped entry already pushed the real return address,
// and the redirect only ever moves the program counter to a distinct address
// within the same routine, onto a `rts` that was always going to run — not
// necessarily forward; a routine's own exit tail can sit at a lower address
// than its entry, e.g. a shared stub several labels share.
//
// Collision-off is deliberately global: `probe_solid` has no notion of who is
// asking, and every caller — the player's own movement and every patrolling,
// chasing or `Move`-scripted actor in engine/entities.asm — goes through the
// same routine. Restricting it to the player would mean reading the return
// address off the stack and comparing it against label ranges, which is
// exactly the kind of fragile, caller-sniffing logic this codebase avoids
// elsewhere (see `probe_solid preserves X` in entities.asm: callers get a
// contract about what state survives the call, never about who called it).

import { missingEquates } from './enginesyms.js';

/** Engine RAM each toggle needs, by the names constants.asm gives them. */
export const REQUIRED_RAM = {
  invincibility: ['player_iframes']
};

/** Engine labels each toggle needs, out of the build's own symbol table. */
export const REQUIRED_SYMBOLS = {
  invincibility: ['update_player'],
  collision: ['probe_solid', 'probe_solid_done'],
  encounters: ['check_encounter', 'check_encounter_done']
};

export const TOGGLE_NAMES = Object.freeze(['invincibility', 'collision', 'encounters']);

/** Each toggle's own trap symbol -- the first name in REQUIRED_SYMBOLS for a
 * redirect toggle, and its only name for invincibility's poke. */
const TRAP_SYMBOL = {
  invincibility: 'update_player',
  collision: 'probe_solid',
  encounters: 'check_encounter'
};

// Two different kinds of address, validated two different ways. A poke
// address is a byte `Emulator.poke` writes: valid only as internal CPU RAM
// ($0000-$1FFF, the 2 KB block and its mirrors) -- anything at or past $2000
// is PPU/APU/I/O or cartridge/mapper register space, where a write has real
// side effects (disabling rendering, firing OAM DMA, bank-switching) rather
// than merely landing somewhere harmless. A trap or redirect target is a
// program counter value: valid only inside cartridge PRG space ($8000-$FFFF),
// since that is the only range nesasm ever places a label in -- landing the
// 6502 anywhere below it means executing whatever bytes happen to be in RAM.
const isRamAddress = (value) => Number.isInteger(value) && value >= 0 && value < 0x2000;
const isCodeAddress = (value) => Number.isInteger(value) && value >= 0x8000 && value <= 0xffff;

// A trap that redirects to itself is the one case that never reaches a
// genuinely new instruction: stepInstruction() would see the same PC again,
// forever, at zero real CPU/PPU/APU progress -- runFrame() eventually gives
// up (`exhausted: true`) rather than hanging outright, but nothing about a
// redirect *detects* that at the point it's armed. A DISTINCT target, forward
// or backward, is not this case: the redirect step lands there and the next
// stepInstruction() executes whatever real instruction is at that address,
// with real cycles, same as landing anywhere else. An earlier version of this
// file also required the target to sit numerically after the trap, on the
// reasoning that a redirect's whole point is reaching further down the same
// routine's own tail -- but numeric address order proves nothing about
// whether two labels belong to the same routine at all: a Code Forge routine
// is free to place a shared exit stub (`done: rts`) before the entry
// (`routine: ... jmp done`) that reaches it, and a *forward* target can
// equally point at the wrong routine entirely. That check rejected legitimate
// overrides on a false premise and has been removed; only true self-aliasing
// is refused here.
const isSelfAliasing = (trap, target) => trap === target;

/**
 * `toggle`'s resolved intercept and why it can't operate, computed together so
 * the two can never disagree with each other -- `toggleProblem` and
 * `resolveOverrideTargets` below are both thin views onto this. Independent of
 * whether the toggle even makes sense for this build's game type (see the
 * generated `BATTLE_ENABLED` in the build's own `assets/config.inc` for that
 * question, which this module never asks: a build can be RPG-shaped and
 * still fail this, e.g. because the Code Forge replaced `engine/rpg.asm` and
 * renamed `check_encounter`).
 */
function resolveOne(toggle, { ram, symbols }) {
  const ramNames = REQUIRED_RAM[toggle] ?? [];
  if (ramNames.length) {
    if (!ram) return { problem: 'the engine constants for this build could not be read', spec: null };
    const missingRam = missingEquates(ram, ramNames);
    if (missingRam.length) {
      return { problem: `engine/constants.asm no longer defines ${missingRam.join(', ')}`, spec: null };
    }
  }
  const symNames = REQUIRED_SYMBOLS[toggle] ?? [];
  const missingSymbols = symNames.filter((name) => typeof symbols?.[name] !== 'number');
  if (missingSymbols.length) {
    return { problem: `the build's symbols do not name ${missingSymbols.join(', ')}`, spec: null };
  }

  // typeof 'number' alone (the check above) still admits NaN, Infinity,
  // negatives, and any address a real build could never place a byte or a
  // label at -- ram values have to be internal RAM (what a poke writes to);
  // symbol values have to be inside cartridge PRG space (where a PC can
  // meaningfully land).
  const badRam = ramNames.filter((name) => !isRamAddress(ram[name]));
  const badSymbols = symNames.filter((name) => !isCodeAddress(symbols[name]));
  const bad = [...badRam, ...badSymbols];
  if (bad.length) {
    return { problem: `${bad.join(', ')} ${bad.length > 1 ? 'are' : 'is'} not a usable address`, spec: null };
  }

  if (toggle === 'invincibility') {
    return { problem: null, spec: { kind: 'poke', trap: symbols.update_player, address: ram.player_iframes, value: 2 } };
  }
  // 'collision' and 'encounters': REQUIRED_SYMBOLS is ordered [trap, target].
  const [trapName, targetName] = symNames;
  const trap = symbols[trapName];
  const target = symbols[targetName];
  if (isSelfAliasing(trap, target)) {
    return {
      problem: `${trapName} and ${targetName} resolve to the same address -- redirecting there would never advance`,
      spec: null
    };
  }
  const spec = { kind: 'redirect', trap, target };
  if (toggle === 'collision') spec.setAcc = 0;
  return { problem: null, spec };
}

// The single source of truth for "which address does each toggle's own trap
// name" -- read straight off the raw `symbols` table, grouped by address,
// entirely independent of `resolveOne`'s verdict on any toggle for any OTHER
// reason. This exact question has been answered wrong three rounds running,
// each time by a *different* pass re-deriving its own view of "who traps
// what" from `resolved` instead of from this: round 4 read `resolved` after
// the duplicate-trap pass had already nulled two colliding toggles, missing
// the address they'd just been nulled over; round 5 moved that read earlier
// but still through `resolved[name].spec.trap`, which only exists when that
// toggle's *entire* spec came out valid, so a toggle invalidated by something
// unrelated to its trap (a bad RAM address, a self-aliased target, a missing
// target symbol) vanished from the forbidden-target pass's view; round 6
// found the *other* pass -- the duplicate-trap check itself -- still had the
// identical bug, because it built its own groups from `resolved` too: two
// toggles whose trap symbols name the same address, where only one of them
// would otherwise have resolved, never looked like a collision at all, since
// the group `resolved` produced had just one member. One map, built once,
// consumed by both passes below (and by any pass added after them) closes
// the whole family at once rather than needing a fourth fix for a fourth
// reader: "does this address belong to a toggle's trap" is a question about
// address identity, answerable straight from `symbols`, and answering it from
// `resolved` -- which reflects armed-ness, a different and *legitimately*
// resolution-dependent question -- is the mistake every round repeated.
function rawTrapGroups(symbols) {
  const groups = new Map(); // trap address -> every toggle name whose own trap symbol resolves there
  for (const name of TOGGLE_NAMES) {
    const value = symbols?.[TRAP_SYMBOL[name]];
    if (!isCodeAddress(value)) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(name);
  }
  return groups;
}

/** Every toggle's `{problem, spec}`, with cross-toggle trap collisions refused on top. */
function resolveAll({ ram, symbols }) {
  const resolved = Object.fromEntries(TOGGLE_NAMES.map((name) => [name, resolveOne(name, { ram, symbols })]));
  const groups = rawTrapGroups(symbols);

  // Two (or more) toggles whose trap symbols name the same address is exactly
  // as ambiguous as a toggle redirecting to itself -- whichever intercept
  // table entry lands last silently wins the address, and the others simply
  // never fire. Refuse every toggle in the group that would otherwise have
  // armed, regardless of whether another member of the same group is already
  // null for its own unrelated reason (left alone, so its own more specific
  // problem stays the one reported for it -- it was already going to be
  // inert either way).
  for (const owners of groups.values()) {
    if (owners.length < 2) continue;
    for (const name of owners) {
      if (resolved[name].spec === null) continue;
      const others = owners.filter((other) => other !== name);
      resolved[name] = {
        problem: `shares its trap address with ${others.join(', ')} -- refusing an ambiguous intercept`,
        spec: null
      };
    }
  }

  // A redirect landing exactly on another toggle's own trap symbol is worse
  // than merely a wasted jump: the instruction there is a *different*
  // routine's entry, reached with the original caller's return address still
  // sitting on the stack under it -- e.g. collision redirecting onto
  // update_player, which would then run with probe_solid's own caller's
  // address still beneath it, entered mid-frame rather than from main_loop's
  // own call. `groups` (raw, address-identity-only) is what decides whether
  // an address is *anyone's* trap; only the toggle currently being checked's
  // own (already-resolved) `spec.target` comes from `resolved`, which is
  // fine -- that part really is asking "is this toggle, specifically, still
  // armed enough to have a target worth checking," a legitimate armed-ness
  // question about the toggle doing the redirecting, not about who owns the
  // address it might land on.
  for (const [name, { spec }] of Object.entries(resolved)) {
    if (!spec || spec.kind !== 'redirect') continue;
    const owners = groups.get(spec.target);
    if (!owners) continue;
    const other = owners.find((owner) => owner !== name);
    if (other === undefined) continue;
    resolved[name] = {
      problem: `redirects onto ${other}'s own trap address -- refusing to chain into another intercept`,
      spec: null
    };
  }
  return resolved;
}

/** Why `toggle` cannot operate on this build, or null if it can. */
export function toggleProblem(toggle, build) {
  return resolveAll(build)[toggle].problem;
}

/**
 * Every toggle's resolved intercept, or null per toggle it cannot operate on.
 * `kind: 'poke'` writes `value` to `address` and lets the trapped instruction
 * run normally afterward, in the same step. `kind: 'redirect'` skips the
 * trapped instruction entirely and lands execution on `target` instead —
 * optionally setting the accumulator first, for collision's own `cmp #0`.
 */
export function resolveOverrideTargets(build) {
  const resolved = resolveAll(build);
  return Object.fromEntries(TOGGLE_NAMES.map((name) => [name, resolved[name].spec]));
}

/**
 * Why `toggle` should show as unavailable in the debugger UI, or null if it
 * should be offered. This is `toggleProblem` plus one more question:
 * `battleEnabled`, generated `BATTLE_ENABLED` out of the build's own
 * `assets/config.inc`, is the single source for "is this an RPG-battle
 * build" -- deliberately not whether `check_encounter` merely happens to
 * exist in the symbol table, which is a *different* question this module
 * already answers on its own (can this toggle operate at all) and which a
 * Code Forge override can desync from the build's own generated game type in
 * either direction. Only `encounters` currently reads it; the other two are
 * build-type-agnostic.
 */
export function toggleUnavailableReason(toggle, { ram, symbols, battleEnabled }) {
  if (toggle === 'encounters' && !battleEnabled) return 'no wandering encounters in this build';
  return toggleProblem(toggle, { ram, symbols });
}
