// Battle-test — fire a chosen encounter without walking into it (ROADMAP item
// 3's last bullet, renderer/emulator/battletest.js).
//
// Every wandering encounter also produces ST_BATTLE, so "a battle started" is
// never enough on its own -- every scenario here isolates wandering (rate 0,
// or a formation absent from every placed monster) and checks the *specific*
// formation, not just the state, per the standard the toggles' own review
// history settled.

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
  battleTestProblem,
  applyBattleTest,
  REQUIRED_RAM,
  REQUIRED_CONSTANTS,
  REQUIRED_SYMBOLS,
  MAIN_LOOP
} from '../../renderer/emulator/battletest.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { mapEncounterFormation, RPG_LIMITS, createScreen } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const SAMPLE_ROM = path.join(SAMPLE, 'build/game.nes');
const RPG_ROM = path.join(SAMPLE_RPG, 'build/game.nes');
const hasSample = fs.existsSync(SAMPLE_ROM);
const hasRpg = fs.existsSync(RPG_ROM);
const skipSample = !hasSample && 'run `npm run sample && npm run build:sample` first';
const skipRpg = !hasRpg && 'run `npm run sample:rpg && npm run build:sample:rpg` first';

const NO_ENTITY = 0xff;
const ST_GAMEPLAY = 0;
const ST_DIALOG = 2;
const ST_BATTLE = 5;

function readBuild(dir) {
  return {
    ram: parseEquates(fs.readFileSync(path.join(dir, 'build/constants.asm'), 'utf8')),
    symbols: parseSymbolFile(fs.readFileSync(path.join(dir, 'build/game.fns'), 'utf8'))
  };
}

const SAMPLE_BUILD = hasSample ? readBuild(SAMPLE) : null;
const RPG_BUILD = hasRpg ? readBuild(SAMPLE_RPG) : null;

function loadedEmulator(romPath, build) {
  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  return emulator;
}

async function builtVariant(t, base, tweak) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-battletest-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(base);
  project.project.titleMap = null;
  tweak(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, dir, build: readBuild(dir), romPath: built.romPath };
}

const run = (emulator, frames) => {
  for (let i = 0; i < frames; i++) {
    const result = emulator.runFrame();
    assert.ok(result.frameEnded, `runFrame() did not complete frame ${i + 1}/${frames}`);
  }
};

/** sample-rpg's own default formation slot: 4 actor ids, $FF-padded. */
const pad4 = (ids) => [...ids, ...new Array(4 - ids.length).fill(NO_ENTITY)];

// =====================================================================
// Refactor fidelity: mapEncounterFormation vs. the pre-refactor formula
// (main/build/generate.js's own encounterRow, moved to shared/project.js).
//
// sample-rpg/build/ is gitignored (no checked-in pre-refactor ROM exists to
// diff against), and there is no "before" build to compare a whole ROM to
// without reverting the change under test -- so this proves equivalence two
// other ways instead: (1) an independent oracle, the pre-refactor formula
// preserved verbatim rather than re-derived, checked against adversarial
// inputs the real fixture never exercises; (2) the real sample-rpg fixture's
// own actually-compiled map_enc_actors table, read out of the real build
// output, asserted against that same oracle applied to the real project data.
// mapEncounterFormation is called from exactly one place in generate.js, so
// (2) closes the loop from "the pure function is right" to "this is what the
// shipped ROM actually contains" for every fixture that has encounters.
// =====================================================================

// The pre-refactor formula, kept verbatim (not calling mapEncounterFormation,
// which would prove nothing) as the independent oracle.
function oldEncounterRow(map, actorCount) {
  const ids = (map.encounters?.actorIds ?? []).filter((id) => id < actorCount).slice(0, 4);
  return [...ids, ...new Array(4 - ids.length).fill(0xff)];
}

/** The real, compiled map_enc_actors bytes out of a build's own maps.inc. */
async function readCompiledMapEncActors(dir) {
  const incText = await fs.promises.readFile(path.join(dir, 'build/assets/maps.inc'), 'utf8');
  const match = /map_enc_actors:\s*\n((?:\s*\.db[^\n]*\n?)+)/.exec(incText);
  assert.ok(match, 'map_enc_actors block not found in the build output');
  return match[1]
    .split(',')
    .map((token) => token.replace(/\.db|\s/g, ''))
    .filter(Boolean)
    .map((token) => parseInt(token.replace('$', ''), 16));
}

