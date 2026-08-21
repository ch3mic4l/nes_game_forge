// The invincibility / encounters-off / collision-off debugger toggles
// (ROADMAP item 3, after the switch/variable inspector).
//
// The mechanism is one thing with two actions, not two mechanisms: a PC trap
// that either pokes a RAM byte (invincibility) or redirects execution past a
// routine and onto its own real exit tail (encounters, collision) -- see
// shared/testoverrides.js's own header for why neither fakes a return. Every
// test here is written as a control pair where that is possible: run the
// scenario once with the toggle off and assert the bad-for-the-player outcome
// really happens, then once with it on and assert it doesn't. The off run is
// what makes the on run's assertion mean something -- a completely unwired
// toggle would pass an "on" assertion that never checked whether anything
// could have happened at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEquates } from '../../shared/enginesyms.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { Emulator, BUTTON } from '../../renderer/emulator/runcontrol.js';
import {
  toggleProblem,
  resolveOverrideTargets,
  toggleUnavailableReason,
  REQUIRED_RAM,
  REQUIRED_SYMBOLS,
  TOGGLE_NAMES
} from '../../shared/testoverrides.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { metatileIndex, SCREEN_METATILES } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const SAMPLE_ROM = path.join(SAMPLE, 'build/game.nes');
const RPG_ROM = path.join(SAMPLE_RPG, 'build/game.nes');
const hasSample = fs.existsSync(SAMPLE_ROM);
const hasRpg = fs.existsSync(RPG_ROM);
const skipSample = !hasSample && 'run `npm run sample && npm run build:sample` first';
const skipRpg = !hasRpg && 'run `npm run sample:rpg && npm run build:sample:rpg` first';

function readBuild(dir) {
  return {
    ram: parseEquates(fs.readFileSync(path.join(dir, 'build/constants.asm'), 'utf8')),
    symbols: parseSymbolFile(fs.readFileSync(path.join(dir, 'build/game.fns'), 'utf8'))
  };
}

const SAMPLE_BUILD = hasSample ? readBuild(SAMPLE) : null;
const RPG_BUILD = hasRpg ? readBuild(SAMPLE_RPG) : null;

/** A fresh Emulator on `romPath`, configured against `build`'s own ram/symbols. */
function loadedEmulator(romPath, build) {
  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  emulator.configureTestOverrides(build);
  return emulator;
}

async function builtVariant(t, base, tweak) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-overrides-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(base);
  project.project.titleMap = null;
  tweak(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, dir, build: readBuild(dir), romPath: built.romPath };
}

// Every requested frame must actually end. A self-redirecting trap (see
// shared/testoverrides.js's own guard against it) burns runFrame()'s whole
// instruction budget without ever advancing the PPU, so it returns
// `{frameEnded: false, exhausted: true}` rather than hanging outright -- and
// a helper that only ever looked at RAM afterward would read that as "nothing
// happened yet" and could pass a test built on the assumption that *something*
// ran. Failing loudly here is what makes every assertion downstream of `run`/
// `held` trustworthy.
const run = (emulator, frames) => {
  for (let i = 0; i < frames; i++) {
    const result = emulator.runFrame();
    assert.ok(
      result.frameEnded,
      `runFrame() did not complete frame ${i + 1}/${frames} -- ` +
        (result.exhausted
          ? 'it exhausted its instruction budget without ending a frame (a livelocked intercept?)'
          : `it stopped on a hit instead: ${JSON.stringify(result.hit)}`)
    );
  }
};

const held = (emulator, button, frames) => {
  emulator.setButton(button, true);
  run(emulator, frames);
  emulator.setButton(button, false);
};

/** sample/ (unlike sample-rpg/) boots into a title screen -- press Start past it. */
function skipTitle(emulator, ram) {
  run(emulator, 20);
  if (emulator.peek(ram.game_state) === ram.ST_TITLE) {
    held(emulator, BUTTON.START, 1);
    run(emulator, 12);
  }
}

// =====================================================================
// Unit: shared/testoverrides.js -- pure address/PC resolution
// =====================================================================

test('resolveOverrideTargets against a real RPG build resolves every toggle', { skip: skipRpg }, () => {
  const targets = resolveOverrideTargets(RPG_BUILD);
  assert.deepEqual(targets.invincibility, {
    kind: 'poke',
    trap: RPG_BUILD.symbols.update_player,
    address: RPG_BUILD.ram.player_iframes,
    value: 2
  });
  assert.deepEqual(targets.collision, {
    kind: 'redirect',
    trap: RPG_BUILD.symbols.probe_solid,
    target: RPG_BUILD.symbols.probe_solid_done,
    setAcc: 0
  });
  assert.deepEqual(targets.encounters, {
    kind: 'redirect',
    trap: RPG_BUILD.symbols.check_encounter,
    target: RPG_BUILD.symbols.check_encounter_done
  });
  // Spot values, so a parser that returned an empty object could not pass by accident.
  assert.equal(RPG_BUILD.ram.player_iframes, 0x4f);
  assert.ok(RPG_BUILD.symbols.probe_solid > 0);
});

test('encounters is unavailable on an action build, everything else still resolves', { skip: skipSample }, () => {
  // sample/ has no wandering-encounter code at all: check_encounter only
  // assembles behind BATTLE_ENABLED (main/build/generate.js).
  assert.equal(typeof SAMPLE_BUILD.symbols.check_encounter, 'undefined');
  assert.equal(typeof SAMPLE_BUILD.symbols.probe_solid, 'number');

  const targets = resolveOverrideTargets(SAMPLE_BUILD);
  assert.equal(targets.encounters, null);
  assert.notEqual(targets.invincibility, null);
  assert.notEqual(targets.collision, null);
  assert.equal(toggleProblem('encounters', SAMPLE_BUILD), 'the build\'s symbols do not name check_encounter, check_encounter_done');
});

