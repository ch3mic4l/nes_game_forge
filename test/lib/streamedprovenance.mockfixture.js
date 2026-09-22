// A node:test file run only as a CHILD PROCESS, under `--experimental-test-module-mocks`, by
// streamedlayout.test.js's own "constant provenance" case (phase 2 slice 1, brief sabotage 4).
// Not matched by package.json's "test/unit/*.test.js" glob, so plain `npm test` never picks this
// up directly -- it exists to be spawned, not to run standalone under the default runner.
//
// The mechanism: replace shared/streamlayout.js's own module -- every named export preserved,
// one (STREAM_RECORD_BYTES) swapped for a sentinel unreachable by coincidence -- BEFORE generate.js
// is ever imported, so a fresh import of generate.js (and everything it imports, including
// main/build/streamed.js, which reads the same specifier) resolves to the mock. If generate.js's
// config.inc emission genuinely reads the live binding, the sentinel surfaces in the generated
// file; a hand-typed literal (338) would not move, which is exactly the bug a value-only test
// cannot tell apart from the real thing -- this is a provenance check, not a value check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STREAMLAYOUT_PATH = path.join(ROOT, 'shared', 'streamlayout.js');
const GENERATE_PATH = path.join(ROOT, 'main', 'build', 'generate.js');
const PROJECT_PATH = path.join(ROOT, 'shared', 'project.js');

const SENTINEL = 219; // not 338, not any other real streamlayout.js constant -- unreachable by coincidence

test('config.inc\'s STREAM_RECORD_BYTES line tracks a live import of shared/streamlayout.js, not a copied literal', async (t) => {
  const real = await import(STREAMLAYOUT_PATH);
  t.mock.module(STREAMLAYOUT_PATH, {
    namedExports: { ...real, STREAM_RECORD_BYTES: SENTINEL }
  });
  const { generateAssets } = await import(GENERATE_PATH);
  const { createProject, createMap } = await import(PROJECT_PATH);

  const p = createProject('MockProvenance');
  p.maps = [];
  p.cartridge.mapper = 30; // UNROM 512: the only streamCapableFourScreen board
  p.cartridge.mirroring = 'fourscreen';
  p.cartridge.camera = true; // required for any streamed map (Part D item 8)
  const m = createMap(0, 'S');
  m.gridW = 1;
  m.gridH = 1;
  m.streamed = true;
  p.maps.push(m);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamed-provenance-'));
  try {
    await generateAssets({ dir, project: p });
    const inc = fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8');
    assert.match(inc, new RegExp(`STREAM_RECORD_BYTES = ${SENTINEL}\\b`));
    assert.doesNotMatch(inc, /STREAM_RECORD_BYTES = 338\b/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