test('mapEncounterFormation matches the pre-refactor formula on adversarial inputs', () => {
  const cases = [
    { actorIds: [0, 1, 2], actorCount: 4 }, // no filtering needed
    { actorIds: [0, 99], actorCount: 4 }, // 99 is a deleted/out-of-range actor
    { actorIds: [3, 2, 1, 0], actorCount: 4 }, // exactly 4, in range
    { actorIds: [0, 1, 2, 3, 4], actorCount: 5 }, // more than 4 -- truncated
    { actorIds: [], actorCount: 4 }, // empty
    { actorIds: [50, 60, 70], actorCount: 4 } // all out of range
  ];
  for (const { actorIds, actorCount } of cases) {
    const map = { encounters: { actorIds } };
    assert.deepEqual(
      mapEncounterFormation(map, actorCount),
      oldEncounterRow(map, actorCount),
      `mismatch for actorIds=${JSON.stringify(actorIds)}, actorCount=${actorCount}`
    );
  }
});

test('mapEncounterFormation actually filters, unlike a raw slice -- the reason for the refactor', () => {
  // The behavior the pre-refactor formula already had and battleFormationSlice
  // (a raw slice, no range check) does not: a deleted actor id is dropped
  // entirely, not left in a slot the compiled ROM would then read out of range.
  const map = { encounters: { actorIds: [0, 99] } };
  assert.deepEqual(mapEncounterFormation(map, 4), [0, 0xff, 0xff, 0xff]);
});

test(
  'the compiled map_enc_actors comes from the current generator calling mapEncounterFormation, not a stale artifact',
  { skip: skipRpg },
  async (t) => {
    // sample-rpg/build/ is gitignored, so reading it directly (as an earlier
    // version of this test did) proves nothing about whether the *current*
    // generator still calls mapEncounterFormation at all -- a stale artifact
    // left over from before a regression would pass identically. Built fresh
    // here with the current generator instead, and with an adversarial
    // encounter table (unsorted, with an out-of-range id) so filtering and
    // ordering both have to survive the real compile, not just the fixture's
    // own already-in-range [0].
    const { project, dir } = await builtVariant(t, SAMPLE_RPG, (draft) => {
      draft.maps[0].encounters = { rate: 20, actorIds: [3, 99, 0] };
    });
    const actorCount = project.sprites.actors.length;
    const expected = project.maps.flatMap((map) => oldEncounterRow(map, actorCount));

    const actual = await readCompiledMapEncActors(dir);

    assert.deepEqual(actual, expected, 'the compiled table no longer matches the pre-refactor formula');
    // The filtering fix specifically: 99 dropped (not truncated in at some
    // other slot), 3 and 0 kept in their authored order.
    assert.deepEqual(actual, [3, 0, 0xff, 0xff]);
  }
);

test(
  "a zero-damage actor already in a map's encounter table still compiles into map_enc_actors",
  { skip: skipRpg },
  async (t) => {
    // isMonsterActor (shared/project.js, damage > 0) is a UI-only heuristic
    // for which actors make sense to newly ADD as a wandering monster -- the
    // compiler itself, via mapEncounterFormation, does not consult damage at
    // all (it filters only by whether the id still exists in the roster).
    // An actor already sitting in a map's table must keep compiling into a
    // real wandering encounter after its own damage is edited to zero, or
    // the ROM and Battle-test's "this map's table" button (which reads the
    // same mapEncounterFormation) would silently disagree with what an
    // isMonsterActor-filtered UI alone would suggest -- the exact
    // effectiveTrigger-shaped trap ROADMAP.md's item 3 entry now names.
    //
    // This has to be checked against the compiled bytes specifically, not
    // through applyBattleTest: applyBattleTest pokes mon_slot_actor directly
    // from whatever formation the caller hands it, so a smoke-level check
    // that only clicks the button and reads engine RAM afterward cannot
    // tell a correctly-compiled table apart from one the compiler had
    // wrongly filtered -- both would still start the requested fight, since
    // neither path re-derives the formation from the compiled ROM.
    const { dir } = await builtVariant(t, SAMPLE_RPG, (draft) => {
      draft.sprites.actors[0].damage = 0; // Slime -- no longer hostile by isMonsterActor
      draft.maps[0].encounters = { rate: 20, actorIds: [0] };
    });
    const actual = await readCompiledMapEncActors(dir);
    assert.deepEqual(actual, [0, 0xff, 0xff, 0xff], "Slime's id must still compile in, even though it no longer deals damage");
  }
);

