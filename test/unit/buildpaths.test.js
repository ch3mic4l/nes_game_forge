// main/buildpaths.js -- resolveBuildFile, the single check
// build:readRom/build:readSymbols/build:reveal/mesen:launch (main/ipc.js)
// share for a renderer-supplied path, the same shape code:readGenerated
// already checked its own path with.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBuildFile, BuildPathError } from '../../main/buildpaths.js';
import { canonicalizePath, SymlinkLoopError } from '../../main/paths.js';

async function makeProjectWithRom() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-buildpaths-'));
  const buildDir = path.join(dir, 'build');
  await fs.mkdir(buildDir, { recursive: true });
  const romPath = path.join(buildDir, 'game.nes');
  await fs.writeFile(romPath, Buffer.from([1, 2, 3]));
  const symbolPath = path.join(buildDir, 'game.fns');
  await fs.writeFile(symbolPath, 'symbols');
  return { dir, buildDir, romPath, symbolPath };
}

test('happy path: a real file inside build/ with an allowed extension resolves', async (t) => {
  const { dir, romPath } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const resolved = resolveBuildFile(dir, romPath, ['.nes']);
  assert.equal(resolved, romPath);
});

test('a relative path resolves against the project’s own build/ folder', async (t) => {
  const { dir, romPath } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const resolved = resolveBuildFile(dir, 'game.nes', ['.nes']);
  assert.equal(resolved, romPath);
});

test('traversal out of build/ via .. is refused', async (t) => {
  const { dir } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  assert.throws(
    () => resolveBuildFile(dir, '../../../../etc/passwd', ['.nes']),
    (error) => error instanceof BuildPathError && /outside/.test(error.message)
  );
});

test('an absolute path outside the project’s build folder is refused', async (t) => {
  const { dir } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-buildpaths-other-'));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  const outsideFile = path.join(other, 'game.nes');
  await fs.writeFile(outsideFile, 'x');
  assert.throws(
    () => resolveBuildFile(dir, outsideFile, ['.nes']),
    (error) => error instanceof BuildPathError && /outside/.test(error.message)
  );
});

test('a file inside build/ but with a disallowed extension is refused', async (t) => {
  const { dir, buildDir } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const textFile = path.join(buildDir, 'game.txt');
  await fs.writeFile(textFile, 'not a rom');
  assert.throws(
    () => resolveBuildFile(dir, textFile, ['.nes']),
    (error) => error instanceof BuildPathError && /not a file this action may read/.test(error.message)
  );
});

test('a missing or non-string requested path is refused, not treated as build/ itself', async (t) => {
  const { dir } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  assert.throws(() => resolveBuildFile(dir, '', ['.nes']), BuildPathError);
  assert.throws(() => resolveBuildFile(dir, null, ['.nes']), BuildPathError);
  assert.throws(() => resolveBuildFile(dir, undefined, ['.nes']), BuildPathError);
});

test('a symlinked project directory resolves through its real path (cheap symlink coverage)', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const { dir, romPath } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const linkPath = path.join(os.tmpdir(), `forge-buildpaths-link-${process.pid}-${Date.now()}`);
  fsSync.symlinkSync(dir, linkPath);
  t.after(() => fs.rm(linkPath, { force: true }));

  // The project dir is named via the symlink, but the requested file is
  // named via the real path -- these must be recognised as the same
  // location, not refused as "outside" because the two spellings differ
  // textually.
  const resolved = resolveBuildFile(linkPath, romPath, ['.nes']);
  assert.equal(resolved, romPath);
});

// ------------------------------------------------ review-fix slice A round 2, item 4

test('item 4a: a symlink planted INSIDE build/ that points outside the project is refused, not followed', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const { dir, buildDir } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-buildpaths-outside-'));
  t.after(() => fs.rm(outsideDir, { recursive: true, force: true }));
  const secretFile = path.join(outsideDir, 'secret.nes');
  await fs.writeFile(secretFile, 'top secret rom bytes');

  // The symlink's own path (linkInsideBuild) lies lexically inside build/,
  // which is exactly what let the old, projectDir-only canonicalization
  // pass it through -- only realpath-ing the requested file too reveals
  // that it actually points outside.
  const linkInsideBuild = path.join(buildDir, 'sneaky.nes');
  fsSync.symlinkSync(secretFile, linkInsideBuild);

  assert.throws(
    () => resolveBuildFile(dir, linkInsideBuild, ['.nes']),
    (error) => error instanceof BuildPathError && /outside/.test(error.message)
  );
});