test('the UI-facing availability comes from generated BATTLE_ENABLED, not from symbol presence', { skip: skipRpg }, () => {
  // Fabricated, adversarial combinations -- not a real build for either case,
  // deliberately: the whole point is what toggleUnavailableReason() does when
  // battleEnabled and the symbol table disagree, which no real build built by
  // this generator can ever produce (BATTLE_ENABLED and whether
  // check_encounter assembles come from the same codeSlots.length check in
  // main/build/generate.js). An implementation that inferred build type from
  // symbol presence instead of reading battleEnabled would pass every other
  // test in this file, since every *real* fixture has them agreeing.

  // battleEnabled true, but the symbols this particular build's Code Forge
  // shipped don't have check_encounter -- an operability problem, not "no
  // wandering encounters in this build" (that would be actively misleading:
  // the build IS RPG-shaped, something else is broken).
  const rpgShapedButBroken = toggleUnavailableReason('encounters', {
    ram: RPG_BUILD.ram,
    symbols: {},
    battleEnabled: true
  });
  assert.match(rpgShapedButBroken, /symbols do not name/);
  assert.doesNotMatch(rpgShapedButBroken, /no wandering encounters in this build/);

  // battleEnabled false, but the symbol table (however it got this way)
  // happens to resolve check_encounter/check_encounter_done anyway -- the
  // build-type message must still win, because an action build offering
  // "wandering encounters off" makes a claim about the game that isn't true
  // regardless of whether the bytes happen to be there.
  const actionShapedButSymbolsResolve = toggleUnavailableReason('encounters', {
    ram: RPG_BUILD.ram,
    symbols: RPG_BUILD.symbols, // has both check_encounter symbols, real and valid
    battleEnabled: false
  });
  assert.equal(actionShapedButSymbolsResolve, 'no wandering encounters in this build');
});

test('every required dependency independently produces a problem, not an undefined target', { skip: skipRpg }, () => {
  assert.equal(toggleProblem('invincibility', RPG_BUILD), null, 'sanity: the real build has a problem-free baseline');
  assert.equal(toggleProblem('collision', RPG_BUILD), null);
  assert.equal(toggleProblem('encounters', RPG_BUILD), null);

  // REQUIRED_RAM.invincibility
  {
    const { player_iframes, ...ram } = RPG_BUILD.ram;
    const problem = toggleProblem('invincibility', { ram, symbols: RPG_BUILD.symbols });
    assert.match(problem, /player_iframes/);
    assert.equal(resolveOverrideTargets({ ram, symbols: RPG_BUILD.symbols }).invincibility, null);
  }
  // REQUIRED_SYMBOLS.invincibility
  {
    const { update_player, ...symbols } = RPG_BUILD.symbols;
    assert.match(toggleProblem('invincibility', { ram: RPG_BUILD.ram, symbols }), /update_player/);
    assert.equal(resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols }).invincibility, null);
  }
  // REQUIRED_SYMBOLS.collision, each name independently
  for (const missing of REQUIRED_SYMBOLS.collision) {
    const symbols = { ...RPG_BUILD.symbols };
    delete symbols[missing];
    const problem = toggleProblem('collision', { ram: RPG_BUILD.ram, symbols });
    assert.match(problem, new RegExp(missing), `removing ${missing} alone should be reported`);
    assert.equal(resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols }).collision, null);
  }
  // REQUIRED_SYMBOLS.encounters, each name independently
  for (const missing of REQUIRED_SYMBOLS.encounters) {
    const symbols = { ...RPG_BUILD.symbols };
    delete symbols[missing];
    const problem = toggleProblem('encounters', { ram: RPG_BUILD.ram, symbols });
    assert.match(problem, new RegExp(missing), `removing ${missing} alone should be reported`);
    assert.equal(resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols }).encounters, null);
  }
});

test('a build with unreadable constants or no symbols reports rather than crashes', () => {
  assert.match(toggleProblem('invincibility', { ram: null, symbols: {} }), /could not be read/);
  assert.equal(resolveOverrideTargets({ ram: null, symbols: {} }).invincibility, null);
  for (const name of TOGGLE_NAMES) {
    const problem = toggleProblem(name, { ram: {}, symbols: {} });
    if (REQUIRED_SYMBOLS[name]?.length || REQUIRED_RAM[name]?.length) {
      assert.ok(problem, `${name} needs something this build has none of`);
      // The label and the runtime view must agree: a toggle the UI marks
      // unavailable must never still be an armed spec underneath it.
      assert.equal(resolveOverrideTargets({ ram: {}, symbols: {} })[name], null);
    }
  }
});

// =====================================================================
// Unit: the livelock guard -- a trap that redirects to itself never advances
// the CPU/PPU/APU, so it has to be refused when a symbol table is resolved,
// not discovered later as a frozen screen (finding 1/2 of round 2 review).
// =====================================================================

test('a trap that would redirect to itself is refused at configure time, not survived at run time', { skip: skipRpg }, () => {
  // The reviewer's own example: adjacent labels landing on the same address.
  // Built by hand here rather than by contriving such an engine build, since
  // the point is what shared/testoverrides.js does with a symbol table that
  // claims this, regardless of how it got that way.
  const aliasedEncounters = { ...RPG_BUILD.symbols, check_encounter_done: RPG_BUILD.symbols.check_encounter };
  const encProblem = toggleProblem('encounters', { ram: RPG_BUILD.ram, symbols: aliasedEncounters });
  assert.match(encProblem, /resolve to the same address/);
  assert.equal(resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: aliasedEncounters }).encounters, null);

  const aliasedCollision = { ...RPG_BUILD.symbols, probe_solid_done: RPG_BUILD.symbols.probe_solid };
  const colProblem = toggleProblem('collision', { ram: RPG_BUILD.ram, symbols: aliasedCollision });
  assert.match(colProblem, /resolve to the same address/);
  assert.equal(resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: aliasedCollision }).collision, null);
});

test('a backward redirect target is accepted -- address order alone does not decide this', { skip: skipRpg }, () => {
  // A round-2 version of this file rejected any target that did not sit
  // numerically after its trap, reasoning that a redirect's whole point is
  // reaching further down the same routine's own tail. That reasoning does
  // not hold: the redirect step lands on the target and the *next*
  // stepInstruction() executes whatever real instruction is there, with real
  // cycles, forward or backward alike -- and a Code Forge routine is free to
  // place a shared exit stub at a lower address than the entry that jumps to
  // it. Numeric order proves nothing about whether two labels belong to the
  // same routine, so it decides nothing here either; only true self-aliasing
  // (the test above) is refused. This is the negative-space check for that
  // retraction: a backward, distinct target must resolve, not fail.
  const backward = { ...RPG_BUILD.symbols, check_encounter_done: RPG_BUILD.symbols.check_encounter - 1 };
  assert.equal(toggleProblem('encounters', { ram: RPG_BUILD.ram, symbols: backward }), null);
  assert.deepEqual(resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: backward }).encounters, {
    kind: 'redirect',
    trap: RPG_BUILD.symbols.check_encounter,
    target: RPG_BUILD.symbols.check_encounter - 1
  });
});