// =====================================================================
// battleTestProblem: availability, mirroring toggleProblem's own rigor
// =====================================================================

test('battleTestProblem is null against the real sample-rpg build', { skip: skipRpg }, () => {
  assert.equal(battleTestProblem(RPG_BUILD), null);
});

test('battleTestProblem is non-null against the real action-build sample -- no battle system at all', { skip: skipSample }, () => {
  const problem = battleTestProblem(SAMPLE_BUILD);
  assert.ok(problem);
  assert.match(problem, /symbols do not name/);
});

test('battleTestProblem validates address kind, not just presence', { skip: skipRpg }, () => {
  const badRam = { ...RPG_BUILD.ram, bt_from_ent: 0x2001 }; // PPUMASK, not internal RAM
  assert.match(battleTestProblem({ ram: badRam, symbols: RPG_BUILD.symbols }), /not a usable RAM address/);

  const badSymbol = { ...RPG_BUILD.symbols, battle_begin: 0x0300 }; // engine RAM, not PRG
  assert.match(battleTestProblem({ ram: RPG_BUILD.ram, symbols: badSymbol }), /not a usable code address/);
});

test('every required dependency independently produces a problem', { skip: skipRpg }, () => {
  for (const name of REQUIRED_RAM) {
    const { [name]: _removed, ...ram } = RPG_BUILD.ram;
    assert.match(battleTestProblem({ ram, symbols: RPG_BUILD.symbols }), new RegExp(name), `removing ${name} alone should be reported`);
  }
  for (const name of REQUIRED_CONSTANTS) {
    const { [name]: _removed, ...ram } = RPG_BUILD.ram;
    assert.match(battleTestProblem({ ram, symbols: RPG_BUILD.symbols }), new RegExp(name), `removing ${name} alone should be reported`);
  }
  for (const name of REQUIRED_SYMBOLS) {
    const { [name]: _removed, ...symbols } = RPG_BUILD.symbols;
    assert.match(battleTestProblem({ ram: RPG_BUILD.ram, symbols }), new RegExp(name), `removing ${name} alone should be reported`);
  }
});

// =====================================================================
// applyBattleTest: the mechanism, against real built ROMs
// =====================================================================

test('applyBattleTest starts the requested formation, and a control run proves the assertion is real', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] }; // wandering structurally impossible
  });
  const formation = pad4([3]); // Snake -- not the map's own (empty) table, not placed anywhere touchable

  const on = loadedEmulator(romPath, build);
  run(on, 10);
  applyBattleTest(on, formation, build);
  assert.equal(on.peek(build.ram.game_state), ST_BATTLE);
  assert.deepEqual([0, 1, 2, 3].map((s) => on.peek(build.ram.mon_slot_actor + s)), formation);

  // Control: the same setup, but the redirect is never issued -- nothing
  // wired to battle_begin at all. If this run also showed ST_BATTLE, the
  // positive assertion above would prove nothing. Advanced a couple more real
  // frames afterward, not checked the instant the poke lands -- otherwise
  // this control passes for a reason that proves nothing (no time having
  // passed at all) rather than for the reason under test (nothing redirects
  // to battle_begin on its own).
  const off = loadedEmulator(romPath, build);
  run(off, 10);
  off.poke(build.ram.mon_slot_actor, formation[0]); // the poke half alone, no redirect
  run(off, 2);
  assert.equal(off.peek(build.ram.game_state), ST_GAMEPLAY, 'control: a poke with no redirect must not start a fight');
});