test('item 4b: a project dir given via a symlink, with the requested file ALSO spelled through that same alias, still resolves', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const { dir, romPath } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const linkPath = path.join(os.tmpdir(), `forge-buildpaths-link4b-${process.pid}-${Date.now()}`);
  fsSync.symlinkSync(dir, linkPath);
  t.after(() => fs.rm(linkPath, { force: true }));

  // Unlike the "cheap symlink coverage" test above (project dir aliased,
  // requested file spelled via the REAL path), this is the shape
  // build:run/build:readRom actually produce: romPath is computed from
  // whatever `dir` string the renderer passed to build:run, so if that was
  // the alias, the returned romPath is alias-spelled too -- projectDir and
  // requested consistently share the SAME alias, not a mismatched pair.
  const aliasRomPath = path.join(linkPath, 'build', 'game.nes');
  const resolved = resolveBuildFile(linkPath, aliasRomPath, ['.nes']);
  assert.equal(resolved, romPath, 'must resolve to the real file, not be refused for an alias/real spelling mismatch');
});

// ------------------------------------------------ review-fix slice A round 3, item 4

test('item 4 (round 3): a dangling symlink canonicalizes identically before and after its referent is created', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-dangling-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const linkPath = path.join(dir, 'link');
  const targetPath = path.join(dir, 'target', 'file.txt');
  // Neither 'target/' nor 'target/file.txt' exists yet -- a genuinely
  // dangling symlink, not merely an unresolved intermediate directory.
  fsSync.symlinkSync(targetPath, linkPath);

  const before = canonicalizePath(linkPath);

  await fs.mkdir(path.join(dir, 'target'), { recursive: true });
  await fs.writeFile(targetPath, 'now it exists');

  const after = canonicalizePath(linkPath);

  assert.equal(
    before,
    after,
    'canonicalizing the same dangling symlink before and after its referent exists must yield the identical key -- ' +
      'a plain realpath-with-fallback treats the symlink as merely absent beforehand (keying on its own alias name) ' +
      'and switches to the target spelling the moment realpath can follow it for real'
  );
});

test('item 4 (round 3): a symlink loop throws a named error rather than hanging or overflowing the stack', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-symloop-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const aPath = path.join(dir, 'a');
  const bPath = path.join(dir, 'b');
  fsSync.symlinkSync(bPath, aPath);
  fsSync.symlinkSync(aPath, bPath);

  assert.throws(() => canonicalizePath(aPath), (error) => error instanceof SymlinkLoopError);
});

// ------------------------------------------------ review-fix slice A round 5

// canonicalizePath must apply '..' in FILESYSTEM order (against whatever a
// symlinked component actually resolves to), never lexically against raw
// text -- path.resolve/normalize/join all do the latter, which is wrong the
// moment a '..' follows a symlinked component: `root -> /`, and some other
// path's own text reading `root/../tmp/x/real` must resolve to `/tmp/x/real`
// (walk INTO root, i.e. `/`, THEN apply `..` -- which has no parent, so
// stays at `/`), not to whatever directory happens to textually contain
// "root". This property test builds one real tree covering every shape the
// review named and asserts canonicalizePath agrees with fs.realpathSync,
// byte-for-byte, for every path in it that exists entirely.
test('round 5: canonicalizePath matches fs.realpathSync exactly, over a tree covering every named shape', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-canon-property-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  // Plain real directories, no symlinks at all.
  const realLeaf = path.join(base, 'real', 'a', 'b');
  await fs.mkdir(realLeaf, { recursive: true });

  // A chain of symlinks: chain1 -> chain2 -> chain3 -> real/a/b.
  const chain3 = path.join(base, 'chain3');
  fsSync.symlinkSync(realLeaf, chain3);
  const chain2 = path.join(base, 'chain2');
  fsSync.symlinkSync(chain3, chain2);
  const chain1 = path.join(base, 'chain1');
  fsSync.symlinkSync(chain2, chain1);

  // A RELATIVE target containing '..': from base/sub/relTarget, "../real/a"
  // means "step up out of sub, then into real/a" -- ordinary relative-symlink
  // semantics with no OTHER symlink in the way, unlike the reviewer's case
  // below.
  await fs.mkdir(path.join(base, 'sub'), { recursive: true });
  const relTarget = path.join(base, 'sub', 'relTarget');
  fsSync.symlinkSync(path.join('..', 'real', 'a'), relTarget);

  // An absolute target.
  const absTarget = path.join(base, 'absTarget');
  fsSync.symlinkSync(path.join(base, 'real', 'a', 'b'), absTarget);

  // A symlink straight to the filesystem root.
  const rootLink = path.join(base, 'rootLink');
  fsSync.symlinkSync(path.sep, rootLink);

  const cases = [
    ['real directories, no symlinks', realLeaf],
    ['a chain of symlinks', chain1],
    ['a relative target containing ..', relTarget],
    ['an absolute target', absTarget],
    ['a symlink to the filesystem root', rootLink]
  ];

  for (const [label, target] of cases) {
    const expected = fsSync.realpathSync(target);
    const got = canonicalizePath(target);
    assert.equal(got, expected, `${label}: canonicalizePath(${target}) must equal fs.realpathSync exactly`);
  }

  // Round 6: a REGULAR FILE (not a directory) followed by '..' -- no real
  // filesystem lets a path continue past a plain file, so both the OS's own
  // realpath and canonicalizePath must refuse this the same way (ENOTDIR),
  // not silently resolve it as if 'plain' were an ordinary directory that
  // '..' could step back out of.
  const plainFile = path.join(base, 'plain');
  await fs.writeFile(plainFile, 'a regular file, not a directory');
  const fileTraversalLink = path.join(base, 'fileTraversalLink');
  fsSync.symlinkSync(['plain', '..', 'real', 'a', 'b'].join(path.sep), fileTraversalLink);

  assert.throws(
    () => fsSync.realpathSync.native(fileTraversalLink),
    (error) => error.code === 'ENOTDIR',
    'sanity: the OS’s own realpath must refuse this with ENOTDIR too, or this case is not exercising what it claims to'
  );
  assert.throws(
    () => canonicalizePath(fileTraversalLink),
    (error) => error.code === 'ENOTDIR',
    'canonicalizePath must throw ENOTDIR exactly where fs.realpathSync.native does -- a path continuing past a regular file'
  );
});