test("a redirect landing on a different toggle's trap is refused, not left to run recursively", { skip: skipRpg }, () => {
  // The reviewer's own chained example: collision's target aliased onto
  // invincibility's own trap (update_player). Landing there would enter
  // update_player's own body with probe_solid's *caller's* return address
  // still on the stack -- not merely wasted, a real re-entrant corruption --
  // refused here on its own, distinct from the "shares a trap" check above
  // (these two traps do not collide with each other; the *target* collides
  // with a trap).
  const chained = { ...RPG_BUILD.symbols, probe_solid_done: RPG_BUILD.symbols.update_player };
  const targets = resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: chained });
  assert.equal(targets.collision, null, "collision's target now aliases invincibility's own trap");
  assert.match(
    toggleProblem('collision', { ram: RPG_BUILD.ram, symbols: chained }),
    /redirects onto invincibility's own trap address/
  );
  // invincibility and encounters are untouched by this and should still resolve.
  assert.notEqual(targets.invincibility, null);
  assert.notEqual(targets.encounters, null);
});

test('a redirect landing on a trap that two OTHER toggles already knocked each other out over is still refused', { skip: skipRpg }, () => {
  // The hole finding 3 (round 4) found: building the forbidden-target set
  // from `resolved` *after* the duplicate-trap pass misses exactly the
  // toggles that pass just disarmed. update_player and probe_solid are
  // aliased onto the same address here, so invincibility and collision knock
  // each other out over it via the "shares a trap" pass -- but that address
  // (update_player's) is still a real routine entry regardless, and
  // encounters' redirect landing there is exactly as dangerous as if either
  // of them were still armed at it. The forbidden set has to be built before
  // that dedup pass runs, not after.
  const chained = {
    ...RPG_BUILD.symbols,
    probe_solid: RPG_BUILD.symbols.update_player, // invincibility and collision now share a trap
    check_encounter_done: RPG_BUILD.symbols.update_player // encounters' target lands on that same, now-disarmed trap
  };
  const targets = resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: chained });
  assert.equal(targets.invincibility, null, 'invincibility and collision share a trap and should both be refused');
  assert.equal(targets.collision, null, 'invincibility and collision share a trap and should both be refused');
  assert.equal(
    targets.encounters,
    null,
    "encounters' target lands on update_player, a real trap, even though nothing ended up armed there"
  );
  // Whichever of invincibility/collision the trapOwner snapshot named (object
  // insertion order, not semantically meaningful here -- both are equally
  // real), the point is that it names ONE of them rather than resolving.
  assert.match(
    toggleProblem('encounters', { ram: RPG_BUILD.ram, symbols: chained }),
    /redirects onto (invincibility|collision)'s own trap address/
  );
});

test('a trap stays forbidden even when its OWN toggle is invalidated for a reason unrelated to the dedup pass', { skip: skipRpg }, () => {
  // Round 5: the previous fix (the test above) still derived the forbidden
  // set from `resolved[name].spec.trap` -- populated only when resolveOne()
  // returns a *fully* valid spec. So a toggle invalidated for any OTHER
  // reason still silently dropped its trap out of the forbidden set, even
  // though the trap symbol itself was never the problem. Three different
  // paths into resolveOne() can invalidate a spec while leaving its trap
  // symbol perfectly real; all three have to leave that trap forbidden.

  // Path 1 (the reviewer's own reproduction): self-aliasing on the target,
  // not the trap. check_encounter is still a completely real address.
  {
    const selfAliased = { ...RPG_BUILD.symbols, check_encounter_done: RPG_BUILD.symbols.check_encounter };
    const targets = resolveOverrideTargets({
      ram: RPG_BUILD.ram,
      symbols: { ...selfAliased, probe_solid_done: RPG_BUILD.symbols.check_encounter } // collision's target -> encounters' trap
    });
    assert.equal(targets.encounters, null, 'sanity: encounters should be self-alias-invalidated');
    assert.equal(targets.collision, null, "collision's target lands on check_encounter, still a real trap");
    assert.match(
      toggleProblem('collision', {
        ram: RPG_BUILD.ram,
        symbols: { ...selfAliased, probe_solid_done: RPG_BUILD.symbols.check_encounter }
      }),
      /redirects onto encounters's own trap address/
    );
  }

  // Path 2: a bad RAM address invalidates invincibility's *poke*, not its
  // trap. update_player is still a completely real address.
  {
    const badRamOnly = { ram: { ...RPG_BUILD.ram, player_iframes: 0x2001 }, symbols: RPG_BUILD.symbols }; // PPUMASK, not internal RAM
    assert.equal(resolveOverrideTargets(badRamOnly).invincibility, null, 'sanity: invincibility should be RAM-invalidated');
    const chained = { ram: badRamOnly.ram, symbols: { ...RPG_BUILD.symbols, probe_solid_done: RPG_BUILD.symbols.update_player } };
    assert.equal(resolveOverrideTargets(chained).collision, null, "collision's target lands on update_player, still a real trap");
    assert.match(toggleProblem('collision', chained), /redirects onto invincibility's own trap address/);
  }

  // Path 3: a missing TARGET symbol invalidates collision's own spec, not
  // its trap. probe_solid is still a completely real address.
  {
    const { probe_solid_done, ...missingTarget } = RPG_BUILD.symbols;
    assert.equal(
      resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: missingTarget }).collision,
      null,
      'sanity: collision should be missing-symbol-invalidated'
    );
    const chained = { ...missingTarget, check_encounter_done: RPG_BUILD.symbols.probe_solid }; // encounters' target -> collision's trap
    assert.equal(
      resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: chained }).encounters,
      null,
      "encounters' target lands on probe_solid, still a real trap"
    );
    assert.match(
      toggleProblem('encounters', { ram: RPG_BUILD.ram, symbols: chained }),
      /redirects onto collision's own trap address/
    );
  }
});

test('two toggles sharing a trap address are both refused, not silently arbitrated by object key order', { skip: skipRpg }, () => {
  const collided = { ...RPG_BUILD.symbols, update_player: RPG_BUILD.symbols.probe_solid };
  const targets = resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: collided });
  assert.equal(targets.invincibility, null, "invincibility traps update_player, now aliased to collision's own trap");
  assert.equal(targets.collision, null, 'collision should be refused too -- the collision is ambiguous, not one-sided');
  assert.match(
    toggleProblem('invincibility', { ram: RPG_BUILD.ram, symbols: collided }),
    /shares its trap address/
  );
  assert.match(toggleProblem('collision', { ram: RPG_BUILD.ram, symbols: collided }), /shares its trap address/);
  // encounters is untouched by this particular collision and should still resolve.
  assert.notEqual(targets.encounters, null);
});