test('a different formation reads back different -- the parameter is not ignored', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
  });

  const a = loadedEmulator(romPath, build);
  run(a, 10);
  applyBattleTest(a, pad4([3]), build);
  const readA = [0, 1, 2, 3].map((s) => a.peek(build.ram.mon_slot_actor + s));

  const b = loadedEmulator(romPath, build);
  run(b, 10);
  applyBattleTest(b, pad4([2]), build);
  const readB = [0, 1, 2, 3].map((s) => b.peek(build.ram.mon_slot_actor + s));

  assert.notDeepEqual(readA, readB);
  assert.deepEqual(readA, pad4([3]));
  assert.deepEqual(readB, pad4([2]));
});

test('an empty formation is refused -- an instant, contentless victory', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, () => {});
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);
  assert.throws(() => applyBattleTest(emulator, [], build), /instant, contentless victory/);
  assert.throws(() => applyBattleTest(emulator, [NO_ENTITY, NO_ENTITY, NO_ENTITY, NO_ENTITY], build), /instant, contentless victory/);
  // Refused before anything is touched.
  assert.equal(emulator.peek(build.ram.game_state), ST_GAMEPLAY);
});

test('the gate is an explicit precondition, not a timeout standing in for one', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, () => {});
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);

  // Simulate mid-dialogue directly -- not by actually opening a real message
  // box, so this isolates applyBattleTest's own check from the dialogue
  // system's behavior.
  emulator.poke(build.ram.game_state, ST_DIALOG);
  emulator.poke(build.ram.talk_ent, 2);
  emulator.poke(build.ram.script_active, 1);

  assert.throws(
    () => applyBattleTest(emulator, pad4([3]), build),
    /game_state is 2, not ST_GAMEPLAY/,
    'the specific precondition must be named -- a generic timeout message would not distinguish "refused" from ' +
      '"coincidentally never reached," which is exactly the vacuous version of this test'
  );
  // Refused before runToAddress was ever attempted: nothing about the
  // simulated dialogue state was touched.
  assert.equal(emulator.peek(build.ram.talk_ent), 2);
  assert.equal(emulator.peek(build.ram.script_active), 1);
});

test('bt_from_ent and talk_ent (via bt_owner_ent) are cleared -- proven by dirtying them first, not found already clean', { skip: skipRpg }, async (t) => {
  // bt_owner_ent is not in parseEquates' reach at all -- engine/constants.asm
  // defines it as a chained expression (`ent_spawn_rec+1`, itself
  // `call_ret_hi+CALL_STACK_DEPTH`, itself `call_ret_lo+CALL_STACK_DEPTH`),
  // which nesasm resolves but neither the copied constants.asm nor game.fns
  // records numerically anywhere this test can read. Hardcoded here with its
  // derivation, the same convention rpg.test.js already uses for addresses
  // like it: call_ret_lo ($7F) + CALL_STACK_DEPTH (4) + CALL_STACK_DEPTH (4) + 1.
  const BT_OWNER_ENT = 0x88; // engine/constants.asm

  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);

  // A fresh boot already has talk_ent === NO_ENTITY (start_game sets it) and
  // a plausibly-zeroed bt_from_ent, so a test that never dirties them first
  // would pass even if the defensive clears were deleted entirely. Seed both
  // to an unrelated *live* entity's real slot.
  //
  // Checked directly, as the RAM state applyBattleTest itself leaves behind
  // -- not through battle_end's own downstream use of these bytes (re-touching
  // an entity, say), which this test would need to actually end the fight to
  // reach and would otherwise prove nothing while the battle is still live.
  // talk_ent itself is not the right byte to re-check afterward, either:
  // battle_begin's own body unconditionally clears it the instant it captures
  // it into bt_owner_ent, defensive clear or not -- bt_owner_ent is where a
  // dirty talk_ent actually shows up.
  let liveSlot = -1;
  for (let s = 0; s < build.ram.MAX_ENTITIES; s++) {
    if (emulator.peek(build.ram.ent_active + s)) liveSlot = s;
  }
  assert.notEqual(liveSlot, -1, 'sanity: sample-rpg should have spawned at least one entity');
  emulator.poke(build.ram.bt_from_ent, liveSlot);
  emulator.poke(build.ram.talk_ent, liveSlot);

  applyBattleTest(emulator, pad4([3]), build);

  assert.equal(emulator.peek(build.ram.bt_from_ent), NO_ENTITY, 'bt_from_ent must be cleared before battle_begin runs');
  assert.equal(
    emulator.peek(BT_OWNER_ENT),
    NO_ENTITY,
    "a dirty talk_ent must not have been captured into bt_owner_ent -- battle_begin's own clear of talk_ent " +
      'itself happens unconditionally and so cannot be what this is testing'
  );
});

