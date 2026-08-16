// renderer/forges/map/events.js's own pure helpers, outside the modal UI they
// back.

import test from 'node:test';
import assert from 'node:assert/strict';

import { stripEmptyBattles } from '../../renderer/forges/map/events.js';

test('an empty Start a battle command is dropped, wherever it is nested', () => {
  const commands = [
    { op: 'battle', monsters: [] },
    { op: 'battle', monsters: [3] },
    {
      op: 'branch',
      then: [{ op: 'battle', monsters: [] }],
      else: [{ op: 'battle', monsters: [4] }]
    },
    {
      op: 'choice',
      options: [{ commands: [{ op: 'battle', monsters: [] }] }, { commands: [{ op: 'say', text: 'Hi.' }] }]
    }
  ];
  const stripped = stripEmptyBattles(commands);
  assert.deepEqual(
    stripped.map((c) => c.op),
    ['battle', 'branch', 'choice']
  );
  assert.deepEqual(stripped[1].then, []);
  assert.equal(stripped[1].else.length, 1);
  assert.deepEqual(stripped[2].options[0].commands, []);
  assert.equal(stripped[2].options[1].commands.length, 1);
});

test('a switched-off empty battle command survives — the toggle is not a delete', () => {
  const commands = [
    { op: 'battle', monsters: [], off: true },
    { op: 'battle', monsters: [] }
  ];
  const stripped = stripEmptyBattles(commands);
  assert.equal(stripped.length, 1, 'only the enabled, genuinely empty one should go');
  assert.equal(stripped[0].off, true);
  assert.deepEqual(stripped[0].monsters, []);
});

test('a switched-off branch is returned untouched, not recursed into', () => {
  const commands = [
    {
      op: 'branch',
      off: true,
      then: [{ op: 'battle', monsters: [] }],
      else: []
    }
  ];
  const stripped = stripEmptyBattles(commands);
  assert.equal(stripped.length, 1);
  assert.equal(stripped[0].off, true);
  // The exact same object the compiler would also skip over, not a copy with
  // its insides quietly rewritten.
  assert.equal(stripped[0], commands[0]);
  assert.deepEqual(stripped[0].then, [{ op: 'battle', monsters: [] }]);
});