test("a shared trap is still caught when only ONE side of it would otherwise have resolved", { skip: skipRpg }, () => {
  // Round 6, reviewer's own reproduction: invincibility invalid (a bad RAM
  // address -- unrelated to its trap symbol) *and* update_player === probe_solid.
  // The test above only ever exercised the case where both sides of a shared
  // trap are individually valid, which is exactly what let the dedup pass's
  // own bug hide for two rounds: it grouped toggles by reading `spec.trap` out
  // of `resolved`, so a toggle that was going to be null anyway (for a reason
  // that has nothing to do with the trap) never appeared in a group at all --
  // a "shared" trap with only one surviving claimant never looked shared, and
  // collision stayed armed at update_player's real address.
  const mixed = {
    ram: { ...RPG_BUILD.ram, player_iframes: 0x2001 }, // PPUMASK: not internal RAM, invalidates invincibility on its own
    symbols: { ...RPG_BUILD.symbols, update_player: RPG_BUILD.symbols.probe_solid } // same trap, invincibility and collision
  };
  assert.equal(
    resolveOverrideTargets(mixed).invincibility,
    null,
    'sanity: invincibility should already be invalid for its own, unrelated reason'
  );
  assert.match(toggleProblem('invincibility', mixed), /not a usable address/, 'and its own message should say so, not the shared-trap one');

  assert.equal(
    resolveOverrideTargets(mixed).collision,
    null,
    'collision must still be refused -- it shares update_player with invincibility regardless of why invincibility failed'
  );
  assert.match(toggleProblem('collision', mixed), /shares its trap address with invincibility/);
});

test('a NaN or out-of-range address is refused rather than armed', { skip: skipRpg }, () => {
  const nanRam = { ...RPG_BUILD.ram, player_iframes: NaN };
  assert.match(toggleProblem('invincibility', { ram: nanRam, symbols: RPG_BUILD.symbols }), /not a usable address/);
  assert.equal(resolveOverrideTargets({ ram: nanRam, symbols: RPG_BUILD.symbols }).invincibility, null);

  const negative = { ...RPG_BUILD.symbols, probe_solid: -1 };
  assert.match(toggleProblem('collision', { ram: RPG_BUILD.ram, symbols: negative }), /not a usable address/);
  assert.equal(resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: negative }).collision, null);

  const tooBig = { ...RPG_BUILD.symbols, check_encounter: 0x10000 };
  assert.match(toggleProblem('encounters', { ram: RPG_BUILD.ram, symbols: tooBig }), /not a usable address/);
  assert.equal(resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: tooBig }).encounters, null);
});

test('a poke or trap address outside its own valid space is refused even though it fits in 16 bits', { skip: skipRpg }, () => {
  // A syntactically fine, in-range 16-bit value can still be the wrong KIND
  // of address: a poke into PPU/APU/register space has real side effects
  // (renderer/emulator/runcontrol.js's own poke() routes anything >= $2000
  // through the mapper), and a PC trap/target below $8000 is not cartridge
  // PRG space at all -- nesasm never places a label there.
  const pokeIntoPpu = { ...RPG_BUILD.ram, player_iframes: 0x2001 }; // PPUMASK
  assert.match(toggleProblem('invincibility', { ram: pokeIntoPpu, symbols: RPG_BUILD.symbols }), /not a usable address/);
  assert.equal(resolveOverrideTargets({ ram: pokeIntoPpu, symbols: RPG_BUILD.symbols }).invincibility, null);

  const trapInRam = { ...RPG_BUILD.symbols, probe_solid: 0x0300 }; // engine RAM, not PRG
  assert.match(toggleProblem('collision', { ram: RPG_BUILD.ram, symbols: trapInRam }), /not a usable address/);
  assert.equal(resolveOverrideTargets({ ram: RPG_BUILD.ram, symbols: trapInRam }).collision, null);
});

test('a self-redirecting trap makes runFrame() report exhausted rather than hang', { skip: skipSample }, () => {
  // Bypasses shared/testoverrides.js's own validation on purpose: that is one
  // safety net (refusing a bad symbol table before anything is armed), and
  // this is the independent one underneath it, in the run loop itself, for
  // whatever reaches it anyway.
  // Title-skip first, with the intercept table still the real, safe one --
  // sample/'s own patrollers and chasers move on their own every gameplay
  // frame (decision A: collision off is global), so corrupting the trap
  // before the title is even past would livelock on their movement alone,
  // nowhere near what this test is isolating.
  const emulator = loadedEmulator(SAMPLE_ROM, SAMPLE_BUILD);
  skipTitle(emulator, SAMPLE_BUILD.ram);

  const trap = SAMPLE_BUILD.symbols.probe_solid;
  emulator.interceptsByTrap.set(trap, { name: 'collision', spec: { kind: 'redirect', trap, target: trap, setAcc: 0 } });
  emulator.setTestOverrides({ collision: true });
  emulator.setButton(BUTTON.RIGHT, true);

  let result = null;
  for (let i = 0; i < 5 && !result?.exhausted; i++) result = emulator.runFrame();
  assert.ok(result.exhausted, 'a self-redirecting trap should exhaust runFrame() rather than complete a frame');
  assert.equal(result.frameEnded, false);
});

// =====================================================================
// Integration: invincibility (decision D -- one intercept at update_player's
// own entry, not a per-frame beginFrame() poke)
// =====================================================================

test('invincibility: a floor hazard costs health off, and costs nothing on', { skip: skipSample }, async (t) => {
  const { build, romPath, project } = await builtVariant(t, SAMPLE, (draft) => {
    // The floor under the authored start, turned to spikes -- one edit, since
    // a metatile is global (testplay.test.js already leans on this).
    const startCell = metatileIndex(Math.floor(draft.project.startX / 16), Math.floor(draft.project.startY / 16));
    const underfoot = draft.maps[0].screens[0].metatiles[startCell];
    draft.metatiles[underfoot] = { ...draft.metatiles[underfoot], collision: 'damage' };
  });
  const hearts = project.project.maxHearts;

  const off = loadedEmulator(romPath, build);
  run(off, 20);
  assert.ok(
    off.peek(build.ram.player_hp) < hearts,
    'control: booting onto the spikes without the toggle should have cost a heart'
  );

  const on = loadedEmulator(romPath, build);
  on.setTestOverrides({ invincibility: true });
  run(on, 20);
  assert.equal(on.peek(build.ram.player_hp), hearts, 'invincibility on should have taken no damage from the spikes');
});

