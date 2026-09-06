// ROADMAP item 8 (validate-as-you-draw), Phases 1-4 -- docs/design-draw-
// validation.md §7. Phases 1-3 carry no UI. Phase 1 covers the pieces that
// have no home yet beside an existing test file: the relocated animFor/
// resolveActorRestingIcon matrix, the two flat OAM constants, the MAX_ITEMS
// consolidation, and metaspriteKernelBytes' own coefficients. resolveItemIcon's
// pre-existing three-cell coverage (test/unit/items.test.js, unchanged by the
// delegation) and the compiled item_metasprite byte-identity for a stale
// derived reference live beside that file's own itemMetaspriteTable helper
// instead of being duplicated here. Phase 2 covers the battle predicate,
// battleSpriteBudget and its three private helpers (§3.10). Phase 3 covers
// the field position-aware predicate, fieldScanlineRows/fieldScanlineDensity
// and their private helpers reachablePoses/poseRowCounts/entityRowMax
// (§3.9). Phase 4 covers §3.2's rename of playerSpriteCollisions to
// metaspriteTileCollisions and §3.3's spriteReservedRanges -- both tested
// below against reservedRangeRects' own fixtures (reservedRangeRects itself,
// pure sheet-grid geometry with no project-domain meaning, lives in
// test/unit/sheetgeom.test.js instead, beside the module it tests). §3.1's
// metaspriteScanlineDensity and §3.8's screenSpriteBudget/overlaySpriteBudget
// belong to Phase 5, tested against the message builders and the concrete
// 64/65 boundary fixture, and are left unimplemented by this file.
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
  fieldScanlineRows,
  fieldScanlineDensity,
  normalizeProject,
  LIMITS,
  PLAYER_TILES,
  metaspriteTileCollisions,
  spriteReservedRanges,
  validateProject
} from '../../shared/project.js';
import { MAX_ITEMS as SAVE_MAX_ITEMS, saveIdentity } from '../../shared/save.js';
import { mapperById } from '../../shared/cartridge.js';
import { HEART_FULL_TILE, SPRITE_ARROW_TILE } from '../../shared/font.js';
import { reservedRangeRects } from '../../renderer/widgets/sheetgeom.js';

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

// --------------------------------------------------------------------------
// fieldScanlineRows/fieldScanlineDensity (design §3.9) -- the field position-
// aware predicate. reachablePoses/poseRowCounts/entityRowMax are module-
// private, so every case here goes through the two exported functions alone.
// --------------------------------------------------------------------------

// A metasprite of hand-placed tiles, referenced by no other fixture.
function poseMetasprite(project, tiles) {
  const id = project.sprites.metasprites.length;
  project.sprites.metasprites.push({ id, name: `Pose ${id}`, tiles });
  return id;
}

// A one-frame animation naming `metaspriteId` as its own frame 0 -- enough
// for animFor's own directional resolution and reachablePoses' own nonzero-
// frame branch. The zero-frame branch is not covered by this helper at all
// (every animation it builds has exactly one frame); that case is
// constructed separately, in the edge-branch matrix test below.
function facingAnim(project, metaspriteId) {
  const id = project.sprites.animations.length;
  project.sprites.animations.push({ id, name: `Anim ${id}`, loop: true, frames: [{ metaspriteId }] });
  return id;
}

// An actor carrying exactly the facing anims given (e.g. { walkDown, walkUp }),
// with no other slot set -- so animFor's own idle fallback resolves to
// NO_ANIM for any slot not named here, exactly as reachablePoses expects.
function fieldActor(project, anims) {
  const id = project.sprites.actors.length;
  project.sprites.actors.push({
    id,
    name: `Actor ${id}`,
    behavior: 'patroller',
    speed: 1,
    hp: 1,
    damage: 0,
    anims,
    battle: { battleTile: null }
  });
  return id;
}

