// Resolves a path the renderer names against one specific project's own build
// folder. code:readGenerated (main/ipc.js) already checks its own path this
// way; build:readRom, build:readSymbols, build:reveal and mesen:launch did
// not, and trusted whatever path arrived over IPC outright -- this is that
// same check, pulled out so all four channels can share exactly one
// implementation of it (main/ipc.js's own `activeProjectDir` is what supplies
// `projectDir`).
//
// A pure module -- no Electron import, no other project state -- so it can
// be unit-tested directly with node:test the way main/build/buildgate.js
// already is.

import path from 'node:path';
import { canonicalizePath } from './paths.js';

export class BuildPathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildPathError';
  }
}

/**
 * Resolve `requested` (relative or absolute -- every real caller today
 * passes an absolute path handed back by a previous build:run, but nothing
 * here requires that) against `projectDir`'s own build/ folder. Throws a
 * BuildPathError, naming what was wrong, for anything that resolves outside
 * that folder or does not carry one of `allowedExtensions`; otherwise returns
 * the resolved, absolute path.
 *
 * Both `projectDir` and `requested` are canonicalized, not just the former:
 * canonicalizing the project dir alone still lets a symlink planted *inside*
 * build/ point outside it (the lexical containment check passes -- the
 * symlink's own path is inside build/ -- and the caller's `fs.readFile`
 * follows it to whatever it really points at), and still wrongly refuses a
 * project opened through a symlinked path whenever the requested file is
 * spelled through that same alias (build:run's own returned romPath is
 * computed from whatever `dir` string the renderer passed, alias included,
 * so `requested` and `projectDir` are consistently alias-spelled together --
 * it is comparing that pair against a *canonicalized* buildDir that breaks).
 * canonicalizePath resolves through every real symlink on both sides, so a
 * malicious in-build symlink resolves to its true, outside target (correctly
 * refused) and a same-alias project dir + requested path resolve to the
 * identical real location (correctly accepted).
 */
export function resolveBuildFile(projectDir, requested, allowedExtensions) {
  if (typeof requested !== 'string' || !requested) {
    throw new BuildPathError('No file was given.');
  }
  const buildDir = canonicalizePath(path.join(projectDir, 'build'));
  const requestedAbsolute = path.resolve(buildDir, requested);
  const resolved = canonicalizePath(requestedAbsolute);
  if (resolved !== buildDir && !resolved.startsWith(buildDir + path.sep)) {
    throw new BuildPathError(`"${requested}" is outside the project's build folder.`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    throw new BuildPathError(
      `"${requested}" is not a file this action may read (expected ${allowedExtensions.join(' or ')}).`
    );
  }
  return resolved;
}