test('an overlapping monster overwriting the formation is detected, not silently accepted', { skip: skipRpg }, async (t) => {
  const OVERLAP_X = 64;
  const OVERLAP_Y = 64;
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
    // A monster placed away from both the player's start and the fight this
    // test requests, so it cannot fire on boot -- only once teleported onto.
    draft.maps[0].screens[0].entities.push({ actorId: 3, x: OVERLAP_X, y: OVERLAP_Y, props: {} }); // Snake
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);

  // Teleported directly onto the monster's tile via a raw poke, not real
  // movement -- movement would let update_entities notice the overlap on an
  // earlier frame and fire a real touch encounter before this test ever gets
  // to exercise applyBattleTest at all. This lands the overlap on exactly the
  // frame applyBattleTest's own stage 2 runs, which is the case the design
  // note's completion boundary exists to catch.
  emulator.poke(build.ram.player_x, OVERLAP_X);
  emulator.poke(build.ram.player_y, OVERLAP_Y);

  assert.throws(
    () => applyBattleTest(emulator, pad4([1]), build), // Potion (id 1) -- not the Snake now overlapping
    /formation was overwritten/
  );
  // The fight that actually resulted is the real one: the Snake's, from the
  // real touch encounter -- proving this is the engine's own behavior, not a
  // detection false positive.
  assert.equal(emulator.peek(build.ram.game_state), ST_BATTLE);
  assert.equal(emulator.peek(build.ram.mon_slot_actor), 3);
});

test('a same-actor overlap corrupts bt_esc/bt_from_ent while the formation still reads correct', { skip: skipRpg }, async (t) => {
  const OVERLAP_X = 64;
  const OVERLAP_Y = 64;
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
    draft.maps[0].screens[0].entities.push({ actorId: 3, x: OVERLAP_X, y: OVERLAP_Y, props: {} }); // Snake
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);
  emulator.poke(build.ram.player_x, OVERLAP_X);
  emulator.poke(build.ram.player_y, OVERLAP_Y);

  // Requesting the SAME actor as the overlapping monster: touch_encounter's
  // own re-run of battle_begin writes back the identical formation bytes
  // applyBattleTest already wrote, so the formation-overwrite check above
  // cannot see this at all -- only bt_esc (which touch_encounter forces to 0,
  // "not fleeable") and bt_from_ent (which it points at the entity slot
  // instead of NO_ENTITY) show it. This is the blocker: reporting success
  // here would make the fight silently non-fleeable and despawn that actor
  // on victory.
  assert.throws(() => applyBattleTest(emulator, pad4([3]), build), /bt_esc|bt_from_ent/);
  assert.equal(emulator.peek(build.ram.game_state), ST_BATTLE);
  assert.deepEqual(
    [0, 1, 2, 3].map((s) => emulator.peek(build.ram.mon_slot_actor + s)),
    pad4([3]),
    'sanity: the formation genuinely reads unchanged -- proving the formation check alone cannot catch this case'
  );
});

test('stepOut() bailing early on a breakpoint mid-battle_begin is treated as incomplete, not success', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);

  // battle_begin's own bytes: `lda #ST_BATTLE` (2 bytes) then `sta game_state`
  // (3 bytes, absolute -- confirmed by reading the assembled ROM directly,
  // not assumed) = 5. This breakpoint lands exactly after game_state already
  // reads ST_BATTLE and before anything else in battle_begin's body has run
  // -- the specific case a bare "game_state === ST_BATTLE" check cannot tell
  // apart from a real completion, and the reason stepOut() needs its own
  // result checked instead.
  emulator.breakpoints.add(build.symbols.battle_begin + 5);
  try {
    assert.throws(() => applyBattleTest(emulator, pad4([3]), build), /battle_begin did not run to completion/);
  } finally {
    emulator.breakpoints.clear();
  }
});