test('fieldScanlineDensity: mutually exclusive poses are not summed -- an entity whose walkDown resolves to a 5-tile pose and whose walkUp resolves to a different 5-tile pose, both at the identical local y so they would occupy the same OAM-Y rows if summed, reports a peak of 5, not 10 -- caught: unioning every reachable tile across every pose instead of maxing them', () => {
  const project = createProject('Exclusive poses', 'action');
  const downPose = poseMetasprite(project, Array.from({ length: 5 }, (_, i) => ({ tile: i, x: 0, y: 0, palette: 0 })));
  const upPose = poseMetasprite(project, Array.from({ length: 5 }, (_, i) => ({ tile: i + 10, x: 0, y: 0, palette: 0 })));
  const downAnim = facingAnim(project, downPose);
  const upAnim = facingAnim(project, upPose);
  const actorId = fieldActor(project, { walkDown: downAnim, walkUp: upAnim });
  const screen = project.maps[0].screens[0];
  screen.entities.push({ actorId, x: 0, y: 1, props: {} }); // baseY = 0
  assert.equal(fieldScanlineDensity(project, screen), 5, 'summing both poses would wrongly give 10');
});

test('fieldScanlineDensity: different entities ARE simultaneous -- two placed entities overlapping the same rows, with distinct tile counts (3 and 5), sum to a peak of 8, not 5 -- caught: taking the max across entities the way poses within a single entity are correctly maxed, instead of summing across entities', () => {
  const project = createProject('Sum across entities', 'action');
  const smallPose = poseMetasprite(project, Array.from({ length: 3 }, (_, i) => ({ tile: i, x: 0, y: 0, palette: 0 })));
  const bigPose = poseMetasprite(project, Array.from({ length: 5 }, (_, i) => ({ tile: i + 10, x: 0, y: 0, palette: 0 })));
  const smallAnim = facingAnim(project, smallPose);
  const bigAnim = facingAnim(project, bigPose);
  const smallActorId = fieldActor(project, { walkDown: smallAnim });
  const bigActorId = fieldActor(project, { walkDown: bigAnim });
  const screen = project.maps[0].screens[0];
  screen.entities.push({ actorId: smallActorId, x: 0, y: 1, props: {} }); // baseY = 0
  screen.entities.push({ actorId: bigActorId, x: 0, y: 1, props: {} }); // baseY = 0, identical rows
  assert.equal(fieldScanlineDensity(project, screen), 8, 'taking the max across entities would wrongly give 5');
});

test('fieldScanlineRows: three edge branches, none of which may throw or contribute a wrong count -- a zero-frame animation substitutes metasprite 0 (its own rows appear, not "no rows"), a frame naming a missing metasprite is filtered out (no rows, no throw), and an entity whose actorId is past the actors array is skipped entirely (no rows, no throw) -- caught: indexing metasprites[id] with no .map(...).filter(Boolean) guard (a throw, or NaN-tainted rows), or entityRowMax being reached with no actor at all (a throw reading actor.anims)', () => {
  const zeroFrame = createProject('Zero-frame substitution', 'action');
  // metasprite 0 -- the first pushed, since sprites.metasprites starts empty --
  // is what the zero-frame stub must resolve to, per resolveActorRestingIcon's
  // own identical substitution (design §3.6) applied here to reachablePoses.
  poseMetasprite(zeroFrame, [{ tile: 0, x: 0, y: 0, palette: 0 }, { tile: 1, x: 0, y: 0, palette: 0 }]);
  const zeroFrameAnimId = zeroFrame.sprites.animations.length;
  zeroFrame.sprites.animations.push({ id: zeroFrameAnimId, name: 'Zero frames', loop: true, frames: [] });
  const zeroFrameActorId = fieldActor(zeroFrame, { walkDown: zeroFrameAnimId });
  const zeroFrameScreen = zeroFrame.maps[0].screens[0];
  zeroFrameScreen.entities.push({ actorId: zeroFrameActorId, x: 0, y: 1, props: {} }); // baseY = 0
  const zeroFrameRows = fieldScanlineRows(zeroFrame, zeroFrameScreen);
  assert.equal(zeroFrameRows.get(0), 2, 'metasprite 0\'s own two tiles must appear -- the zero-frame stub is not "draws nothing"');

  const missingMetasprite = createProject('Missing metasprite filtered', 'action');
  const missingAnimId = missingMetasprite.sprites.animations.length;
  // Frame 0 names metasprite 42 -- no such metasprite exists in this project.
  missingMetasprite.sprites.animations.push({ id: missingAnimId, name: 'Stale frame', loop: true, frames: [{ metaspriteId: 42 }] });
  const missingActorId = fieldActor(missingMetasprite, { walkDown: missingAnimId });
  const missingScreen = missingMetasprite.maps[0].screens[0];
  missingScreen.entities.push({ actorId: missingActorId, x: 0, y: 1, props: {} });
  assert.doesNotThrow(() => fieldScanlineRows(missingMetasprite, missingScreen));
  assert.equal(fieldScanlineRows(missingMetasprite, missingScreen).size, 0, 'a frame naming a missing metasprite must be filtered out, contributing no rows');

  const staleActorId = createProject('Stale actorId skipped', 'action');
  staleActorId.maps[0].screens[0].entities.push({ actorId: 99, x: 0, y: 1, props: {} }); // no actor at index 99
  assert.doesNotThrow(() => fieldScanlineRows(staleActorId, staleActorId.maps[0].screens[0]));
  assert.equal(fieldScanlineRows(staleActorId, staleActorId.maps[0].screens[0]).size, 0, 'an out-of-range actorId must be skipped entirely, contributing no rows');
});

