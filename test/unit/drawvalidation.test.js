// ROADMAP item 8 (validate-as-you-draw), Phases 1-2: no UI in either phase --
// docs/design-draw-validation.md §7. Phase 1 covers the pieces that have no
// home yet beside an existing test file: the relocated animFor/
// resolveActorRestingIcon matrix, the two flat OAM constants, the MAX_ITEMS
// consolidation, and metaspriteKernelBytes' own coefficients. resolveItemIcon's
// pre-existing three-cell coverage (test/unit/items.test.js, unchanged by the
// delegation) and the compiled item_metasprite byte-identity for a stale
// derived reference live beside that file's own itemMetaspriteTable helper
// instead of being duplicated here. Phase 2 covers the battle predicate,
// battleSpriteBudget and its three private helpers (§3.10).
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
  metaspriteKernelBytes,
  battleSpriteBudget,
  normalizeProject
} from '../../shared/project.js';
import { MAX_ITEMS as SAVE_MAX_ITEMS, saveIdentity } from '../../shared/save.js';
import { mapperById } from '../../shared/cartridge.js';

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

// --------------------------------------------------------------------------
// battleSpriteBudget (design §3.10) -- the project-wide battle OAM figure.
// battleFormations/touchEncounterFormations/formationSpriteCost are module-
// private (§3.10's own home/call-site table), so every case here goes
// through the exported function alone.
// --------------------------------------------------------------------------

// Pushes a metasprite of `tileCount` tiles, an animation whose walkDown
// frame 0 names it, and an actor whose walkDown resolves to that animation --
// exactly the chain resolveActorRestingIcon/actorRestingIconTiles walk.
// Returns the actor's own array index -- its actorId, per the compiler's
// direct array-index lookup (design §1.2).
function makeMonster(project, tileCount, { battleTile = null, damage = 0 } = {}) {
  const metaspriteId = project.sprites.metasprites.length;
  project.sprites.metasprites.push({
    id: metaspriteId,
    name: `Icon ${metaspriteId}`,
    tiles: Array.from({ length: tileCount }, (_, i) => ({ tile: i, x: 0, y: 0, palette: 0 }))
  });
  const animId = project.sprites.animations.length;
  project.sprites.animations.push({ id: animId, name: `Walk ${animId}`, loop: true, frames: [{ metaspriteId }] });
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({
    id: actorId,
    name: `Monster ${actorId}`,
    behavior: 'patroller',
    speed: 1,
    hp: 1,
    damage,
    anims: { walkDown: animId },
    battle: { battleTile }
  });
  return actorId;
}

// A placed entity carrying an authored event of exactly one page holding
// `commands` -- the entity's own actorId is irrelevant to battleFormations
// (only entity.props.event is walked), so it is fixed at 0.
function eventEntity(commands) {
  return { actorId: 0, x: 0, y: 0, props: { event: { pages: [{ commands }] } } };
}

test('battleSpriteBudget: a hostile placement (damage > 0), named in no battle command and no encounter table, still contributes a one-monster formation of its own resting-icon size -- caught: scanning only scripted battle commands and map encounter tables and never placed entities, the exact false negative this design\'s own inventory found', () => {
  const project = createProject('Hostile placement', 'rpg');
  const actorId = makeMonster(project, 3, { damage: 1 });
  project.maps[0].screens[0].entities.push({ actorId, x: 0, y: 0, props: {} });
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 3);
});

test('battleSpriteBudget: touch-encounter edges -- a hidden hostile placement (hideSwitch set) still contributes, since it draws whenever the switch is off, the default state; a placement whose actorId is past the actor array contributes 0 without throwing -- caught: filtering out hideSwitch placements, or indexing actors[entity.actorId] with no existence guard', () => {
  const hidden = createProject('Hidden hostile', 'rpg');
  const hiddenActorId = makeMonster(hidden, 5, { damage: 1 });
  hidden.maps[0].screens[0].entities.push({ actorId: hiddenActorId, x: 0, y: 0, props: { hideSwitch: 3 } });
  assert.equal(battleSpriteBudget(hidden, mapperById(1)).used, 5);

  const stale = createProject('Stale actorId', 'rpg');
  stale.maps[0].screens[0].entities.push({ actorId: 99, x: 0, y: 0, props: {} }); // no actor at index 99
  assert.doesNotThrow(() => battleSpriteBudget(stale, mapperById(1)));
  assert.equal(battleSpriteBudget(stale, mapperById(1)).used, 0);
});

test('battleSpriteBudget: a map with encounters.rate = 0 and a full actorIds table contributes nothing; the identical map at rate 1 contributes its formation -- caught: reading actorIds.length as the admission test instead of rate, which would wrongly include the rate-0 map since its table is non-empty', () => {
  const project = createProject('Rate gate', 'rpg');
  const actorId = makeMonster(project, 4);
  project.maps[0].encounters = { rate: 0, actorIds: [actorId] };
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 0);
  project.maps[0].encounters.rate = 1;
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 4);
});