test('collision off does not also turn off floor hazards -- they were never gated by probe_solid', { skip: skipSample }, async (t) => {
  // A wall *between* the start and a damage tile, so reaching the damage tile
  // at all is only possible if collision interception genuinely fired -- an
  // unwired toggle would leave the player stuck at the wall, hp untouched,
  // which is exactly what the "off" run below asserts as its own control.
  // Asserting damage alone (the previous version of this test) proves nothing
  // about the toggle: a completely no-op collision override would pass it
  // just as well, since the spike was never gated by probe_solid either way.
  const WALL_COL = 9; // pixel range 144-159
  const DAMAGE_COL = 12; // pixel range 192-207, only reachable past the wall
  const { build, romPath, project } = await builtVariant(t, SAMPLE, (draft) => {
    draft.maps[0].screens[0].metatiles = new Array(SCREEN_METATILES).fill(0);
    const wallMetatile = 1;
    const spikeMetatile = 2;
    draft.metatiles[wallMetatile] = { ...draft.metatiles[wallMetatile], collision: 'solid' };
    draft.metatiles[spikeMetatile] = { ...draft.metatiles[spikeMetatile], collision: 'damage' };
    for (let row = 0; row < 15; row++) {
      draft.maps[0].screens[0].metatiles[metatileIndex(WALL_COL, row)] = wallMetatile;
      draft.maps[0].screens[0].metatiles[metatileIndex(DAMAGE_COL, row)] = spikeMetatile;
    }
  });
  const hearts = project.project.maxHearts;

  const off = loadedEmulator(romPath, build);
  held(off, BUTTON.RIGHT, 55);
  assert.equal(off.peek(build.ram.player_hp), hearts, 'control: without the toggle the wall should have stopped the player short of the spikes');

  const on = loadedEmulator(romPath, build);
  on.setTestOverrides({ collision: true });
  held(on, BUTTON.RIGHT, 55);
  assert.ok(on.peek(build.ram.player_x) >= WALL_COL * 16, 'collision off should have carried the player past the wall');
  assert.ok(
    on.peek(build.ram.player_hp) < hearts,
    'collision-off should not have suppressed the spikes beyond it: they were always passable to probe_solid, damage or not'
  );
});

test('invincibility does not leave the player permanently flickering into nonexistence', { skip: skipSample }, async () => {
  // finding 1: build_oam reads player_iframes for the damage flicker on
  // *every* frame, including a paused one that skips update_player entirely.
  // A poke tied to a fixed point in the frame (the old design) stays pinned at
  // whatever it was poked to on a frame update_player never runs, and 2 is
  // exactly the value that parks the sprite (build_oam's `and #$02`). Trapping
  // update_player's own entry means the byte only ever changes on a frame that
  // was already going to decrement it, so it settles at 1 -- never 2 -- and
  // simply holds there, unread by anything, while paused.
  const emulator = loadedEmulator(SAMPLE_ROM, SAMPLE_BUILD);
  emulator.setTestOverrides({ invincibility: true });
  skipTitle(emulator, SAMPLE_BUILD.ram);
  run(emulator, 10);
  assert.equal(emulator.peek(SAMPLE_BUILD.ram.player_iframes), 1, 'a gameplay frame should have decayed the poke to 1, not left it at 2');

  emulator.poke(SAMPLE_BUILD.ram.paused, 1);
  run(emulator, 10);
  assert.equal(
    emulator.peek(SAMPLE_BUILD.ram.player_iframes),
    1,
    'a paused frame never reaches update_player, so the trap must not have fired again'
  );
  const oamY = emulator.peek(SAMPLE_BUILD.ram.OAM);
  assert.notEqual(oamY, 0xff, 'the player sprite should not be parked while paused with invincibility on');
});

// =====================================================================
// Integration: collision (decision A -- global, every probe_solid caller,
// not just the player's own movement)
// =====================================================================

async function wallVariant(t, { wallCol }) {
  return builtVariant(t, SAMPLE, (draft) => {
    draft.maps[0].screens[0].metatiles = new Array(SCREEN_METATILES).fill(0);
    const wallMetatile = 1;
    draft.metatiles[wallMetatile] = { ...draft.metatiles[wallMetatile], collision: 'solid' };
    for (let row = 0; row < 15; row++) {
      draft.maps[0].screens[0].metatiles[metatileIndex(wallCol, row)] = wallMetatile;
    }
  });
}

test('collision off: the player walks through a wall it would otherwise be blocked by', { skip: skipSample }, async (t) => {
  // Two tiles right of the authored start (112,112 -> column 7), so the player
  // has room to move before meeting it. 40 frames is comfortably past the wall
  // (reached around frame 20) but well short of MAX_X's own screen-edge
  // crossing (~frame 65), which would otherwise carry the player onto the next
  // screen and make "final player_x" mean something else entirely.
  const { build, romPath } = await wallVariant(t, { wallCol: 9 });
  const wallLeftEdge = 9 * 16;

  const off = loadedEmulator(romPath, build);
  held(off, BUTTON.RIGHT, 40);
  assert.ok(off.peek(build.ram.player_x) < wallLeftEdge, 'control: without the toggle the wall should have stopped the player');

  const on = loadedEmulator(romPath, build);
  on.setTestOverrides({ collision: true });
  held(on, BUTTON.RIGHT, 40);
  assert.ok(on.peek(build.ram.player_x) >= wallLeftEdge, 'collision off should have walked the player straight through');
  assert.equal(on.peek(build.ram.flat_screen), off.peek(build.ram.flat_screen), 'still the same screen -- this is about the wall, not a screen edge');
});

