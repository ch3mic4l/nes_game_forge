// Content-only compaction of a scene's actor definitions (phase 3a slice S3a, fix round 2, review 2 required change 1).
//
// Why: the RPG + switch-bound-tile + Flash scenes were refused by the generator's capacity check ("lookup tables need 161 bytes but only 160 are
// free") although the same game IS constructible: the scene builder gives every one of its eight placed entities its OWN actor definition and
// also defines a ninth, never-placed `DamageNpc`, and every definition costs kernel-lo table bytes. This pass
//   - drops every actor definition no entity places, and
//   - gives entities whose definitions are identical (same behaviour, hit points, damage, animations -- everything but name and id) ONE shared
//     definition.
// It changes nothing the engine draws or runs: the eight placed entities keep their positions, triggers, scripts, animations and tile counts, so
// the population (exactly 15 / 14 tiles over eight slots) and the art are what the cell says. `compactActors` PROVES that on the project it is
// given -- it throws unless every placed entity's actor body is byte-identical before and after, the placed-entity tile total is unchanged, and
// nothing else in the project differs.
//
// The scene's own art/population assertions (test/lua/sw_manifest_scene.mjs assertSceneArt, keyed by the scene's actor ids) run on the UNCOMPACTED
// project, before this pass; the sweep harness files are provenance-pinned (test/fixtures/streambound-curve.json), so they are not edited.

const bodyOf = (actor) => { const { name, id, ...body } = actor; return JSON.stringify(body); };

function placedIds(project) {
  const ids = [];
  for (const m of project.maps) for (const s of m.screens) for (const e of s.entities ?? []) if (!ids.includes(e.actorId)) ids.push(e.actorId);
  return ids;
}

const tilesOf = (project, actor) => {
  const an = project.sprites.animations[actor.anims?.walkDown];
  const ms = an && project.sprites.metasprites[an.frames[0]?.metaspriteId];
  return ms ? ms.tiles.length : 0;
};

/** Everything of the project that compaction must not change, as a string: actors blanked, every entity's actorId blanked. */
const rest = (project) => {
  const copy = structuredClone(project);
  copy.sprites.actors = null;
  for (const m of copy.maps) for (const s of m.screens) for (const e of s.entities ?? []) e.actorId = 0;
  return JSON.stringify(copy);
};

/** Per placed entity (map, screen, entity order): its actor's body (all but name and id), its tile count, and the entity itself minus actorId. */
const entitiesOf = (project) => project.maps.flatMap((m) => m.screens.flatMap((s) => (s.entities ?? []).map((e) => {
  const actor = project.sprites.actors[e.actorId];
  if (!actor) throw new Error(`an entity places actor ${e.actorId}, which is not defined`);
  return { actor: bodyOf(actor), tiles: tilesOf(project, actor), rest: JSON.stringify({ ...e, actorId: 0 }) };
})));

/** The proof: throws unless `after` is `before` with only the actor table and the entities' actor ids changed, every placed entity unchanged. */
export function assertPreserved(before, after) {
  const a = entitiesOf(before);
  const b = entitiesOf(after);
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('compaction changed a placed entity (its actor body, tile count, position, trigger or script)');
  if (rest(before) !== rest(after)) throw new Error('compaction changed something other than the actor table and the entities\' actor ids');
  const sum = (list) => list.reduce((n, e) => n + e.tiles, 0);
  if (sum(a) !== sum(b)) throw new Error('compaction changed the placed tile total');
  return { entities: b.length, placedTiles: sum(b) };
}

/** Compacts `project` IN PLACE; returns { before, after, unplaced, merged, entities, placedTiles } (placedTiles: over every placed entity of every screen). */
export function compactActors(project) {
  const original = structuredClone(project);
  const actorsBefore = project.sprites.actors;
  for (const id of placedIds(project)) if (!actorsBefore[id]) throw new Error(`an entity places actor ${id}, which is not defined`);
  const defs = []; const toNew = new Map(); const byBody = new Map();
  for (const id of placedIds(project)) {
    const a = actorsBefore[id];
    const key = bodyOf(a);
    if (!byBody.has(key)) { byBody.set(key, defs.length); defs.push('id' in a ? { ...a, id: defs.length } : { ...a }); }
    toNew.set(id, byBody.get(key));
  }
  for (const m of project.maps) for (const s of m.screens) for (const e of s.entities ?? []) e.actorId = toNew.get(e.actorId);
  project.sprites.actors = defs;
  const proved = assertPreserved(original, project);
  return { before: actorsBefore.length, after: defs.length, unplaced: actorsBefore.length - toNew.size, merged: toNew.size - defs.length, ...proved };
}