test('battleSpriteBudget: a rate-nonzero map\'s four-actor encounter table is charged all four resting icons, not the engine\'s own current 0-3 roll ceiling -- caught: "helpfully" clamping to three to match start_encounter\'s buggy loop, silently under-counting relative to this design\'s own stated decision', () => {
  const project = createProject('Four slots', 'rpg');
  const ids = [1, 2, 3, 4].map((n) => makeMonster(project, n));
  project.maps[0].encounters = { rate: 1, actorIds: ids };
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 1 + 2 + 3 + 4);
});

test('battleSpriteBudget: a monster with block art (battle.battleTile !== null) costs 0 -- battle_draw_sprites only ever draws a no-block-art monster as a sprite -- caught: charging every encounter-table monster regardless of its own battleTile', () => {
  const project = createProject('Block art', 'rpg');
  const artActor = makeMonster(project, 12, { battleTile: 5 });
  project.maps[0].encounters = { rate: 1, actorIds: [artActor] };
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 0);
});

test('battleSpriteBudget: a monster whose down/frame-0 icon (2 tiles) is smaller than its largest reachable pose (10 tiles, walkUp) is charged the icon, not the pose -- caught: reusing actorMaxMetaspriteTiles here instead of actorRestingIconTiles', () => {
  const project = createProject('Icon vs pose', 'rpg');
  const smallId = project.sprites.metasprites.length;
  project.sprites.metasprites.push({ id: smallId, name: 'Small', tiles: [{ tile: 0 }, { tile: 1 }] });
  const bigId = project.sprites.metasprites.length;
  project.sprites.metasprites.push({ id: bigId, name: 'Big', tiles: Array.from({ length: 10 }, (_, i) => ({ tile: i })) });
  const downAnim = project.sprites.animations.length;
  project.sprites.animations.push({ id: downAnim, name: 'Down', loop: true, frames: [{ metaspriteId: smallId }] });
  const upAnim = project.sprites.animations.length;
  project.sprites.animations.push({ id: upAnim, name: 'Up', loop: true, frames: [{ metaspriteId: bigId }] });
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({
    id: actorId,
    name: 'Actor',
    behavior: 'patroller',
    speed: 1,
    hp: 1,
    damage: 0,
    anims: { walkDown: downAnim, walkUp: upAnim },
    battle: { battleTile: null }
  });
  project.maps[0].encounters = { rate: 1, actorIds: [actorId] };
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 2);
});

test('battleSpriteBudget: a monster whose resting frame names a metasprite id past the array\'s own end contributes 0, not a throw -- the deferred stale-icon regression test/unit/items.test.js:632 named for Phase 2 -- caught: indexing metasprites[id].tiles.length directly, without the ?. guard actorRestingIconTiles relies on', () => {
  const project = createProject('Stale icon', 'rpg');
  const animId = project.sprites.animations.length;
  // frame 0 names metasprite 99 -- no such metasprite exists in this project
  project.sprites.animations.push({ id: animId, name: 'Stale', loop: true, frames: [{ metaspriteId: 99 }] });
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({
    id: actorId,
    name: 'Stale actor',
    behavior: 'patroller',
    speed: 1,
    hp: 1,
    damage: 0,
    anims: { walkDown: animId },
    battle: { battleTile: null }
  });
  project.maps[0].encounters = { rate: 1, actorIds: [actorId] };
  assert.doesNotThrow(() => battleSpriteBudget(project, mapperById(1)));
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 0);
});

test('battleSpriteBudget: a battle command nested inside a branch\'s then is counted -- liveCommands recursion, not a top-level-only scan', () => {
  const project = createProject('Nested branch', 'rpg');
  const actorId = makeMonster(project, 5);
  project.maps[0].screens[0].entities.push(
    eventEntity([{ op: 'branch', cond: 'switch', arg: 0, value: true, then: [{ op: 'battle', monsters: [actorId] }], else: [] }])
  );
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 5);
});

test('battleSpriteBudget: a battle command nested inside a choice option is counted -- liveCommands recursion', () => {
  const project = createProject('Nested choice', 'rpg');
  const actorId = makeMonster(project, 6);
  project.maps[0].screens[0].entities.push(
    eventEntity([{ op: 'choice', options: [{ commands: [{ op: 'battle', monsters: [actorId] }] }, { commands: [] }] }])
  );
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 6);
});

test('battleSpriteBudget: a battle command inside a disabled branch is not counted -- caught: walking allCommands instead of liveCommands/compiledPages, which would count a formation the ROM never contains', () => {
  const project = createProject('Disabled branch', 'rpg');
  const actorId = makeMonster(project, 99); // dominant if wrongly counted
  project.maps[0].screens[0].entities.push(
    eventEntity([{ op: 'branch', off: true, then: [{ op: 'battle', monsters: [actorId] }], else: [] }])
  );
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 0);
});