test('collision off is global: a scripted Move through the same wall is unaffected by who is walking', { skip: skipSample }, async (t) => {
  // 'Wanderer' -- an existing npc-behaviour (stands still) actor, reused
  // rather than appended: main/build/generate.js indexes project.sprites.actors
  // *by position* (`project.sprites.actors[entity.actorId]`), and filters a
  // placement out of the compiled screen entirely once actorId >= actorCount
  // -- so a freshly pushed actor's own `id` field is not what lands it in
  // range; its array position is, and reusing #6 sidesteps that entirely.
  const NPC_ACTOR_ID = 6;
  const START_X = 32;
  const WALL_COL = 4; // pixel range 64-79
  const DIST = 100; // target 132, short of MAX_X (240) and past the wall

  const { build, romPath } = await builtVariant(t, SAMPLE, (draft) => {
    draft.maps[0].screens[0].metatiles = new Array(SCREEN_METATILES).fill(0);
    const wallMetatile = 1;
    draft.metatiles[wallMetatile] = { ...draft.metatiles[wallMetatile], collision: 'solid' };
    for (let row = 0; row < 15; row++) {
      draft.maps[0].screens[0].metatiles[metatileIndex(WALL_COL, row)] = wallMetatile;
    }
    draft.maps[0].screens[0].entities = [
      {
        actorId: NPC_ACTOR_ID,
        x: START_X,
        y: 112,
        props: {
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'self', dir: 'right', dist: DIST }] }] }
        }
      }
    ];
  });

  async function finalEntX(collisionOn) {
    const emulator = loadedEmulator(romPath, build);
    if (collisionOn) emulator.setTestOverrides({ collision: true });
    // titleMap is null (builtVariant), so a handful of frames is enough to
    // clear boot's own forced-blank redraw and reach spawn_entities.
    run(emulator, 10);
    // Find the NPC's slot, then arm its event directly through the engine's
    // own consumption point (settle_owed reads pending_ent) rather than
    // walking the player over and pressing the action button: a Move only
    // needs the *event* to run, and 'self' targets the entity that owns the
    // page, so which entity started it is unrelated to how it was started.
    let slot = -1;
    for (let s = 0; s < build.ram.MAX_ENTITIES; s++) {
      if (emulator.peek(build.ram.ent_active + s) && emulator.peek(build.ram.ent_actor + s) === NPC_ACTOR_ID) slot = s;
    }
    assert.notEqual(slot, -1, 'the walker was never spawned');
    emulator.poke(build.ram.pending_ent, slot);
    run(emulator, 150); // enough frames for a 1px/frame, 100px Move plus setup
    return emulator.peek(build.ram.ent_x + slot);
  }

  const off = await finalEntX(false);
  const on = await finalEntX(true);
  assert.ok(off < START_X + DIST, 'control: without the toggle the NPC should have been blocked by the wall');
  assert.equal(on, START_X + DIST, 'collision off should have let the scripted Move complete its full distance through the wall');
});

// =====================================================================
// Integration: encounters off (decision A/D -- redirect closes the rate-1
// hole a RAM poke of enc_step cannot, and never touches placed monsters)
// =====================================================================

async function rateOneVariant(t) {
  return builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 1, actorIds: draft.maps[0].encounters.actorIds };
  });
}

test('encounters off closes the rate-1 hole a RAM poke of enc_step cannot', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await rateOneVariant(t);

  const off = loadedEmulator(romPath, build);
  held(off, BUTTON.UP, 20); // rate 1: the first real moving step's `inc enc_step` already meets it
  run(off, 10);
  assert.equal(off.peek(build.ram.game_state), build.ram.ST_BATTLE, 'control: rate 1 should fight on the first step');

  const on = loadedEmulator(romPath, build);
  on.setTestOverrides({ encounters: true });
  run(on, 5); // clear boot before reading game_state at all -- RAM is not yet ST_GAMEPLAY on power-up
  for (let i = 0; i < 60 && on.peek(build.ram.game_state) === build.ram.ST_GAMEPLAY; i++) {
    held(on, i % 4 < 2 ? BUTTON.UP : BUTTON.DOWN, 3);
  }
  assert.equal(on.peek(build.ram.game_state), build.ram.ST_GAMEPLAY, 'encounters off should never have started a wandering fight, even at rate 1');
});

test('encounters off never touches a placed monster -- bt_from_ent is the same slot with the toggle on', { skip: skipRpg }, async (t) => {
  // Rate 1, not 0: with a wandering table this hostile, an unwired toggle
  // would start a *wandering* fight on the player's very first moving step,
  // long before ever reaching the slime -- the walk below would never get
  // anywhere near it. Reaching the slime and getting there at all is only
  // possible if suppression genuinely happened; rate 0 (the previous version
  // of this test) never put the toggle in that position, since there was
  // nothing wandering to suppress either way.
  const { build, romPath } = await rateOneVariant(t);

  const emulator = loadedEmulator(romPath, build);
  emulator.setTestOverrides({ encounters: true });
  run(emulator, 10); // clear boot's own redraw so spawn_entities has placed the slime

  let slimeSlot = -1;
  for (let s = 0; s < build.ram.MAX_ENTITIES; s++) {
    if (emulator.peek(build.ram.ent_active + s) && emulator.peek(build.ram.ent_actor + s) === 0) slimeSlot = s;
  }
  assert.notEqual(slimeSlot, -1, 'the slime was never spawned');

  for (let step = 0; step < 400 && emulator.peek(build.ram.game_state) === build.ram.ST_GAMEPLAY; step++) {
    const buttons = [];
    if (emulator.peek(build.ram.player_x) < 168) buttons.push(BUTTON.RIGHT);
    if (emulator.peek(build.ram.player_y) < 168) buttons.push(BUTTON.DOWN);
    if (!buttons.length) break;
    for (const b of buttons) emulator.setButton(b, true);
    const result = emulator.runFrame();
    assert.ok(
      result.frameEnded,
      `runFrame() did not complete while walking to the slime -- ${
        result.exhausted ? 'exhausted (a livelocked intercept?)' : 'hit ' + JSON.stringify(result.hit)
      }`
    );
    for (const b of buttons) emulator.setButton(b, false);
  }
  run(emulator, 30);
  assert.equal(
    emulator.peek(build.ram.game_state),
    build.ram.ST_BATTLE,
    'walking into the slime with encounters off should still have started a fight -- if this is still ST_GAMEPLAY, ' +
      'a wandering roll never fired *and* the slime was never reached either, which means suppression is not working'
  );
  // ST_BATTLE alone is also what an unsuppressed rate-1 wandering roll would
  // have produced (on step one, long before the slime); the provenance check
  // is what actually distinguishes "the placed monster fired" from that.
  assert.equal(emulator.peek(build.ram.bt_from_ent), slimeSlot, 'bt_from_ent should name the placed slime, not a wandering roll');
});

// =====================================================================
// Integration: debugger semantics of the redirect intercept (decision E)
// =====================================================================

function returnAddressFromStack(emulator) {
  const sp = emulator.nes.cpu.REG_SP & 0xff;
  const lo = emulator.peek(0x100 | ((sp + 1) & 0xff));
  const hi = emulator.peek(0x100 | ((sp + 2) & 0xff));
  return (((hi << 8) | lo) + 1) & 0xffff;
}

// probe_solid_done (collision's target) is a poor vehicle for these: it is
// probe_solid's *only* exit, reached by every call regardless of collision
// type or of whether anything is redirected at all -- a breakpoint or
// runToAddress there passes identically whether the toggle is wired or fully
// disabled, and stepOver's "does it come back after the call" is likewise
// true unconditionally. check_encounter_done is different: at map_enc_rate 1
// (rateOneVariant), *normal* execution never reaches it at all -- the routine
// takes its own `jmp start_encounter` branch instead -- so reaching it here
// is only possible because of the redirect. Every test below proves that with
// an explicit control run, not just by asserting the "on" case.