// Reframed per review round 1, finding 3: the original title claimed this
// test distinguishes asking for walkSide once from asking twice, which is
// unobservable -- reachablePoses' own animIds and poseIds (both local to
// that function) are both Sets, so a duplicate walkSide request collapses
// before entityRowMax's per-row maximum ever runs (docs/design-draw-
// validation.md §9, v7.1). What
// this test actually proves, and the only thing it can prove, is that a
// walkSide-only actor (walkDown and walkUp both unset, falling back to an
// unset idle -- NO_ANIM) is included at all.
test('fieldScanlineDensity: a walkSide-only actor is included -- walkDown and walkUp both unset, falling back to an unset idle (NO_ANIM), still contributes its one 5-tile pose\'s row counts -- caught: a facing-slot resolution that skips walkSide entirely, or resolves it to NO_ANIM the way an unset walkDown/walkUp correctly does', () => {
  const project = createProject('walkSide only', 'action');
  const sidePose = poseMetasprite(project, Array.from({ length: 5 }, (_, i) => ({ tile: i, x: 0, y: 0, palette: 0 })));
  const sideAnim = facingAnim(project, sidePose);
  const actorId = fieldActor(project, { walkSide: sideAnim });
  const screen = project.maps[0].screens[0];
  screen.entities.push({ actorId, x: 0, y: 1, props: {} }); // baseY = 0
  assert.equal(fieldScanlineDensity(project, screen), 5, 'a walkSide-only actor must still be included -- 0 would mean walkSide was silently dropped');
});

test('fieldScanlineRows: negative underflow wraps to a real, invisible-until-wrapped low row, not a JS-negative one, and a wrap landing at/past row 239 contributes zero rows -- caught: clamping a negative sum to 0 (top of screen) instead of wrapping it, which would place the tile somewhere hardware never would', () => {
  const visible = createProject('Underflow, visible', 'action');
  const visiblePose = poseMetasprite(visible, [{ tile: 0, x: 0, y: -18, palette: 0 }]);
  const visibleAnim = facingAnim(visible, visiblePose);
  const visibleActorId = fieldActor(visible, { walkDown: visibleAnim });
  const visibleScreen = visible.maps[0].screens[0];
  visibleScreen.entities.push({ actorId: visibleActorId, x: 0, y: 0, props: {} }); // baseY = -1
  const rows = fieldScanlineRows(visible, visibleScreen);
  // (0 - 1 - 18) & 0xff = 237: two of the tile's own eight rows (237-238)
  // are still inside the visible 0-238 picture.
  assert.deepEqual([...rows.keys()].sort((a, b) => a - b), [237, 238], 'the wrap must land at row 237, not a negative index or an unwrapped one');
  assert.equal(rows.get(237), 1);
  assert.equal(rows.get(238), 1);

  const offscreen = createProject('Underflow, off-screen', 'action');
  const offscreenPose = poseMetasprite(offscreen, [{ tile: 0, x: 0, y: -2, palette: 0 }]);
  const offscreenAnim = facingAnim(offscreen, offscreenPose);
  const offscreenActorId = fieldActor(offscreen, { walkDown: offscreenAnim });
  const offscreenScreen = offscreen.maps[0].screens[0];
  offscreenScreen.entities.push({ actorId: offscreenActorId, x: 0, y: 0, props: {} }); // baseY = -1
  // (0 - 1 - 2) & 0xff = 253: at/past row 239, so no row of the visible
  // picture is ever reached.
  assert.equal(fieldScanlineRows(offscreen, offscreenScreen).size, 0, 'a wrap landing at/past row 239 must contribute zero rows');
});

