// The decision logic behind "Reload Test" (shared/reloadcoordinator.js,
// ROADMAP item 3's last bullet-but-one), exercised with stubs standing in
// for every effectful step -- no Electron, no DOM, no real assembler.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runReloadTest } from '../../shared/reloadcoordinator.js';
import { resolveFormation } from '../../shared/playscenario.js';

const OK = { ok: true, value: null };

function calls() {
  const log = [];
  return {
    log,
    record:
      (name, returns) =>
      (...args) => {
        log.push([name, ...args]);
        return returns;
      }
  };
}

test('a failed build never resolves the scenario or mounts a player, and toasts accordingly', async () => {
  const { log, record } = calls();
  const outcome = await runReloadTest({
    build: async () => null,
    resolveScenario: (...args) => {
      record('resolveScenario')(...args);
      return { startAt: OK, battleTest: OK };
    },
    play: record('play'),
    toast: record('toast'),
    hasPlayer: () => true
  });

  assert.equal(outcome.ok, false);
  assert.deepEqual(
    log.map(([name]) => name),
    ['toast']
  );
  assert.match(log[0][1], /Still running the previous build/);
});

test('a failed build with no live player reports that nothing was started', async () => {
  const { log, record } = calls();
  await runReloadTest({
    build: async () => null,
    resolveScenario: () => ({ startAt: OK, battleTest: OK }),
    play: record('play'),
    toast: record('toast'),
    hasPlayer: () => false
  });
  assert.match(log[0][1], /Nothing was started/);
});

test('a build that succeeds but whose world no longer exists (isLive false) does nothing visible at all', async () => {
  const { log, record } = calls();
  const outcome = await runReloadTest({
    build: async () => ({ project: {} }),
    resolveScenario: record('resolveScenario'),
    play: record('play'),
    toast: record('toast'),
    isLive: () => false
  });
  assert.equal(outcome.ok, false);
  assert.deepEqual(log, [], 'nothing should be resolved, mounted, or toasted once the world is gone');
});

test('a resolution refusal after a successful build is reported like any other failure, and play is never called', async () => {
  const { log, record } = calls();
  const outcome = await runReloadTest({
    build: async () => ({ project: {} }),
    resolveScenario: () => ({ startAt: { ok: false, reason: 'no map is named "World" anymore' }, battleTest: OK }),
    play: record('play'),
    toast: record('toast')
  });
  assert.equal(outcome.ok, false);
  assert.deepEqual(
    log.map(([name]) => name),
    ['toast']
  );
  assert.match(log[0][1], /no map is named "World" anymore/);
});

test('a successful resolution calls play with the resolved values, the resolved isLive, and desired toggles', async () => {
  const { log, record } = calls();
  const resolvedStart = { screen: 3, x: 8, y: 8, label: 'World · screen 3' };
  const resolvedBattle = { formation: [0, 1], label: 'Slime + Bat' };
  const isLive = () => true;

  const outcome = await runReloadTest({
    build: async () => ({ project: {} }),
    resolveScenario: () => ({ startAt: { ok: true, value: resolvedStart }, battleTest: { ok: true, value: resolvedBattle } }),
    play: record('play', { ok: true }),
    toast: record('toast'),
    isLive,
    desiredToggles: () => ({ invincibility: true })
  });

  assert.equal(outcome.ok, true);
  const [[name, result, options]] = log;
  assert.equal(name, 'play');
  assert.deepEqual(result, { project: {} });
  assert.equal(options.startAt, resolvedStart);
  assert.equal(options.battleTest, resolvedBattle);
  assert.equal(options.scenarioBound, true);
  assert.deepEqual(options.desiredToggles, { invincibility: true });
  assert.equal(options.isLive, isLive, 'the same predicate must be threaded into play() for its own second check');
});

test('desiredToggles is read after the build settles, not before -- a toggle flipped during a slow rebuild still reaches the new session', async () => {
  let live = { invincibility: false };
  const outcome = await runReloadTest({
    build: async () => {
      live = { invincibility: true }; // the "user flipped a checkbox mid-build" moment
      return { project: {} };
    },
    resolveScenario: () => ({ startAt: { ok: true, value: null }, battleTest: { ok: true, value: null } }),
    play: (result, options) => {
      assert.deepEqual(options.desiredToggles, { invincibility: true });
      return { ok: true };
    },
    toast: () => {},
    desiredToggles: () => live
  });
  assert.equal(outcome.ok, true);
});

// -------------------------------------------------------------------------
// A failed play() (round 7 review's findings 2/3: a bad ROM read, or
// isLive() catching an abandonment during play()'s own asynchronous reads)
// is a real, separate failure from a failed build or a resolution refusal --
// it happens after both have already succeeded, and the coordinator must
// not paper over it as {ok: true}.
// -------------------------------------------------------------------------

test("play()'s own failure is returned as this coordinator's outcome, not swallowed into a success", async () => {
  const outcome = await runReloadTest({
    build: async () => ({ project: {} }),
    resolveScenario: () => ({ startAt: OK, battleTest: OK }),
    play: async () => ({ ok: false, reason: 'the ROM could not be read' }),
    toast: () => {}
  });
  assert.deepEqual(outcome, { ok: false, reason: 'the ROM could not be read' });
});

// -------------------------------------------------------------------------
// The identity bug in a different disguise (round 2, and review's sharpest
// finding this round): resolving against a *later* read of the live project
// can select a different ROM entity than the one actually assembled, even
// though the same name still matches something. This is what makes
// resolveScenario receive the build's own returned project mandatory, not
// incidental.
// -------------------------------------------------------------------------

test('resolves the scenario against the project the build actually used, not a later, differently-shaped project', async () => {
  const builtProject = { sprites: { actors: [{ name: 'Wolf' }, { name: 'Bat' }] } }; // Bat at id 1
  const liveProject = { sprites: { actors: [{ name: 'Bat' }, { name: 'Wolf' }] } }; // Bat at id 0, post-edit

  // The stakes: resolving the identical remembered name against these two
  // different projects genuinely selects a different ROM entity.
  const viaBuilt = resolveFormation({ formation: ['Bat'] }, builtProject);
  const viaLive = resolveFormation({ formation: ['Bat'] }, liveProject);
  assert.equal(viaBuilt.value.formation[0], 1);
  assert.equal(viaLive.value.formation[0], 0);
  assert.notEqual(viaBuilt.value.formation[0], viaLive.value.formation[0]);

  let resolvedAgainst = null;
  await runReloadTest({
    build: async () => ({ project: builtProject }),
    resolveScenario: (project) => {
      resolvedAgainst = project;
      return { startAt: OK, battleTest: resolveFormation({ formation: ['Bat'] }, project) };
    },
    play: async () => {},
    toast: () => {}
  });

  assert.equal(resolvedAgainst, builtProject, 'must resolve against build()\'s own returned project');
  assert.notEqual(resolvedAgainst, liveProject);
});
