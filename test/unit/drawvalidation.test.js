// ROADMAP item 8 (validate-as-you-draw), Phase 1: relocations and central
// constants only, no UI -- docs/design-draw-validation.md §7 Phase 1. This
// file covers the pieces that have no home yet beside an existing test file:
// the relocated animFor/resolveActorRestingIcon matrix, the two flat OAM
// constants, the MAX_ITEMS consolidation, and metaspriteKernelBytes' own
// coefficients. resolveItemIcon's pre-existing three-cell coverage
// (test/unit/items.test.js, unchanged by the delegation) and the compiled
// item_metasprite byte-identity for a stale derived reference live beside
// that file's own itemMetaspriteTable helper instead of being duplicated
// here.
//
// Everything here builds its own project via createProject() rather than
// touching `sample/` or any of the other checked-in fixtures, except the
// saveIdentity pin below, which reads all six read-only (loadProject) the
// same way test/unit/kernelbytes.test.js already does, and never writes
// back into any of them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../../main/project-io.js';
import { kernelTableBytes } from '../../main/build/generate.js';
import {
  createProject,
  animFor,
  resolveActorRestingIcon,
  NO_ANIM,
  NO_METASPRITE,
  PLAYER_OAM_ENTRIES,
  MAX_OAM_ENTRIES,
  MAX_ITEMS,
  metaspriteKernelBytes
} from '../../shared/project.js';
import { MAX_ITEMS as SAVE_MAX_ITEMS, saveIdentity } from '../../shared/save.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// --------------------------------------------------------------------------
// Single-writer source assertions -- the playerparts.test.js:380 precedent
// ("main/build/generate.js has no leftover const PLAYER_FRAMES/PLAYER_TILES
// of its own, and imports both from shared/project.js"). A behavioral test
// (the six-fixture byte-identity gate, the delegation-delta proof below)
// cannot distinguish a real delegation from an independent duplicate
// implementation that merely happens to compute the same numbers today --
// only reading the source can. round-one finding 1.
//
// Two orthogonal checks per moved binding, both required: no local
// `function NAME(`/`const NAME`/`let NAME`/`var NAME` redeclaration (an
// arrow-function or re-derived-constant duplicate would drift from
// shared/project.js's own copy exactly as silently as a `function NAME(`
// one would), and the import's own LOCAL binding must be the literal,
// unaliased canonical name. Checking only "the name appears somewhere
// inside the braces" is not enough: `import { NAME as OTHER }` renames the
// binding this file actually uses to `OTHER`, so a tree that imports under
// an alias and then declares its own `const NAME = ...`/`export { OTHER as
// NAME }` would still have "NAME" appear inside the import braces (as the
// EXPORTED name being aliased away) while never truly importing it --
// round-two finding 1's own worked example for shared/save.js.
// --------------------------------------------------------------------------

function assertNoLocalDeclaration(text, name, label) {
  assert.doesNotMatch(
    text,
    new RegExp(`\\bfunction\\s+${name}\\s*\\(`),
    `${label} must not declare its own local function ${name} -- that would silently drift from shared/project.js’s own copy`
  );
  for (const kind of ['const', 'let', 'var']) {
    assert.doesNotMatch(
      text,
      new RegExp(`\\b${kind}\\s+${name}\\b`),
      `${label} must not declare its own local ${kind} ${name} -- that would silently drift from shared/project.js’s own copy`
    );
  }
}