// The reviewer's exact case gets its own test, against a DIFFERENT oracle,
// for a reason worth recording rather than hiding: Node's own default
// fs.realpathSync (the pure-JS fallback, not fs.realpathSync.native) shares
// the IDENTICAL bug this whole round exists to fix. Its own source
// (node:fs, function realpathSync) resolves a followed symlink's target
// with `pathModule.resolve(resolvedLink, remaining)` -- the exact same
// lexical-collapse-before-considering-the-next-symlink shape as the
// original, broken canonicalizePath -- and it is empirically confirmable:
// fs.realpathSync(base + '/root/..') (root -> /) returns `base` itself, not
// `/`, while fs.realpathSync.native (the real realpath(3) syscall), the
// `realpath` CLI, and `readlink -f` all agree it is `/`. So fs.realpathSync
// is not a trustworthy oracle for THIS specific shape (a `..` immediately
// following a symlink whose target is `/`) -- using it here would make a
// reverted, buggy canonicalizePath pass by agreeing with an equally buggy
// oracle. fs.realpathSync.native has no such bug (it IS the OS's own
// answer), so that is the oracle for this one test.
test('round 5: the reviewer’s exact case (root -> /, alias -> root/../<real>) matches the OS’s own realpath, not Node’s buggy pure-JS fs.realpathSync', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-canon-reviewer-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.mkdir(path.join(base, 'real'), { recursive: true });

  const root = path.join(base, 'root');
  fsSync.symlinkSync(path.sep, root);
  // Built by hand (not path.join) so the '..' survives unresolved in the
  // text actually stored by symlinkSync -- path.join would normalize it
  // away before it ever reached disk, proving nothing.
  const baseWithoutLeadingSep = base.startsWith(path.sep) ? base.slice(path.sep.length) : base;
  const rawAliasTarget = ['root', '..', baseWithoutLeadingSep, 'real'].join(path.sep);
  const alias = path.join(base, 'alias');
  fsSync.symlinkSync(rawAliasTarget, alias);

  const nativeExpected = fsSync.realpathSync.native(alias);
  // fs.realpathSync's own bug does not merely disagree here -- its own
  // internal miscollapse builds a doubly-nested, genuinely nonexistent path
  // (base/tmp/<base's own name again>/real), so it actually THROWS ENOENT
  // rather than returning a wrong string. Either outcome (throws, or
  // returns something other than the OS's own answer) confirms this
  // scenario really trips Node's bug; the assertion accepts both so it
  // keeps working regardless of which one an assertion library / Node
  // version happens to produce.
  let buggyNodeThrew = false;
  let buggyNodeAnswer = null;
  try {
    buggyNodeAnswer = fsSync.realpathSync(alias);
  } catch {
    buggyNodeThrew = true;
  }
  assert.ok(
    buggyNodeThrew || buggyNodeAnswer !== nativeExpected,
    'sanity: fs.realpathSync must actually diverge from fs.realpathSync.native here (by throwing or by disagreeing) -- otherwise this test is not exercising Node’s own bug'
  );
  assert.equal(nativeExpected, path.join(base, 'real'), 'sanity: the OS’s own answer really is base/real');

  const got = canonicalizePath(alias);
  assert.equal(got, nativeExpected, 'canonicalizePath must match the true filesystem resolution, not Node’s own buggy pure-JS approximation of it');
});