test('fieldScanlineRows: a positive byte wrap reappears at a real, visible, low row and must be counted there, not treated as still "near the bottom" -- entity.y = 239 (normalization\'s own ceiling, shared/project.js\'s clamp(raw?.y, 0, 239, 0)) with a pose tile at tile.y = 18 wraps to row 0 -- caught: clipping anything computed from a large entity.y as off-screen without performing the wrap first', () => {
  const project = createProject('Positive wrap', 'action');
  const pose = poseMetasprite(project, [{ tile: 0, x: 0, y: 18, palette: 0 }]);
  const anim = facingAnim(project, pose);
  const actorId = fieldActor(project, { walkDown: anim });
  const screen = project.maps[0].screens[0];
  screen.entities.push({ actorId, x: 0, y: 239, props: {} }); // baseY = 238
  // (239 - 1 + 18) & 0xff = 256 & 0xff = 0.
  const rows = fieldScanlineRows(project, screen);
  assert.equal(rows.get(0), 1, 'the wrapped sum must land on row 0, a real visible row');
});

test('fieldScanlineRows: clipping happens at row 239, not row 240 -- a tile at oamY 235 contributes only its first 4 of 8 rows (235-238), and a tile at oamY 239 contributes none at all -- caught: an off-by-one clipping at 240 instead of 239 (against the documented one-scanline OAM-Y delay), or clipping only the span\'s own starting row rather than the whole span', () => {
  const interior = createProject('Clip, interior', 'action');
  const interiorPose = poseMetasprite(interior, [{ tile: 0, x: 0, y: 235, palette: 0 }]);
  const interiorAnim = facingAnim(interior, interiorPose);
  const interiorActorId = fieldActor(interior, { walkDown: interiorAnim });
  const interiorScreen = interior.maps[0].screens[0];
  interiorScreen.entities.push({ actorId: interiorActorId, x: 0, y: 1, props: {} }); // baseY = 0, oamY = 235
  assert.deepEqual(
    [...fieldScanlineRows(interior, interiorScreen).keys()].sort((a, b) => a - b),
    [235, 236, 237, 238],
    'oamY 235 must contribute exactly rows 235-238 (4 of its own 8), not all 8 and not fewer'
  );

  const boundary = createProject('Clip, boundary', 'action');
  const boundaryPose = poseMetasprite(boundary, [{ tile: 0, x: 0, y: 239, palette: 0 }]);
  const boundaryAnim = facingAnim(boundary, boundaryPose);
  const boundaryActorId = fieldActor(boundary, { walkDown: boundaryAnim });
  const boundaryScreen = boundary.maps[0].screens[0];
  boundaryScreen.entities.push({ actorId: boundaryActorId, x: 0, y: 1, props: {} }); // baseY = 0, oamY = 239
  assert.equal(fieldScanlineRows(boundary, boundaryScreen).size, 0, 'oamY 239 is past the visible picture entirely and must contribute nothing');
});

test('fieldScanlineRows: the player\'s own two OAM rows each cover all eight of their own scanlines, not one row of weight 2 -- asserted directly against fieldScanlineRows, the one place this is observable (fieldScanlineDensity\'s own scalar peak cannot distinguish "two real 8-row spans" from "two single-row hits of weight 2" on a player-only screen -- both report a peak of 2) -- caught: reporting only two populated map entries (topRow: 2, bottomRow: 2) instead of the full sixteen-row span build_oam\'s own tmp/tmp2 layout actually produces', () => {
  const project = createProject('Player span rows', 'action'); // startMap 0, startScreen 0, startY 112 by default
  const screen = project.maps[0].screens[0];
  const topRow = project.project.startY - 1;
  const bottomRow = topRow + 8;
  const rows = fieldScanlineRows(project, screen, { isStartScreen: true });
  assert.equal(rows.size, 16, 'expected all sixteen rows of the player\'s own two 8-scanline spans, not two single-row hits');
  for (let row = topRow; row < topRow + 8; row++) {
    assert.equal(rows.get(row), 2, `row ${row} (top span) must be 2`);
  }
  for (let row = bottomRow; row < bottomRow + 8; row++) {
    assert.equal(rows.get(row), 2, `row ${row} (bottom span) must be 2`);
  }
});

