// Shared path canonicalization: resolves as much of a path as actually
// exists on disk through realpath (following every symlink along the way),
// and rejoins whatever suffix does not exist yet, unchanged, one component
// at a time. This is what lets two different spellings of the same real
// location -- a symlink and its target, or a path reached through a
// symlinked ancestor directory that has not been created yet -- be
// recognised as identical regardless of which one happened to exist first.
//
// Two call sites share this, deliberately, rather than each growing its own
// realpath-with-fallback: main/buildpaths.js's resolveBuildFile (a symlink
// planted inside build/ pointing outside must be caught even though the
// symlink's own path lies inside; a project opened through a symlinked path
// must still match a request spelled through that same alias) and
// main/project-io.js's save queue key (a directory that does not exist yet
// must still land in the same queue slot once a concurrent save creates it
// through a symlinked ancestor).
//
// realpathSync alone is not enough for either: it throws outright the
// moment any single path segment does not exist, which is the ordinary case
// for a save queue key (the project folder is often being created by the
// very save that is computing the key) and for a build output path (a ROM
// that has not been built yet). path.resolve/path.normalize/path.join alone
// are not enough either, and not merely because they never consult the
// filesystem: WORSE, they collapse a `..` lexically, immediately, against
// whatever text sits in front of it, with no idea whether that text is a
// real directory, a symlink pointing somewhere else entirely, or nothing at
// all. `root -> /`, and some OTHER path's own text reading
// `root/../tmp/x/real` is the case that breaks: on a real filesystem,
// resolving this walks INTO `root` (following the symlink to `/`) and only
// THEN applies `..` -- relative to `/`, which has no parent, so it stays at
// `/` -- landing on `/tmp/x/real`. `path.resolve()` never walks anything; it
// just sees the text "root", then "..", and cancels the pair against each
// other as an ordinary directory-then-parent pair, landing on whatever
// directory contains "root" instead. Two spellings of the identical real
// location (an alias through `root`, and the real path directly) then
// canonicalize to two different strings -- exactly the failure a save queue
// key or a build-folder containment check exists to prevent.
//
// The fix, and the only correct one: walk the path component by component,
// filesystem order (left to right), maintaining a `prefix` that is always
// fully resolved (no symlink, no `..`, no `.` left in it) at every step.
// `..` is applied by asking THIS `prefix` for its own parent (path.dirname),
// never by lexical cancellation against raw text -- which is what makes
// `root/..` correctly consult `root`'s own symlink-ness (by the time `..` is
// reached, `root` has already been walked INTO and resolved to `/`, so `..`
// asks `/` for its parent, not "root"'s own textual neighbour) instead of
// silently discarding it as a string-level artifact.

import path from 'node:path';
import { lstatSync, readlinkSync } from 'node:fs';

export class SymlinkLoopError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SymlinkLoopError';
  }
}

// Round 6 review: a REGULAR FILE is not a directory, and no real filesystem
// lets a path continue past one -- "plain/../game.nes" (plain a regular
// file), "plain/sub/../../game.nes", and "game.nes/" (a trailing separator
// after a regular file) all fail with ENOTDIR against a direct read and
// against fs.realpathSync.native, but the walk below used to happily keep
// going: `..`/`.`/an empty trailing component are all resolved by pure
// string arithmetic against `prefix` (path.dirname, or simply skipped), none
// of which asks whether `prefix` is even a directory in the first place, so
// a resolved-but-non-directory `prefix` was silently treated as fine to walk
// straight through. That let resolveBuildFile resolve a symlink like this to
// some OTHER real file inside build/, entirely bypassing the check it
// exists to be.
export class NotADirectoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotADirectoryError';
    this.code = 'ENOTDIR';
  }
}

// A real loop (a -> b -> a) has no natural bound; an ordinary symlink chain
// is nowhere near this deep, so this exists purely to fail loudly rather
// than hang or blow the real call stack.
const MAX_SYMLINK_HOPS = 40;

/** lstat, or null if the path does not exist -- never used to distinguish
 *  ENOENT from any other error, since every caller here treats "cannot even
 *  stat it" the same way regardless of the specific reason. */