test('the main_loop rendezvous is checked against its own result, not assumed', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);

  // A main_loop symbol that can never be reached -- runToAddress's own
  // instruction budget (frames: 2) will exhaust and return false, which
  // applyBattleTest has to notice rather than press on as though stage 2
  // had settled.
  const badBuild = { ram: build.ram, symbols: { ...build.symbols, main_loop: 0xffff } };
  assert.throws(() => applyBattleTest(emulator, pad4([3]), badBuild), /entity pass never settled/);
});

test('script_active dirtied during real gameplay (not simulated dialogue) is still cleared', { skip: skipRpg }, async (t) => {
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);

  // game_state stays ST_GAMEPLAY throughout -- unlike the dialogue-gate test
  // above, which dirties script_active but also puts the game into ST_DIALOG
  // and is refused before the defensive clear is ever reached. A build that
  // deleted the clear would otherwise pass every existing test here: the
  // gate test never gets far enough to exercise it, and the bt_from_ent/
  // talk_ent test does not touch this byte at all.
  assert.equal(emulator.peek(build.ram.game_state), ST_GAMEPLAY);
  emulator.poke(build.ram.script_active, 1);

  applyBattleTest(emulator, pad4([3]), build);

  assert.equal(emulator.peek(build.ram.script_active), 0, 'script_active dirtied during real gameplay must still be cleared');
});

test('an overlapping door taking effect mid-battle-start is detected', { skip: skipRpg }, async (t) => {
  const OVERLAP_X = 64;
  const OVERLAP_Y = 64;
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
    draft.maps[0].screens.push(createScreen()); // a real second screen for the door to actually lead to
    const doorActor = { ...draft.sprites.actors[1], id: draft.sprites.actors.length, name: 'Door', behavior: 'door' };
    draft.sprites.actors.push(doorActor);
    // entity_door (engine/entities.asm) fires on plain position overlap,
    // independent of the placement's own `trigger` prop -- that field is for
    // authored events, not doors or pickups.
    draft.maps[0].screens[0].entities.push({
      actorId: doorActor.id,
      x: OVERLAP_X,
      y: OVERLAP_Y,
      props: { toScreen: 1, toX: 40, toY: 40 }
    });
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);
  emulator.poke(build.ram.player_x, OVERLAP_X);
  emulator.poke(build.ram.player_y, OVERLAP_Y);

  // main_loop_warp has no game_state gate (engine/boot.asm), so the door
  // fires and take_door runs regardless of the fight this just started --
  // moving flat_screen to the door's destination underneath it. Requesting
  // an unrelated formation (Potion is not a monster and is not placed here)
  // isolates this from the formation/monster checks above.
  assert.throws(() => applyBattleTest(emulator, pad4([3]), build), /different screen|door/);
});

test('a pickup collected mid-battle-start is detected', { skip: skipRpg }, async (t) => {
  const OVERLAP_X = 64;
  const OVERLAP_Y = 64;
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
    // Potion (actor 1) is already behavior: 'pickup' in the fixture roster.
    draft.maps[0].screens[0].entities.push({ actorId: 1, x: OVERLAP_X, y: OVERLAP_Y, props: {} });
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);
  emulator.poke(build.ram.player_x, OVERLAP_X);
  emulator.poke(build.ram.player_y, OVERLAP_Y);

  assert.throws(() => applyBattleTest(emulator, pad4([3]), build), /changed the bag/);
});

test('a same-screen door still moves the player, and is still detected', { skip: skipRpg }, async (t) => {
  const OVERLAP_X = 64;
  const OVERLAP_Y = 64;
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
    const doorActor = { ...draft.sprites.actors[1], id: draft.sprites.actors.length, name: 'Door', behavior: 'door' };
    draft.sprites.actors.push(doorActor);
    // toScreen: 0 -- the SAME screen the player is already on. take_door
    // still sets flat_screen to it (the same value it already held) and
    // still relocates the player to toX/toY, so a check that only compares
    // flat_screen before/after cannot see this at all.
    draft.maps[0].screens[0].entities.push({
      actorId: doorActor.id,
      x: OVERLAP_X,
      y: OVERLAP_Y,
      props: { toScreen: 0, toX: 40, toY: 40 }
    });
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);
  emulator.poke(build.ram.player_x, OVERLAP_X);
  emulator.poke(build.ram.player_y, OVERLAP_Y);

  assert.throws(() => applyBattleTest(emulator, pad4([3]), build), /moved the player/);
  // flat_screen genuinely did not change -- proving this is caught by the
  // player_x/player_y check specifically, not a false positive from some
  // other check firing instead.
  assert.equal(emulator.peek(build.ram.flat_screen), 0);
});

