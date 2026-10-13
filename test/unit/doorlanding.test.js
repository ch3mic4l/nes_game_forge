// A door placed in the Map Forge carries `props: {}` -- store.commit never normalizes -- so the
// project the Build Forge hands to build:run lacks toX/toY, while the same project saved and
// reopened carries the normalizeEntity defaults. buildProject must build both to the same ROM.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { DOOR_LANDING_DEFAULT } from '../../shared/project.js';

const sampleDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'sample');
const ENTITY_RECORD = 9; // actor, x, y, target, toX, toY, event, trigger, hideSwitch
const TO_X = 4; // byte offsets inside a record, from main/build/generate.js's entity bytes
const TO_Y = 5;

async function placeDoor() {
  const project = await loadProject(sampleDir);
  const actorId = project.sprites.actors.findIndex((actor) => actor.behavior === 'door');
  assert.ok(actorId >= 0, 'the sample has a door actor');
  const screen = project.maps[0].screens[0];
  // Exactly what the Map Forge's 'Place actor' commit appends.
  screen.entities.push({ actorId, x: 16, y: 16, props: {} });
  return { project, index: screen.entities.length - 1 };
}

// The last record of screen 0's entity table, read from the generated asset rather than a ROM offset.
function lastRecord(dir, count) {
  const inc = fs.readFileSync(path.join(dir, 'build', 'assets', 'screens.inc'), 'utf8');
  const block = /^screen_0_ent:\n((?:\s+\.db .*\n)+)/m.exec(inc);
  assert.ok(block, 'screen 0 has an entity table');
  const bytes = [...block[1].matchAll(/\$([0-9A-F]{2})/g)].map((m) => parseInt(m[1], 16));
  const at = 1 + (count - 1) * ENTITY_RECORD; // the table opens with its entity count
  return bytes.slice(at, at + ENTITY_RECORD);
}

async function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-doorlanding-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a door placed this session builds the same ROM as after save and reopen, landing at 112,112', async () => {
  await withTemp(async (dir) => {
    const { project, index } = await placeDoor();
    await saveProject(dir, project);

    // The Build Forge's call: the in-memory project, never normalized.
    assert.deepEqual(project.maps[0].screens[0].entities[index].props, {});
    await buildProject({ dir, project, log: () => {} });
    const held = fs.readFileSync(path.join(dir, 'build', 'game.nes'));
    const heldRecord = lastRecord(dir, index + 1);

    const reopened = await loadProject(dir);
    await buildProject({ dir, project: reopened, log: () => {} });
    const after = fs.readFileSync(path.join(dir, 'build', 'game.nes'));
    const reopenedRecord = lastRecord(dir, index + 1);

    assert.equal(DOOR_LANDING_DEFAULT, 112);
    assert.deepEqual([heldRecord[TO_X], heldRecord[TO_Y]], [112, 112], 'the held project lands at the default');
    assert.deepEqual([reopenedRecord[TO_X], reopenedRecord[TO_Y]], [112, 112]);
    assert.ok(held.equals(after), 'the ROM does not depend on whether the project was reopened');
  });
});

test('buildProject does not mutate the project it is handed', async () => {
  await withTemp(async (dir) => {
    const { project } = await placeDoor();
    await saveProject(dir, project);
    const before = structuredClone(project);
    await buildProject({ dir, project, log: () => {} });
    assert.deepEqual(project, before);
  });
});

test('a streamed map builds the same ROM for a held and a reopened landing-less entity', async () => {
  await withTemp(async (dir) => {
    const { createStreamedProject } = await import('../lib/streamedproject.js');
    const project = createStreamedProject();
    // Every placed entity carries a landing record, door or not (an NPC's is just never read).
    const actorId = project.sprites.actors.length; // createProject ships zero actors
    project.sprites.actors.push({ name: 'Mover', behavior: 'npc', hp: 1, damage: 0 });
    project.maps[0].screens[0].entities.push({ actorId, x: 16, y: 16, props: {} });
    await saveProject(dir, project);

    await buildProject({ dir, project, log: () => {} });
    const held = fs.readFileSync(path.join(dir, 'build', 'game.nes'));
    await buildProject({ dir, project: await loadProject(dir), log: () => {} });
    const after = fs.readFileSync(path.join(dir, 'build', 'game.nes'));
    assert.ok(held.equals(after));
  });
});