test('a breakpoint at the redirect target fires -- and only because of the redirect, not ordinary execution', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await rateOneVariant(t);

  const off = loadedEmulator(romPath, build);
  off.toggleBreakpoint(build.symbols.check_encounter_done);
  off.setButton(BUTTON.UP, true);
  let offHit = null;
  for (let i = 0; i < 40 && !offHit; i++) offHit = off.runFrame().hit;
  assert.ok(!offHit, 'control: normal execution at rate 1 should never reach check_encounter_done at all');
  assert.equal(off.peek(build.ram.game_state), build.ram.ST_BATTLE, 'and the reason is that it went to battle instead');

  const on = loadedEmulator(romPath, build);
  on.setTestOverrides({ encounters: true });
  on.toggleBreakpoint(build.symbols.check_encounter_done);
  on.setButton(BUTTON.UP, true);
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) hit = on.runFrame().hit;
  assert.ok(hit, 'the breakpoint at check_encounter_done never fired');
  assert.equal(hit.kind, 'pc');
  assert.equal(hit.address, build.symbols.check_encounter_done);
});

test('runToAddress(target) only stops there because of the redirect', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await rateOneVariant(t);

  const off = loadedEmulator(romPath, build);
  off.setButton(BUTTON.UP, true);
  assert.equal(
    off.runToAddress(build.symbols.check_encounter_done, { frames: 10 }),
    false,
    'control: normal execution at rate 1 should never reach check_encounter_done'
  );

  const on = loadedEmulator(romPath, build);
  on.setTestOverrides({ encounters: true });
  on.setButton(BUTTON.UP, true);
  assert.ok(on.runToAddress(build.symbols.check_encounter_done, { frames: 10 }));
  assert.equal(on.pc, build.symbols.check_encounter_done);
});

test('stepOut from check_encounter returns to update_player, not on into start_encounter', { skip: skipRpg }, async (t) => {
  // Complements the collision-based stepOut test below rather than replacing
  // it: collision's target is `cmp #0; rts`, so a broken same-call
  // implementation that executed exactly that tail would still happen to look
  // right to stepOut's own rts/SP check. check_encounter_done is bare `rts` --
  // the sharper case, and the one an intercept executing the target inline
  // would break: it would run *past* the return before this ever gets to
  // check `this.pc`.
  const { build, romPath } = await rateOneVariant(t);
  const emulator = loadedEmulator(romPath, build);
  emulator.setTestOverrides({ encounters: true });
  emulator.setButton(BUTTON.UP, true);
  assert.ok(emulator.runToAddress(build.symbols.check_encounter, { frames: 40 }));
  const returnTo = returnAddressFromStack(emulator);
  const instructionsBefore = emulator.instructions;

  emulator.stepOut();

  assert.equal(
    emulator.pc,
    returnTo,
    'stepOut should have landed exactly back in update_player, not run on into start_encounter/battle setup'
  );
  assert.ok(emulator.instructions - instructionsBefore < 10, 'stepOut ran far more instructions than returning one level costs');
});

test('stepOver a jsr into check_encounter lands exactly back after the call', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await rateOneVariant(t);

  // First pass: discover where the caller's own jsr is, without hardcoding it.
  const probe = loadedEmulator(romPath, build);
  probe.setTestOverrides({ encounters: true });
  probe.setButton(BUTTON.UP, true);
  assert.ok(probe.runToAddress(build.symbols.check_encounter, { frames: 40 }));
  const returnTo = returnAddressFromStack(probe);
  const jsrAt = (returnTo - 3) & 0xffff;

  // Second pass, fresh: land exactly on that jsr and step over it.
  const emulator = loadedEmulator(romPath, build);
  emulator.setTestOverrides({ encounters: true });
  emulator.setButton(BUTTON.UP, true);
  assert.ok(emulator.runToAddress(jsrAt, { frames: 40 }));
  assert.equal(emulator.peek(jsrAt), 0x20, 'expected to have landed on a JSR opcode');

  // A breakpoint at the target must interrupt stepOver mid-call -- proof, not
  // inference, that the redirect step is genuinely observable to the same
  // checkBreak() stepOver's own loop already calls after every step it takes.
  // The instruction-count bound below this is NOT sufficient on its own: the
  // historical same-call bug executes check_encounter_done's bare `rts`
  // inside the redirect call itself, so under that bug `this.pc` is already
  // past the target by the time anything checks it -- the breakpoint would
  // silently never fire, landing on the right final PC in the same handful
  // of instructions regardless. This is what actually distinguishes them.
  emulator.toggleBreakpoint(build.symbols.check_encounter_done);
  emulator.stepOver();
  assert.equal(
    emulator.pc,
    build.symbols.check_encounter_done,
    'stepOver should have stopped exactly at the breakpoint, not stepped through it'
  );
  assert.ok(emulator.lastBreak, 'the breakpoint should have registered a hit');

  // Cleared, continuing over the same routine's own real `rts` lands exactly
  // back after the original call.
  emulator.toggleBreakpoint(build.symbols.check_encounter_done);
  const instructionsBefore = emulator.instructions;
  emulator.stepOver();
  assert.equal(emulator.pc, returnTo, 'stepping on from the target should land right after the original call');
  assert.ok(emulator.instructions - instructionsBefore < 10, 'the final rts alone should cost only one instruction');
});

// Explicitly demoted, not a regression guard: this does NOT catch the
// historical same-call bug. Under that bug, the redirect call executes
// probe_solid_done's `cmp #0` inline, and the very next call executes its
// `rts` -- exactly two real instructions and the same final PC the *correct*
// implementation also produces, so both assertions below pass either way.
// (The check_encounter-based stepOut/stepOver tests above are what actually
// distinguish the two implementations, because check_encounter_done's target
// is a bare `rts` with nothing before it to absorb the extra call.) What this
// test still legitimately covers, and the encounters-based tests cannot,
// is the accumulator side effect: collision's redirect is the only one that
// sets a register before landing, and REG_ACC has to be 0 -- from `probe_type`
// clearing it before `cmp` runs a real comparison, or the intercept setting it
// directly, but the wrong outcome either way. That is what the assertion here
// verifies.
test('stepOut from inside the collision-trapped routine sets the accumulator and returns to the real caller', { skip: skipSample }, () => {
  const emulator = loadedEmulator(SAMPLE_ROM, SAMPLE_BUILD);
  skipTitle(emulator, SAMPLE_BUILD.ram);
  emulator.setTestOverrides({ collision: true });
  emulator.setButton(BUTTON.RIGHT, true);
  assert.ok(emulator.runToAddress(SAMPLE_BUILD.symbols.probe_solid, { frames: 60 }));
  const returnTo = returnAddressFromStack(emulator);

  emulator.stepOut();

  assert.equal(emulator.pc, returnTo, 'stepOut should have landed exactly back in the caller, not run past it');
  assert.equal(emulator.nes.cpu.REG_ACC, 0, "collision's redirect sets A=0 before landing on probe_solid_done's own cmp #0");
});