test('battleSpriteBudget: a battle command nested in a common event\'s branch else, reached by no placement at all, is still counted -- caught: scanning project.maps\' placements only and skipping project.commonEvents entirely', () => {
  const project = createProject('Common event battle', 'rpg');
  const actorId = makeMonster(project, 8);
  project.commonEvents.push({
    id: 0,
    name: 'Ambush',
    event: {
      pages: [
        {
          commands: [
            { op: 'branch', cond: 'switch', arg: 0, value: true, then: [], else: [{ op: 'battle', monsters: [actorId] }] }
          ]
        }
      ]
    }
  });
  // Deliberately no `call` command anywhere names this common event -- projectEvents/liveCommonEvents
  // do not require one; a common event compiles into the shared table whenever it has a live page,
  // whether or not any placement currently calls it.
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 8);
});

test('battleSpriteBudget: the MMC3 targeting cursor adds exactly one sprite on a split-font RPG, and is absent on MMC1 -- caught: gating the cursor on gameType alone instead of fontBankSplit, or forgetting the gate entirely', () => {
  const project = createProject('Cursor gate', 'rpg'); // gameType 'rpg' alone makes projectUsesText true
  assert.equal(battleSpriteBudget(project, mapperById(4)).used, 1); // MMC3: cursor only, no monsters, no party art
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 0); // MMC1: no scanlineIrq, no cursor
});

test('battleSpriteBudget: the party sum proves the full matrix -- metaspriteId: null and NO_METASPRITE both contribute 0, and two real members with distinguishable tile counts are BOTH summed, not just one -- caught: a null/NO_METASPRITE id failing to resolve to 0, or an implementation that stops after the first real member instead of reducing over every one', () => {
  const project = createProject('Party matrix', 'rpg');
  const smallIconId = project.sprites.metasprites.length;
  project.sprites.metasprites.push({ id: smallIconId, name: 'Small', tiles: [{ tile: 0 }, { tile: 1 }] }); // 2 tiles
  const bigIconId = project.sprites.metasprites.length;
  project.sprites.metasprites.push({
    id: bigIconId,
    name: 'Big',
    tiles: Array.from({ length: 6 }, (_, i) => ({ tile: i })) // 6 tiles -- distinguishable from Small
  });
  project.party = [
    { ...project.party[0], id: 0, name: 'Null icon', metaspriteId: null },
    { ...project.party[0], id: 1, name: 'Explicit no icon', metaspriteId: NO_METASPRITE },
    { ...project.party[0], id: 2, name: 'Small icon', metaspriteId: smallIconId },
    { ...project.party[0], id: 3, name: 'Big icon', metaspriteId: bigIconId }
  ];
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 2 + 6, 'summing only one real member would give 2 or 6, never 8');
});

test('battleSpriteBudget: the empty action project returns {used: 0, limit: 64}', () => {
  const project = createProject('Empty', 'action');
  assert.deepEqual(battleSpriteBudget(project, mapperById(0)), { used: 0, limit: 64 });
});

test('battleSpriteBudget: the overall figure is the maximum across every reachable formation, not their sum -- caught: summing every formation\'s own cost together, which would count monsters from two mutually-exclusive fights as if they could appear in the same battle', () => {
  const project = createProject('Max not sum', 'rpg');
  const smallActor = makeMonster(project, 3);
  const bigActor = makeMonster(project, 7);
  project.maps[0].screens[0].entities.push(eventEntity([{ op: 'battle', monsters: [smallActor] }]));
  project.maps[0].screens[0].entities.push(eventEntity([{ op: 'battle', monsters: [bigActor] }]));
  assert.equal(battleSpriteBudget(project, mapperById(1)).used, 7, 'summing would wrongly give 10');
});

test('battleSpriteBudget: an action project with a hostile placement returns {used: 0, limit: 64} -- an action build has no battle system at all, entity_contact jumps to hurt_player, never touch_encounter -- the identical project as an RPG counts the placement\'s 3-tile resting icon instead -- caught: no game-type gate', () => {
  const project = createProject('Action hostile', 'action');
  const actorId = makeMonster(project, 3, { damage: 1 });
  project.maps[0].screens[0].entities.push({ actorId, x: 0, y: 0, props: {} });
  assert.deepEqual(battleSpriteBudget(project, mapperById(1)), { used: 0, limit: 64 });

  project.project.gameType = 'rpg';
  const rpgProject = normalizeProject(project); // an RPG always has a party; normalizing gains the default one
  assert.equal(rpgProject.party.length, 1, 'sanity: normalizing must actually have granted a party');
  assert.equal(battleSpriteBudget(rpgProject, mapperById(1)).used, 3);
});
