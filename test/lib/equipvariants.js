// The project variants and the build helper test/unit/equipidentity.test.js (and the capture script that
// pinned its hashes on the post-C1b tree) share, so a hash captured on one tree is a hash of exactly the
// project the test builds on another. Every variant is a loadProject() read of a checked-in fixture,
// edited in memory and built from its own mkdtemp directory: no fixture is ever written to.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { reconcileCartridge } from '../../shared/project.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SAMPLE = path.join(ROOT, 'sample');
export const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');

/** The three boards an RPG can run on (switchable PRG and CHR: rpgCapable). */
export const RPG_BOARDS = [
  { id: 1, name: 'MMC1' },
  { id: 4, name: 'MMC3' },
  { id: 30, name: 'UNROM 512' }
];

/**
 * sample-rpg on one board, with Save and in-game naming each on or off. Save is a title screen plus a `save`
 * command in an event (the way the D2 probe made it); naming is every member's `renamable`. `{ save: false,
 * naming: true }` is the fixture exactly as checked in.
 */
export async function rpgVariant({ mapper, save, naming }) {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = mapper;
  for (const member of project.party) member.renamable = Boolean(naming);
  if (save) {
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.maps[0].screens[0].entities.push({
      actorId: 0,
      x: 16,
      y: 16,
      props: {
        event: {
          pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }, { op: 'move', who: 'self', dir: 'up', dist: 16 }] }]
        }
      }
    });
  }
  return project;
}

/** The `sample` action game moved to one board (reconcileCartridge, as the Build panel's board switch does). */
export async function actionVariant({ mapper }) {
  const project = await loadProject(SAMPLE);
  project.cartridge.mapper = mapper;
  reconcileCartridge(project);
  return project;
}

/** Build a project in a fresh mkdtemp directory and return { hash, size } of its ROM. */
export async function buildHash(project) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-equip-id-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const rom = await fs.readFile(built.romPath);
    return { hash: crypto.createHash('sha256').update(rom).digest('hex'), size: rom.length };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