test('fieldScanlineDensity: a placed entity\'s pose tile landing at bottomRow + 3 -- the INTERIOR of the player\'s own bottom span, not its first row -- raises the scalar peak from 2 to 3, proving fieldScanlineDensity genuinely reads from the corrected per-row map rather than an isolated pair of hits -- caught: a fix that only satisfies the row-level assertion above in isolation without actually wiring fieldScanlineDensity\'s own reduction to read from the corrected map', () => {
  const project = createProject('Bottom span interior probe', 'action');
  const screen = project.maps[0].screens[0];
  const topRow = project.project.startY - 1;
  const bottomRow = topRow + 8;
  assert.equal(fieldScanlineDensity(project, screen, { isStartScreen: true }), 2, 'sanity: the player alone peaks at 2');

  const pose = poseMetasprite(project, [{ tile: 0, x: 0, y: 0, palette: 0 }]);
  const anim = facingAnim(project, pose);
  const actorId = fieldActor(project, { walkDown: anim });
  // baseY = entity.y - 1 = bottomRow + 3, the interior of [bottomRow, bottomRow + 8).
  screen.entities.push({ actorId, x: 0, y: bottomRow + 4, props: {} });

  assert.equal(fieldScanlineDensity(project, screen, { isStartScreen: true }), 3, 'a tile in the interior of the bottom span must raise the peak to 3');
});

// Reframed per review round 1, finding 4: the original test computed the
// mapIndex-and-screenIndex predicate itself, inside the test, and only
// passed the resulting boolean to fieldScanlineRows -- a future caller that
// wrongly compared screenIndex alone would never affect this test, since the
// comparison never happens in production code here. What this test actually
// proves, and the only thing it can prove, is fieldScanlineRows' own
// isStartScreen option in isolation: true includes the player's own sixteen
// rows, false (and omitting the option entirely) includes none of them. The
// real two-index caller wiring -- deriving isStartScreen from the Map
// Forge's actual state.mapIndex/state.screenIndex -- is Phase 5's own UI
// integration test (docs/design-draw-validation.md, the "Integration
// coverage" passage a few lines above its own §6.2, ~line 1304), which drives
// the real UI rather than calling fieldScanlineRows directly.
test('fieldScanlineRows: the isStartScreen option -- true includes the player\'s own sixteen rows, false (and omitting it) includes none of them', () => {
  const project = createProject('isStartScreen option', 'action');
  const screen = project.maps[0].screens[0];
  assert.equal(fieldScanlineRows(project, screen, { isStartScreen: true }).size, 16, 'isStartScreen: true must include the player\'s own sixteen rows');
  assert.equal(fieldScanlineRows(project, screen, { isStartScreen: false }).size, 0, 'isStartScreen: false must include none of them');
  assert.equal(fieldScanlineRows(project, screen).size, 0, 'omitting the options object entirely must behave identically to isStartScreen: false');
});

// --------------------------------------------------------------------------
// Phase 4 -- spriteReservedRanges (design §3.3) and metaspriteTileCollisions
// (design §3.2, the rename of playerSpriteCollisions -- test/unit/
// playersprite.test.js's own existing assertions cover the rename itself
// verbatim; the duplicated-input-indices case below is new). reservedRangeRects
// itself is tested directly in test/unit/sheetgeom.test.js.
// --------------------------------------------------------------------------

test('spriteReservedRanges: an action-with-combat project is charged the player and HUD-hearts ranges, and the cursor range is absent (no RPG, no split font)', () => {
  const project = createProject('Action combat', 'action');
  makeMonster(project, 3, { damage: 1 }); // projectUsesCombat: an actor with damage > 0
  const ranges = spriteReservedRanges(project, mapperById(1)); // MMC1: not scanline-IRQ, irrelevant here anyway (action project)
  assert.deepEqual(ranges, [
    { start: 0, end: PLAYER_TILES, label: 'the player' },
    { start: HEART_FULL_TILE, end: LIMITS.tilesPerTable, label: 'the HUD hearts' }
  ]);
});

