// Builds each checked-in fixture from a mkdtemp COPY (never in place) and prints game.nes SHA-256 (the ring gate stamps these into every certificate).
// usage: node test/lua/ring_gate/fixture-hashes.mjs
import { mkdtempSync, cpSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const fixtures = ['sample', 'sample-rpg', 'sample-mmc1', 'sample-mmc3', 'sample-u512', 'sample-rpg-mmc1'];
for (const name of fixtures) {
  const dir = mkdtempSync(join(tmpdir(), `hash-${name}-`));
  cpSync(join(root, name), dir, { recursive: true });
  rmSync(join(dir, 'build'), { recursive: true, force: true });
  execFileSync('node', [join(root, 'main/build/cli.js'), dir], { stdio: 'pipe' });
  const sha = createHash('sha256').update(readFileSync(join(dir, 'build/game.nes'))).digest('hex');
  console.log(`${name}\t${sha}`);
  rmSync(dir, { recursive: true, force: true });
}
