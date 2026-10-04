// A build root that compacts a scene's actor definitions (test/lua/sw_compact_actors.mjs) just before the project is built.
//
// `runManifest`/`buildScene` build whatever `root` supplies (`root/shared/project.js`, `root/main/build/pipeline.js`) and run the scene's art
// assertions BEFORE the build; the harness files are provenance-pinned (test/fixtures/streambound-curve.json pins their hash), so the compaction
// cannot be a harness option. `compactRoot(realRoot)` returns a directory holding a COPY of every `main/build` file of `realRoot` -- real files, never
// symlinks, so that `generatorHash` (sw_provenance.mjs `walk()` only reads real files) hashes the actual generator bytes under stable logical names
// (review 1 finding 7: with symlinked files only the wrapper was hashed, ten generator modules were not, so a change behind them left the hash alone).
// The one difference is `main/build/pipeline.js`: a wrapper whose `buildProject` compacts a COPY of the project (the scene's own, already asserted,
// project is untouched) and then calls the copy of the real pipeline, `pipeline.real.js`. The compactor (sw_compact_actors.mjs) is copied in beside it,
// so its bytes are hashed too. The wrapper holds no absolute path. `engine/` and `shared/` stay directory symlinks (their files are read through the
// directory, so they are hashed and fingerprinted as the real tree's own files).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const made = new Map();
let hooked = false;

export function compactRoot(realRoot) {
  const real = path.resolve(realRoot);
  if (made.has(real)) return made.get(real);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-compact-root-'));
  fs.symlinkSync(path.join(real, 'engine'), path.join(dir, 'engine'));
  fs.symlinkSync(path.join(real, 'shared'), path.join(dir, 'shared'));
  const build = path.join(dir, 'main', 'build');
  fs.mkdirSync(path.join(dir, 'main'), { recursive: true });
  fs.cpSync(path.join(real, 'main', 'build'), build, { recursive: true, dereference: true });
  fs.renameSync(path.join(build, 'pipeline.js'), path.join(build, 'pipeline.real.js'));
  fs.copyFileSync(path.join(HERE, 'sw_compact_actors.mjs'), path.join(build, 'sw_compact_actors.mjs'));
  fs.writeFileSync(path.join(build, 'pipeline.js'), [
    "import * as real from './pipeline.real.js';",
    "import { compactActors } from './sw_compact_actors.mjs';",
    "export * from './pipeline.real.js';",
    'export async function buildProject({ project, ...rest }) {',
    '  const compacted = structuredClone(project);',
    '  compactActors(compacted);',
    '  return real.buildProject({ ...rest, project: compacted });',
    '}',
    ''
  ].join('\n'));
  made.set(real, dir);
  if (!hooked) {
    hooked = true;
    process.on('exit', () => { for (const d of made.values()) fs.rmSync(d, { recursive: true, force: true }); });
  }
  return dir;
}