test('spriteReservedRanges: an RPG-on-MMC3 project is charged the player and battle-cursor ranges, and the hearts range is absent -- projectUsesHeartArt is always false for an RPG, regardless of how much combat the project has', () => {
  const project = createProject('RPG split font', 'rpg'); // gameType 'rpg' alone makes projectUsesText true
  makeMonster(project, 3, { damage: 1 }); // plenty of combat -- must still not earn the hearts range
  const ranges = spriteReservedRanges(project, mapperById(4)); // MMC3: scanlineIrq -- fontBankSplit is true
  assert.deepEqual(ranges, [
    { start: 0, end: PLAYER_TILES, label: 'the player' },
    { start: SPRITE_ARROW_TILE, end: SPRITE_ARROW_TILE + 1, label: 'the battle cursor' }
  ]);
});

test('spriteReservedRanges: an RPG-on-MMC1 project is charged the player range only -- no hearts (RPG), no cursor (no split font)', () => {
  const project = createProject('RPG plain', 'rpg');
  makeMonster(project, 3, { damage: 1 });
  const ranges = spriteReservedRanges(project, mapperById(1)); // MMC1: not scanline-IRQ -- fontBankSplit is false
  assert.deepEqual(ranges, [{ start: 0, end: PLAYER_TILES, label: 'the player' }]);
});

test('metaspriteTileCollisions: a metasprite with two tiles both referencing the identical reserved index reports that index once, deduplicated and sorted', () => {
  const project = createProject('Dedup collisions', 'action');
  project.sprites.metasprites = [
    {
      id: 0,
      name: 'Double-hit',
      // $FF (HEART_FULL_TILE + 1) is encountered FIRST, then the duplicated
      // $FE (HEART_FULL_TILE) references -- so an insertion-order Set with no
      // .sort() would yield [$FF, $FE], not the expected [$FE, $FF]. Placing
      // $FE first (the original ordering) would let a missing .sort() pass
      // by accident, since insertion order already happens to be sorted.
      tiles: [
        { tile: HEART_FULL_TILE + 1, x: 0, y: 4, palette: 0 },
        { tile: HEART_FULL_TILE, x: 0, y: 0, palette: 0 },
        { tile: HEART_FULL_TILE, x: 4, y: 0, palette: 0 } // same reserved index, a second time
      ]
    }
  ];
  const indices = [HEART_FULL_TILE, HEART_FULL_TILE + 1];
  const collisions = metaspriteTileCollisions(project, indices);
  assert.equal(collisions.length, 1);
  assert.deepEqual(
    collisions[0].tiles,
    [HEART_FULL_TILE, HEART_FULL_TILE + 1],
    'the duplicated HEART_FULL_TILE reference must be reported once, not twice, and the set must be sorted -- ' +
      'caught: removing .sort(), which would report [$FF, $FE] instead, matching encounter order'
  );
});

// A tile string with real, non-blank art -- the split.test.js precedent
// (SOLID_TILE there).
const RESERVED_ART_TILE = '3'.repeat(64);

test('validateProject: an action-with-combat project with artwork at $FE gets exactly one error, where "Tile Forge", the exact HUD-hearts message; removing the combat source makes the error disappear -- caught: the refactored hearts branch skipping the hearts range or choosing the cursor message instead', () => {
  const project = createProject('Hearts regression', 'action');
  const actorId = makeMonster(project, 3, { damage: 1 });
  project.tilesets[0].sprites.tiles[HEART_FULL_TILE] = RESERVED_ART_TILE;

  const problems = validateProject(project);
  assert.equal(problems.length, 1, 'expected exactly one problem');
  assert.deepEqual(problems[0], {
    severity: 'error',
    where: 'Tile Forge',
    message:
      `Tileset "${project.tilesets[0].name}" has artwork in the last two sprite tiles, which the HUD hearts reserve ` +
      'while anything in the project can hurt the player.'
  });

  project.sprites.actors[actorId].damage = 0; // combat off -- projectUsesHeartArt now false
  assert.deepEqual(validateProject(project), [], 'with no combat source left, the reservation -- and its error -- must be gone even though the artwork is still there');
});

