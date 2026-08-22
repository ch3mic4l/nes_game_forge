// The isLive-gated read sequence behind mounting a player
// (shared/playsession.js, ROADMAP item 3's "Reload the ROM" bullet). Every
// read is a controllable stub here so each of the four checkpoints -- after
// readRom, after readSymbols, after readConstants, after readConfig -- can
// be proven independently: flip isLive() to false from *inside* the read
// that checkpoint follows (guaranteeing every earlier checkpoint already
// passed, since preparePlaySession could only have reached this read by
// passing them, and guaranteeing the flip lands before that checkpoint's
// own check runs, since the read's own return is what the check waits on)
// and confirm nothing past that point runs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePlaySession } from '../../shared/playsession.js';

/** Every read defaults to an immediately-resolved, successful stub; a test
 * overrides only the one(s) it cares about. */
function reads(overrides = {}) {
  return {
    readRom: async () => ({ ok: true, value: 'rom-bytes' }),
    readSymbols: async () => ({ ok: true, value: { main: 0x8000 } }),
    readConstants: async () => ({ ok: true, value: 'player_hp = $4E' }),
    readConfig: async () => ({ ok: true, value: 'NUM_VARIABLES = 16\nBATTLE_ENABLED = 0' }),
    ...overrides
  };
}

test('a successful sequence returns the ROM, parsed symbols/ram, and derived config fields', async () => {
  const result = await preparePlaySession(reads());
  assert.equal(result.ok, true);
  assert.equal(result.rom, 'rom-bytes');
  assert.deepEqual(result.symbols, { main: 0x8000 });
  assert.equal(result.ram.player_hp, 0x4e);
  assert.equal(result.numVariables, 16);
  assert.equal(result.battleEnabled, false);
  assert.equal(result.constantsWarning, null);
});

test('a failed readRom stops the sequence and reports a reason to toast', async () => {
  const result = await preparePlaySession(reads({ readRom: async () => ({ ok: false, error: 'disk gone' }) }));
  assert.deepEqual(result, { ok: false, reason: 'disk gone' });
});

test('a failed readConstants does not stop the sequence -- it is reported as a warning, not a failure', async () => {
  const result = await preparePlaySession(reads({ readConstants: async () => ({ ok: false, error: 'not generated yet' }) }));
  assert.equal(result.ok, true);
  assert.equal(result.ram, null);
  assert.equal(result.constantsWarning, 'not generated yet');
});

test('isLive() false throughout still lets readRom run once -- the first checkpoint is after it, not before', async () => {
  let romCalled = false;
  const result = await preparePlaySession(
    reads({
      readRom: async () => {
        romCalled = true;
        return { ok: true, value: 'x' };
      },
      isLive: () => false
    })
  );
  assert.deepEqual(result, { ok: false });
  assert.equal(romCalled, true, 'sanity: the stub itself is reachable -- isLive is checked after the read, not instead of it');
});

test('isLive() flipped false by readRom stops the sequence before readSymbols ever runs', async () => {
  let live = true;
  let symbolsCalled = false;
  const result = await preparePlaySession(
    reads({
      readRom: async () => {
        live = false;
        return { ok: true, value: 'x' };
      },
      readSymbols: async () => {
        symbolsCalled = true;
        return { ok: true, value: {} };
      },
      isLive: () => live
    })
  );
  assert.deepEqual(result, { ok: false });
  assert.equal(symbolsCalled, false, 'a session already known to be gone must not keep reading');
});

test('isLive() flipped false by readSymbols stops the sequence before readConstants ever runs', async () => {
  let live = true;
  let constantsCalled = false;
  const result = await preparePlaySession(
    reads({
      readSymbols: async () => {
        live = false; // flips only once readRom's own checkpoint has already passed
        return { ok: true, value: {} };
      },
      readConstants: async () => {
        constantsCalled = true;
        return { ok: true, value: '' };
      },
      isLive: () => live
    })
  );
  assert.deepEqual(result, { ok: false });
  assert.equal(constantsCalled, false, 'a checkpoint that already saw isLive() go false must not let a later read run');
});

test('isLive() flipped false by readConstants stops the sequence before readConfig ever runs', async () => {
  let live = true;
  let configCalled = false;
  const result = await preparePlaySession(
    reads({
      readConstants: async () => {
        live = false;
        return { ok: true, value: 'player_hp = $4E' };
      },
      readConfig: async () => {
        configCalled = true;
        return { ok: true, value: '' };
      },
      isLive: () => live
    })
  );
  assert.deepEqual(result, { ok: false });
  assert.equal(configCalled, false);
});

test('isLive() flipped false by readConfig still stops the sequence, even on the very last read', async () => {
  let live = true;
  const result = await preparePlaySession(
    reads({
      readConfig: async () => {
        live = false;
        return { ok: true, value: 'NUM_VARIABLES = 16' };
      },
      isLive: () => live
    })
  );
  assert.deepEqual(result, { ok: false }, 'the last read is not exempt -- mounting still must not happen once the world is gone');
});
