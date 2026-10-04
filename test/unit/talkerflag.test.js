// Phase 3a slice S3b, step A.1: TALKER_ENABLED (the talker bookkeeping of a scripted Move that may cross a seam)
// and its allowances are one predicate, projectUsesTalker -- a streamed map AND a Move anywhere in the project,
// an NPC-only Move included (the plan's X = U and M). The expected value of every shape is the hand-written
// TRUTH below, not computed from the predicate it checks. The allowances are 0 until the behaviour lands (step C);
// kernelbytes.test.js's supplement equality tests hold the sum to nesasm's real bytes, so a talker routine
// assembled behind a stale 0 fails there.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { SHAPES, buildShapeProject } from '../lib/identityshapes.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// Hand-written: 'on' = a streamed map and a Move somewhere (the same six rows per game type as S3a's delegation).
const ON = new Set([
  'move-player-ord', 'move-player-str', 'U-A+move-npc+text', 'U-noA+move-npc', 'move-player-ord+turn+text', 'move-player-str+turn+text+visible'
]);

test('TALKER_ENABLED is 1 exactly on the rows with a streamed map and a Move, and 0 elsewhere', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const seen = { on: 0, off: 0 };
  for (const shape of SHAPES) {
    const want = ON.has(shape.id.slice(shape.id.indexOf(':') + 1)) ? 1 : 0;
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-talkerflag-'));
    try {
      const project = buildShapeProject(shape.desc);
      await saveProject(dir, project);
      await buildProject({ dir, project, log: () => {} });
      const cfg = fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8');
      const m = cfg.match(/^TALKER_ENABLED\s*=\s*(\d+)/m);
      assert.ok(m, `${shape.id}: config.inc must define TALKER_ENABLED`);
      assert.equal(Number(m[1]), want, `${shape.id}: TALKER_ENABLED`);
      seen[want ? 'on' : 'off']++;
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
  assert.equal(seen.on, 12, 'six rows per game type are on');
  assert.ok(seen.off > 0);
});