test('round 5: the dangling variant of the reviewer’s "root -> /, .. through a symlink" case canonicalizes identically before and after the referent exists', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-canon-dangling-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  const root = path.join(base, 'root');
  fsSync.symlinkSync(path.sep, root);

  // alias's target text walks root -> / -> .. (stays at /) -> back into
  // base's own tail -> 'real', which does NOT exist yet at all (neither the
  // 'real' directory nor anything under it).
  const baseWithoutLeadingSep = base.startsWith(path.sep) ? base.slice(path.sep.length) : base;
  const rawAliasTarget = ['root', '..', baseWithoutLeadingSep, 'real'].join(path.sep);
  const alias = path.join(base, 'alias');
  fsSync.symlinkSync(rawAliasTarget, alias);

  const before = canonicalizePath(alias);

  await fs.mkdir(path.join(base, 'real'), { recursive: true });

  const after = canonicalizePath(alias);

  assert.equal(
    before,
    after,
    'the key must be identical whether the referent (base/real) existed yet or not -- otherwise two saves through this ' +
      'alias, one before and one after the directory is created, would land in two different queue slots'
  );
  assert.equal(after, fsSync.realpathSync(path.join(base, 'real')), 'sanity: the resolved key really is the real directory once it exists');
});

test('round 5: an inside-build symlink whose OWN target uses .. to escape is refused by resolveBuildFile', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const { dir, buildDir } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-buildpaths-escape-'));
  t.after(() => fs.rm(outsideDir, { recursive: true, force: true }));
  const secretFile = path.join(outsideDir, 'secret.nes');
  await fs.writeFile(secretFile, 'top secret rom bytes');

  // The symlink itself lives inside build/ (lexically passes containment),
  // but its own target text is a RELATIVE path built with '..' that walks
  // back out of build/ and across to the outside directory -- the same
  // shape as item 4a's absolute-target symlink, but this time the escape is
  // spelled with '..' rather than an absolute path, which is exactly what a
  // lexical-collapse-first canonicalization (this whole round's own bug)
  // would get wrong in the OPPOSITE direction: it could just as easily
  // under-collapse and miss a real escape as over-collapse and manufacture
  // a fake one.
  const relativeEscape = path.relative(buildDir, secretFile); // e.g. "../../forge-buildpaths-escape-XXXX/secret.nes"
  const linkInsideBuild = path.join(buildDir, 'escape.nes');
  fsSync.symlinkSync(relativeEscape, linkInsideBuild);

  assert.throws(
    () => resolveBuildFile(dir, linkInsideBuild, ['.nes']),
    (error) => error instanceof BuildPathError && /outside/.test(error.message)
  );
});

// ------------------------------------------------ review-fix slice A round 6

test('round 6: resolveBuildFile refuses all three reviewer shapes (a symlink traversing through a regular file) with ENOTDIR', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const { dir, buildDir } = await makeProjectWithRom();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const plainFile = path.join(buildDir, 'plain');
  await fs.writeFile(plainFile, 'a regular file, not a directory');

  // Each shape's own target text (relative, stored verbatim by symlinkSync,
  // never normalized): 'plain' resolves to a real, existing regular file,
  // and every one of these then tries to keep walking past it.
  const shapes = [
    ['plain/../game.nes', ['plain', '..', 'game.nes'].join(path.sep)],
    ['plain/sub/../../game.nes', ['plain', 'sub', '..', '..', 'game.nes'].join(path.sep)],
    ['game.nes/ (trailing separator after a regular file)', 'game.nes' + path.sep]
  ];

  for (const [label, targetText] of shapes) {
    const linkPath = path.join(buildDir, `shape-${shapes.findIndex(([l]) => l === label)}.nes`);
    fsSync.symlinkSync(targetText, linkPath);

    assert.throws(
      () => fsSync.realpathSync.native(linkPath),
      (error) => error.code === 'ENOTDIR',
      `${label}: sanity -- the OS’s own realpath must refuse this with ENOTDIR too`
    );
    assert.throws(
      () => resolveBuildFile(dir, linkPath, ['.nes']),
      (error) => error.code === 'ENOTDIR',
      `${label}: resolveBuildFile must refuse with ENOTDIR, not silently hand back a different, valid file`
    );
  }
});

test('round 6 control: a symlink to a REAL DIRECTORY with a trailing separator still resolves normally', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-canon-trailingdir-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const realDir = path.join(dir, 'realdir');
  await fs.mkdir(realDir, { recursive: true });
  const link = path.join(dir, 'link');
  // Trailing separator, but 'realdir' really is a directory -- must NOT be
  // refused the way the regular-file shapes above are.
  fsSync.symlinkSync('realdir' + path.sep, link);

  const expected = fsSync.realpathSync(realDir);
  assert.equal(canonicalizePath(link), expected);
});