// =====================================================================
// Lifecycle: false defaults, partial updates, reconfigure on every load
// (finding 9) and persistence across reset (decision B)
// =====================================================================

test('a fresh Emulator defaults every toggle off and has no resolved targets', () => {
  const emulator = new Emulator({ onFrame: () => {} });
  for (const name of TOGGLE_NAMES) assert.equal(emulator.testOverrides[name], false);
  assert.equal(emulator.overrideTargets, null);
  assert.equal(emulator.interceptsByTrap.size, 0);
});

test('loadROM invalidates previously resolved targets -- a toggle stays inert until reconfigured', { skip: skipSample }, () => {
  const emulator = loadedEmulator(SAMPLE_ROM, SAMPLE_BUILD);
  assert.notEqual(emulator.overrideTargets, null);

  emulator.loadROM(new Uint8Array(fs.readFileSync(SAMPLE_ROM)));
  assert.equal(emulator.overrideTargets, null, 'a fresh load must not keep the previous load\'s resolved addresses');
  assert.equal(emulator.interceptsByTrap.size, 0);

  // Turning a toggle on before reconfiguring must not crash or misbehave --
  // there is simply nothing armed yet.
  emulator.setTestOverrides({ collision: true });
  held(emulator, BUTTON.RIGHT, 5);

  emulator.configureTestOverrides(SAMPLE_BUILD);
  assert.notEqual(emulator.overrideTargets, null);
  // 2, not 3: sample/ is an action build with no check_encounter at all, so
  // only invincibility and collision resolve to an armed trap.
  assert.equal(emulator.interceptsByTrap.size, 2);
});

test("a throwing loadROM still invalidates the previous load's targets", { skip: skipSample }, () => {
  // loadROM() clears overrideTargets/interceptsByTrap *before* calling into
  // the core loader, specifically so a load that throws partway through --
  // this one, on a malformed ROM -- cannot leave the previous ROM's resolved
  // addresses armed against whatever the failed load left behind.
  const emulator = loadedEmulator(SAMPLE_ROM, SAMPLE_BUILD);
  assert.notEqual(emulator.overrideTargets, null, 'sanity: the first load resolved targets');

  assert.throws(() => emulator.loadROM(new Uint8Array(20)), /Not a valid NES ROM/);
  assert.equal(emulator.overrideTargets, null, "a throwing load must not leave the previous load's targets armed");
  assert.equal(emulator.interceptsByTrap.size, 0);
});

test('setTestOverrides merges -- a partial update leaves the other toggles alone', () => {
  const emulator = new Emulator({ onFrame: () => {} });
  emulator.setTestOverrides({ collision: true });
  assert.equal(emulator.testOverrides.collision, true);
  assert.equal(emulator.testOverrides.invincibility, false);
  assert.equal(emulator.testOverrides.encounters, false);
  emulator.setTestOverrides({ invincibility: true });
  assert.equal(emulator.testOverrides.collision, true, 'collision should still be on');
  assert.equal(emulator.testOverrides.invincibility, true);
});

test('reset restores the RAM the game itself set, independent of any toggle', { skip: skipSample }, async (t) => {
  // A plain, hazard-free screen: this is about reset() alone, not about
  // whether a hit was survivable, so player_hp is forced down by hand rather
  // than by walking onto anything -- nothing here should re-damage the player
  // once reset() runs, which is exactly what makes "back to full" legible.
  const { build, romPath, project } = await builtVariant(t, SAMPLE, () => {});
  const hearts = project.project.maxHearts;

  const emulator = loadedEmulator(romPath, build);
  run(emulator, 20);
  emulator.poke(build.ram.player_hp, 1);
  assert.equal(emulator.peek(build.ram.player_hp), 1, 'the poke itself should have taken');

  emulator.reset();
  run(emulator, 5);
  assert.equal(emulator.peek(build.ram.player_hp), hearts, 'reset should have restored the RAM to a fresh boot');
  assert.equal(emulator.testOverrides.invincibility, false, 'nothing was turned on yet, so nothing should have turned on by itself');
});

test('the toggle itself survives reset, like a breakpoint -- only the RAM is what reset restores', { skip: skipSample }, async (t) => {
  // ROADMAP.md used to describe this whole family as "a poke ... that a reset
  // undoes." That is only half right: the RAM a reset restores is exactly
  // what a fresh boot would have set, same as always -- but the *toggle*
  // (like a breakpoint or a watchpoint) is debugger configuration, not game
  // state, so it stays on, visibly, rather than silently going dark on the
  // tester the moment they press Reset to replay a scenario.
  const { build, romPath, project } = await builtVariant(t, SAMPLE, (draft) => {
    const startCell = metatileIndex(Math.floor(draft.project.startX / 16), Math.floor(draft.project.startY / 16));
    const underfoot = draft.maps[0].screens[0].metatiles[startCell];
    draft.metatiles[underfoot] = { ...draft.metatiles[underfoot], collision: 'damage' };
  });
  const hearts = project.project.maxHearts;

  const emulator = loadedEmulator(romPath, build);
  emulator.setTestOverrides({ invincibility: true });
  run(emulator, 20);
  assert.equal(emulator.peek(build.ram.player_hp), hearts, 'invincibility should have protected the first run, spikes and all');

  emulator.reset();
  assert.equal(emulator.testOverrides.invincibility, true, 'the toggle itself must survive the reset, exactly like a breakpoint would');
  assert.notEqual(emulator.overrideTargets, null, 'reset reuses the same ROM, so the resolved addresses stay valid without reconfiguring');

  // And it really does keep working post-reset -- reset is architecturally a
  // fresh boot of the same image, so the same budget that proved protection
  // from a cold load should equally prove it survives a reset.
  run(emulator, 20);
  assert.equal(emulator.peek(build.ram.player_hp), hearts, 'invincibility should still be protecting the player after the reset');
});