test('a full-bag pickup still despawns the entity and increments pickups, and is still detected', { skip: skipRpg }, async (t) => {
  const OVERLAP_X = 64;
  const OVERLAP_Y = 64;
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
    draft.maps[0].screens[0].entities.push({ actorId: 1, x: OVERLAP_X, y: OVERLAP_Y, props: {} }); // Potion
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);
  // Fill the bag first: add_item (engine/ui.asm) is a silent no-op once
  // inv_count >= MAX_ITEMS, so inv_count/inv_items alone read unchanged
  // across this pickup even though it genuinely fires -- entity_pickup
  // (engine/entities.asm) still unconditionally despawns the entity and
  // increments `pickups` before add_item is even called.
  const MAX_ITEMS = 8; // engine/constants.asm
  emulator.poke(build.ram.inv_count, MAX_ITEMS);
  for (let slot = 0; slot < MAX_ITEMS; slot++) emulator.poke(build.ram.inv_items + slot, 3); // arbitrary real actor id
  emulator.poke(build.ram.player_x, OVERLAP_X);
  emulator.poke(build.ram.player_y, OVERLAP_Y);

  const invItemsBefore = [...Array(MAX_ITEMS)].map((_, slot) => emulator.peek(build.ram.inv_items + slot));

  assert.throws(() => applyBattleTest(emulator, pad4([3]), build), /changed the bag/);
  // Sanity: inv_count/inv_items genuinely did NOT change -- proving this is
  // caught by the pickups counter specifically, not a false positive from
  // the bag-contents check that would have caught an ordinary pickup anyway.
  assert.equal(emulator.peek(build.ram.inv_count), MAX_ITEMS);
  assert.deepEqual(
    [...Array(MAX_ITEMS)].map((_, slot) => emulator.peek(build.ram.inv_items + slot)),
    invItemsBefore
  );
});

test('a touch-armed pending event is detected', { skip: skipRpg }, async (t) => {
  const OVERLAP_X = 64;
  const OVERLAP_Y = 64;
  const { build, romPath } = await builtVariant(t, SAMPLE_RPG, (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [] };
    // Iris (actor 2) has no damage, so touching this placement arms an event
    // through pending_ent (engine/rpg.asm) without also starting a fight,
    // which would otherwise confound this with the overlap tests above.
    draft.maps[0].screens[0].entities.push({
      actorId: 2,
      x: OVERLAP_X,
      y: OVERLAP_Y,
      props: { trigger: 'touch', dialogue: 'Oh!' }
    });
  });
  const emulator = loadedEmulator(romPath, build);
  run(emulator, 10);
  emulator.poke(build.ram.player_x, OVERLAP_X);
  emulator.poke(build.ram.player_y, OVERLAP_Y);

  assert.throws(() => applyBattleTest(emulator, pad4([3]), build), /armed a pending event/);
});

test('address validation checks the far end of an array, not only its base', { skip: skipRpg }, () => {
  // mon_slot_actor sitting at $1FFD passes isRamAddress on its own base ($1FFD
  // < $2000), but slot 3 would then write $2000 -- PPUCTRL, not RAM.
  const badRam = { ...RPG_BUILD.ram, mon_slot_actor: 0x1ffd };
  assert.match(battleTestProblem({ ram: badRam, symbols: RPG_BUILD.symbols }), /mon_slot_actor\+3/);

  const badInv = { ...RPG_BUILD.ram, inv_items: 0x1ffa };
  assert.match(battleTestProblem({ ram: badInv, symbols: RPG_BUILD.symbols }), /inv_items\+7/);
});
