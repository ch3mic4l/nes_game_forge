// A build root that compacts a scene's actor definitions (test/lua/sw_compact_actors.mjs) just before the project is built.
//
// `runManifest`/`buildScene` build whatever `root` supplies (`root/shared/project.js`, `root/main/build/pipeline.js`) and run the scene's art
// assertions BEFORE the build; the harness files are provenance-pinned (test/fixtures/streambound-curve.json pins their hash), so the compaction
// cannot be a harness option. `compactRoot(realRoot)` returns a directory that is `realRoot` seen through symlinks except for one file:
// `main/build/pipeline.js`, whose `buildProject` compacts a COPY of the project (the scene's own, already asserted, project is untouched) and
// then calls the real one. Everything else -- the engine, the generator, the shared modules -- is the real tree's own file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

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
  fs.mkdirSync(build, { recursive: true });
  for (const e of fs.readdirSync(path.join(real, 'main', 'build'))) if (e !== 'pipeline.js') fs.symlinkSync(path.join(real, 'main', 'build', e), path.join(build, e));
  fs.writeFileSync(path.join(build, 'pipeline.js'), [
    `import * as real from ${JSON.stringify(pathToFileURL(path.join(real, 'main/build/pipeline.js')).href)};`,
    `import { compactActors } from ${JSON.stringify(pathToFileURL(path.join(HERE, 'sw_compact_actors.mjs')).href)};`,
    'export * from ' + JSON.stringify(pathToFileURL(path.join(real, 'main/build/pipeline.js')).href) + ';',
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