// The design's own "smoke coverage" runs (§7 Phase 4) as a direct, DOM-free
// proof of the combination spriteReservedRanges + reservedRangeRects actually
// produces -- the exact shading rectangles the Tile Forge and Sprite Forge
// sheets will draw from, without needing a mounted canvas to observe it.
const SHEET_COLS = 16;

function cellCovered(ranges, col, row) {
  return ranges.some((range) =>
    reservedRangeRects(range.start, range.end, SHEET_COLS).some(
      (rect) => row >= rect.row && row < rect.row + rect.rows && col >= rect.col && col < rect.col + rect.cols
    )
  );
}

test('Smoke coverage, run 1 (action-with-combat): $FE and $FF are covered, $FC and $F0 are not, and toggling combat off drops the hearts shading while the player range keeps its own', () => {
  const project = createProject('Smoke run 1', 'action');
  const actorId = makeMonster(project, 3, { damage: 1 });
  const mapper = mapperById(1);
  const withCombat = spriteReservedRanges(project, mapper);
  assert.ok(cellCovered(withCombat, 14, 15), '$FE (col 14, row 15) must be shaded');
  assert.ok(cellCovered(withCombat, 15, 15), '$FF (col 15, row 15) must be shaded');
  assert.ok(!cellCovered(withCombat, 12, 15), '$FC (col 12, row 15) must NOT be shaded');
  assert.ok(!cellCovered(withCombat, 0, 15), '$F0 (col 0, row 15) must NOT be shaded');

  project.sprites.actors[actorId].damage = 0; // combat off
  const withoutCombat = spriteReservedRanges(project, mapper);
  assert.ok(!cellCovered(withoutCombat, 14, 15), 'with combat off, $FE must no longer be shaded');
  assert.ok(cellCovered(withoutCombat, 0, 0), 'the player range must still be shaded regardless of combat');
});

test('Smoke coverage, run 2 (RPG-on-MMC3): $FD is covered, $FC and $F0 are not, and switching to MMC1 drops the cursor shading while the player range keeps its own', () => {
  const project = createProject('Smoke run 2', 'rpg');
  const onMmc3 = spriteReservedRanges(project, mapperById(4));
  assert.ok(cellCovered(onMmc3, 13, 15), '$FD (col 13, row 15) must be shaded');
  assert.ok(!cellCovered(onMmc3, 12, 15), '$FC (col 12, row 15) must NOT be shaded');
  assert.ok(!cellCovered(onMmc3, 0, 15), '$F0 (col 0, row 15) must NOT be shaded');

  const onMmc1 = spriteReservedRanges(project, mapperById(1));
  assert.ok(!cellCovered(onMmc1, 13, 15), 'on MMC1, $FD must no longer be shaded');
  assert.ok(cellCovered(onMmc1, 0, 0), 'the player range must still be shaded regardless of mapper');
});

// The table-conflation fix (design §6.3): renderer/forges/tile/tile.js's own
// renderSheet() must build a table-specific range list gated on the existing
// playerReserved()/fontReserved() predicates, never handing
// spriteReservedRanges' own output to the background table or the font
// range to the sprite table. A behavioral test cannot see this without a
// mounted canvas (tile.js touches document/canvas throughout its module, so
// it is not node:test-importable) -- this reads the source instead, the same
// shape the single-writer source assertions at the top of this file already
// use for an identical class of wiring-only concern.
test('renderer/forges/tile/tile.js: renderSheet keeps the sprite-table and background-table reserved-range lists genuinely independent -- caught: the literal pre-fix design, which handed spriteReservedRanges(...) to both sheets', () => {
  const text = fs.readFileSync(path.join(ROOT, 'renderer/forges/tile/tile.js'), 'utf8');
  const match = text.match(/const reservedRanges = playerReserved\(\)\s*\?\s*spriteReservedRanges\([\s\S]*?\)\)\s*:\s*fontReserved\(\)\s*\?\s*\[\{[^}]*\}\]\s*:\s*\[\];/s);
  assert.ok(
    match,
    'expected renderSheet to build its reservedRanges list from playerReserved() ? spriteReservedRanges(...) : fontReserved() ? [font range] : [] -- ' +
      'a version that reused one range list for both tables (or compared state.table directly instead of the existing gates) would fail this match'
  );
});