function assertUnaliasedImport(text, fromPattern, name, label) {
  // `[^}]*` rather than `[\s\S]*?`: a named-import specifier list cannot
  // itself contain a `}`, so this cannot cross into a LATER import
  // statement's own braces the way a lazy `[\s\S]*?` starting from an
  // earlier, unrelated `import {` in the same file would -- exactly the
  // false failure a file with more than one import statement before this
  // one hits otherwise (renderer/emulator/battletest.js, importing from
  // shared/enginesyms.js and shared/testoverrides.js before shared/project.js).
  const importMatch = text.match(new RegExp(`import \\{([^}]*)\\} from '${fromPattern}';`));
  assert.ok(importMatch, `expected an import from '${fromPattern}' in ${label}`);
  const specifiers = importMatch[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  assert.ok(
    specifiers.includes(name),
    `${label} must import the unaliased ${name} -- an "${name} as X" or "X as ${name}" alias would defeat a check ` +
      `that only looks for the name somewhere inside the braces (found: ${specifiers.join(', ') || '(none)'})`
  );
}

test('main/build/generate.js defines none of animFor/resolveItemIcon/metaspriteKernelBytes locally, imports each under its own unaliased name from shared/project.js, and kernelTableBytes assigns spriteBytes only through metaspriteKernelBytes', () => {
  const text = fs.readFileSync(path.join(ROOT, 'main/build/generate.js'), 'utf8');
  for (const name of ['animFor', 'resolveItemIcon', 'metaspriteKernelBytes']) {
    assertNoLocalDeclaration(text, name, 'main/build/generate.js');
    assertUnaliasedImport(text, "\\.\\./\\.\\./shared/project\\.js", name, 'main/build/generate.js');
  }

  // Scoped to kernelTableBytes' own body, not the whole file -- the old
  // inline formula's coefficients (3 * Math.max(1, ...), etc.) legitimately
  // reappear elsewhere in this file for unrelated tables (itemBytes, a few
  // lines below this function), so a whole-file scan would false-positive
  // on those.
  const kernelTableBytesMatch = text.match(/export function kernelTableBytes\(project\) \{[\s\S]*?\n\}\n/);
  assert.ok(kernelTableBytesMatch, 'expected to find the kernelTableBytes function body');
  const body = kernelTableBytesMatch[0];
  assert.doesNotMatch(
    body,
    /3 \* Math\.max\(1, metasprites\.length\)/,
    'the old inline spriteBytes formula must be gone from kernelTableBytes -- its own coefficients now live only in metaspriteKernelBytes'
  );
  assert.match(
    body,
    /const spriteBytes = metaspriteKernelBytes\(project\);/,
    'kernelTableBytes must assign spriteBytes from metaspriteKernelBytes(project), not recompute it inline'
  );
});

test('shared/save.js declares no local MAX_ITEMS and imports the unaliased canonical binding from shared/project.js', () => {
  const text = fs.readFileSync(path.join(ROOT, 'shared/save.js'), 'utf8');
  assertNoLocalDeclaration(text, 'MAX_ITEMS', 'shared/save.js');
  assertUnaliasedImport(text, '\\./project\\.js', 'MAX_ITEMS', 'shared/save.js');
  assert.match(text, /export \{ MAX_ITEMS \};/, 'save.js must re-export the imported MAX_ITEMS under its existing name');
});

test('renderer/emulator/battletest.js and test/unit/battletest.test.js declare no local MAX_ITEMS, and import the unaliased canonical binding from shared/project.js', () => {
  const battletestJs = fs.readFileSync(path.join(ROOT, 'renderer/emulator/battletest.js'), 'utf8');
  assertNoLocalDeclaration(battletestJs, 'MAX_ITEMS', 'renderer/emulator/battletest.js');
  assertUnaliasedImport(battletestJs, "\\.\\./\\.\\./shared/project\\.js", 'MAX_ITEMS', 'renderer/emulator/battletest.js');

  const battletestTest = fs.readFileSync(path.join(ROOT, 'test/unit/battletest.test.js'), 'utf8');
  assertNoLocalDeclaration(battletestTest, 'MAX_ITEMS', 'test/unit/battletest.test.js');
  assertUnaliasedImport(battletestTest, "\\.\\./\\.\\./shared/project\\.js", 'MAX_ITEMS', 'test/unit/battletest.test.js');
});

// --------------------------------------------------------------------------
// animFor -- the three-cell matrix (design §3.5/§7 Phase 1).
// --------------------------------------------------------------------------

test('animFor: a set directional slot wins over idle, even when both are set and differ', () => {
  const actor = { anims: { walkDown: 5, idle: 9 } };
  assert.equal(animFor(actor, 'walkDown'), 5);
});

test('animFor: an unset (null) directional slot falls back to idle, not to NO_ANIM', () => {
  const actor = { anims: { walkDown: null, idle: 9 } };
  assert.equal(animFor(actor, 'walkDown'), 9);
});

test('animFor: neither the slot nor idle set resolves to NO_ANIM', () => {
  const actor = { anims: {} };
  assert.equal(animFor(actor, 'walkDown'), NO_ANIM);
});

// --------------------------------------------------------------------------
// resolveActorRestingIcon -- the exact draw_actor_icon resolver (design §3.6).
// --------------------------------------------------------------------------

test('resolveActorRestingIcon: resolves to walkDown’s own frame 0, not its later frames and not the actor’s largest reachable pose', () => {
  // walkDown has two frames, differently numbered, so an implementation that
  // returns the animation's LAST frame (metasprite 2) instead of its first
  // (metasprite 0) fails this the same way one that reached into walkUp's
  // larger pose (metasprite 1) would.
  const actor = { anims: { walkDown: 0, walkUp: 1 } };
  const animations = [
    { id: 0, frames: [{ metaspriteId: 0 }, { metaspriteId: 2 }] }, // walkDown -- frame 0 is small
    { id: 1, frames: [{ metaspriteId: 1 }] } // walkUp -- larger; must NOT win
  ];
  const metasprites = [
    { tiles: [{}] }, // metasprite 0 (walkDown frame 0): 1 tile
    { tiles: Array(10).fill({}) }, // metasprite 1 (walkUp): 10 tiles
    { tiles: Array(5).fill({}) } // metasprite 2 (walkDown frame 1): 5 tiles
  ];
  assert.equal(
    resolveActorRestingIcon(actor, animations, metasprites),
    0,
    'must report walkDown’s own frame-0 metasprite specifically -- not a later frame of the same animation, and not a larger pose from another facing'
  );
});

test('resolveActorRestingIcon: a zero-frame walkDown animation resolves to metasprite 0, the compiled stub, not NO_METASPRITE', () => {
  const actor = { anims: { walkDown: 0 } };
  const animations = [{ id: 0, frames: [] }];
  assert.equal(resolveActorRestingIcon(actor, animations, []), 0);
});

test('resolveActorRestingIcon: no actor at all resolves to NO_METASPRITE', () => {
  assert.equal(resolveActorRestingIcon(null, [], []), NO_METASPRITE);
});

test('resolveActorRestingIcon: no walkDown and no idle to fall back to resolves to NO_METASPRITE', () => {
  const actor = { anims: {} };
  assert.equal(resolveActorRestingIcon(actor, [], []), NO_METASPRITE);
});

// --------------------------------------------------------------------------
// The stale-derived-frame regression: a metasprite deleted after an
// animation frame was authored to reference it leaves a real, valid, stale
// byte sitting in the project. resolveActorRestingIcon may not reintroduce a
// bounds check that was never in generate.js's own pre-relocation derivation
// branch -- the compiled-byte half of this same regression lives beside
// items.test.js's own itemMetaspriteTable helper. actorRestingIconTiles
// (the one place that DOES need to turn this raw id into a safe tile count)
// is deferred out of this phase along with its own test -- it has no
// production caller until Phase 2's formationSpriteCost, and the design
// keeps it module-private; the raw stale-id behaviour stays adequately
// covered by the test below plus the compiled-byte regression.
// --------------------------------------------------------------------------

test('resolveActorRestingIcon: a stale, out-of-range derived metasprite id is returned raw, never clamped to NO_METASPRITE', () => {
  const actor = { anims: { walkDown: 0 } };
  const animations = [{ id: 0, frames: [{ metaspriteId: 200 }] }]; // metasprite 200 no longer exists
  assert.equal(resolveActorRestingIcon(actor, animations, []), 200);
});

// --------------------------------------------------------------------------
// Central OAM/bag constants (design §3.7) -- plain value pins.
// --------------------------------------------------------------------------

test('PLAYER_OAM_ENTRIES is 4, matching build_oam’s own four fixed OAM records', () => {
  assert.equal(PLAYER_OAM_ENTRIES, 4);
});

test('MAX_OAM_ENTRIES is 64, matching the 256-byte OAM shadow at 4 bytes per hardware sprite', () => {
  assert.equal(MAX_OAM_ENTRIES, 64);
});

test('MAX_ITEMS is 8, the bag’s own physical size (engine/constants.asm)', () => {
  assert.equal(MAX_ITEMS, 8);
});

// --------------------------------------------------------------------------
// MAX_ITEMS consolidation -- shared/project.js is now the one canonical
// declaration; shared/save.js re-exports it under its existing name.
// --------------------------------------------------------------------------

test('shared/save.js’s own MAX_ITEMS is the identical, re-exported binding from shared/project.js', () => {
  assert.equal(SAVE_MAX_ITEMS, MAX_ITEMS);
  assert.equal(SAVE_MAX_ITEMS, 8, 'an import cycle or re-export typo must not leave this undefined');
});

test('saveIdentity is pinned per fixture -- unchanged by relocating MAX_ITEMS into shared/project.js', async () => {
  // Values captured against this same tree before the relocation, with
  // MAX_ITEMS still declared independently in shared/save.js -- the move
  // changes only which file names the value 8, never the value itself, so
  // the hash must land on these exact figures either way.
  const expected = {
    sample: 0xe7d46fb1,
    'sample-rpg': 0x2611f851,
    'sample-mmc1': 0xc3d42152,
    'sample-mmc3': 0xc3d42152,
    'sample-u512': 0xc3d42152,
    'sample-rpg-mmc1': 0xf5950c91
  };
  for (const [fixture, hash] of Object.entries(expected)) {
    const project = await loadProject(path.join(ROOT, fixture));
    assert.equal(saveIdentity(project), hash, `${fixture}’s saveIdentity must not move`);
  }
});

// --------------------------------------------------------------------------
// metaspriteKernelBytes (design §3.11) -- per-coefficient isolation, plus
// kernelTableBytes' own delegation to it.
// --------------------------------------------------------------------------

test('metaspriteKernelBytes: an empty project pays exactly the three max(1, …) floors -- 3 + 3 + 8', () => {
  const project = createProject('Empty', 'action');
  assert.equal(metaspriteKernelBytes(project), 3 + 3 + 8);
});

test('metaspriteKernelBytes: going from 1 to 2 metasprites (same, zero tile count each, so the 4 * sum(tiles.length) term’s own delta is subtracted out) changes the total by exactly 3', () => {
  const project = createProject('Metasprites', 'action');
  project.sprites.metasprites = [{ id: 0, name: 'A', tiles: [] }];
  const before = metaspriteKernelBytes(project);
  project.sprites.metasprites.push({ id: 1, name: 'B', tiles: [] });
  const after = metaspriteKernelBytes(project);
  assert.equal(after - before, 3);
});

test('metaspriteKernelBytes: adding one tile to an existing metasprite changes the total by exactly 4', () => {
  const project = createProject('Tiles', 'action');
  project.sprites.metasprites = [{ id: 0, name: 'A', tiles: [{ tile: 1 }] }];
  const before = metaspriteKernelBytes(project);
  project.sprites.metasprites[0].tiles.push({ tile: 2 });
  const after = metaspriteKernelBytes(project);
  assert.equal(after - before, 4);
});

test('metaspriteKernelBytes: going from 1 to 2 animations (same, zero frame count each, so the 2 * sum(frames.length) term’s own delta is subtracted out) changes the total by exactly 3', () => {
  const project = createProject('Animations', 'action');
  project.sprites.animations = [{ id: 0, name: 'A', loop: true, frames: [] }];
  const before = metaspriteKernelBytes(project);
  project.sprites.animations.push({ id: 1, name: 'B', loop: true, frames: [] });
  const after = metaspriteKernelBytes(project);
  assert.equal(after - before, 3);
});

test('metaspriteKernelBytes: adding one frame to an existing animation changes the total by exactly 2', () => {
  const project = createProject('Frames', 'action');
  project.sprites.animations = [{ id: 0, name: 'A', loop: true, frames: [{ metaspriteId: 0 }] }];
  const before = metaspriteKernelBytes(project);
  project.sprites.animations[0].frames.push({ metaspriteId: 0 });
  const after = metaspriteKernelBytes(project);
  assert.equal(after - before, 2);
});

test('metaspriteKernelBytes: going from 1 to 2 actors changes the total by exactly 8, not the metasprite or animation coefficient', () => {
  const project = createProject('Actors', 'action');
  project.sprites.actors = [{ id: 0, name: 'A', behavior: 'patroller', speed: 1, hp: 1, anims: {} }];
  const before = metaspriteKernelBytes(project);
  project.sprites.actors.push({ id: 1, name: 'B', behavior: 'patroller', speed: 1, hp: 1, anims: {} });
  const after = metaspriteKernelBytes(project);
  assert.equal(after - before, 8);
});

test('kernelTableBytes delegates its own spriteBytes term to metaspriteKernelBytes -- adding a tile moves tableBytes by exactly 4', async () => {
  const project = await loadProject(path.join(ROOT, 'sample'));
  const before = kernelTableBytes(project).tableBytes;
  project.sprites.metasprites[0].tiles.push({ ...project.sprites.metasprites[0].tiles[0] });
  const after = kernelTableBytes(project).tableBytes;
  assert.equal(after - before, 4, 'an extraction that never wires kernelTableBytes to call metaspriteKernelBytes would leave this delta at 0');
});