function safeLstat(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

/**
 * Turns `p` into an absolute path by prepending `base` (already absolute)
 * when `p` itself is not -- plain string concatenation, deliberately NOT
 * path.join/path.resolve, both of which would normalize the result and so
 * collapse any `..` in `p` immediately, before walkComponents ever gets a
 * chance to apply it against the real filesystem instead of against raw
 * text. `.`/`..`/repeated separators in the result are all still there,
 * completely unexamined, for the walk to interpret one component at a time.
 */
function makeAbsoluteWithoutCollapsing(p, base) {
  if (path.isAbsolute(p)) return p;
  return base.endsWith(path.sep) ? base + p : base + path.sep + p;
}

export function canonicalizePath(target) {
  return walkComponents(makeAbsoluteWithoutCollapsing(target, process.cwd()), 0);
}

/**
 * Walks `absolutePath` left to right, filesystem order, one component at a
 * time. `prefix` is the loop's own invariant: at every point in the walk it
 * is fully canonical -- realpathSync would return it unchanged -- which is
 * exactly what makes `..` (path.dirname(prefix)) and a relative symlink
 * target (resolved against `prefix`, not against raw text) both correct.
 *
 * Per component:
 * - `.` or empty (a repeated separator) -- skip.
 * - `..` -- step `prefix` up to its own parent. Correct specifically
 *   because `prefix` is already fully resolved at this point: if the
 *   component just walked into was a symlink, `prefix` is already sitting
 *   at that symlink's OWN target, so stepping up steps up from there, not
 *   from the symlink's textual neighbour.
 * - anything else -- lstat `prefix + component`:
 *   - missing entirely (ENOENT/ENOTDIR): nothing below this can exist
 *     either, so every further real component just joins onto `prefix`
 *     unchanged as this same loop continues -- but a LATER `..` must still
 *     be honored (it steps back up this still-being-synthesized prefix),
 *     which is why this does not short-circuit into one bulk join.
 *   - a symlink (dangling or not): read its own target text, make THAT
 *     absolute against `prefix` (not the cwd, and not by path.join --
 *     see makeAbsoluteWithoutCollapsing), and recurse the WHOLE walk on it
 *     from scratch (a fresh call, hop count incremented) -- the result
 *     becomes the new `prefix`, and this walk continues from there with
 *     whatever components remain.
 *   - a real, non-symlink entry: `prefix` becomes this component's own
 *     resolved path, and the walk continues.
 *
 * After EITHER of the last two (something that actually resolved, whether
 * directly or through a symlink), if anything at all remains to walk --
 * including a bare `..`, `.`, or an empty component from a trailing
 * separator, none of which look like they'd "step past" anything -- `prefix`
 * must be a directory, or this throws NotADirectoryError. A component that
 * resolved to a REGULAR FILE is a dead end for anything further: no real
 * filesystem lets `..`/`.`/a trailing `/` walk past one, and letting the
 * string arithmetic do it anyway is exactly how a symlink pointing at
 * "plain/../game.nes" (plain a regular file) used to resolve to game.nes
 * regardless of plain's own real identity.
 */
function walkComponents(absolutePath, hops) {
  const root = path.parse(absolutePath).root;
  const rest = absolutePath.slice(root.length);
  const components = rest.length ? rest.split(path.sep) : [];

  let prefix = root;
  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    if (component === '' || component === '.') continue;
    if (component === '..') {
      prefix = path.dirname(prefix);
      continue;
    }

    const candidate = prefix.endsWith(path.sep) ? prefix + component : prefix + path.sep + component;
    const stat = safeLstat(candidate);

    if (!stat) {
      prefix = candidate;
      continue;
    }

    let resolvedStat = stat;
    if (stat.isSymbolicLink()) {
      if (hops >= MAX_SYMLINK_HOPS) {
        throw new SymlinkLoopError(`Symlink loop resolving "${candidate}" (over ${MAX_SYMLINK_HOPS} hops).`);
      }
      const linkTarget = readlinkSync(candidate);
      const resolvedTarget = makeAbsoluteWithoutCollapsing(linkTarget, prefix);
      prefix = walkComponents(resolvedTarget, hops + 1);
      // `prefix` is now the symlink's own resolved target, a different path
      // than `candidate` -- `stat` (of `candidate` itself) says nothing
      // about it, so it takes a fresh lstat, absent when the target does
      // not fully exist (the ordinary dangling-symlink case, not an error
      // here).
      resolvedStat = safeLstat(prefix);
    } else {
      prefix = candidate;
    }

    const moreToWalk = i < components.length - 1;
    if (moreToWalk && resolvedStat && !resolvedStat.isDirectory()) {
      throw new NotADirectoryError(`ENOTDIR: not a directory, "${prefix}" (resolving "${absolutePath}")`);
    }
  }

  return prefix;
}
