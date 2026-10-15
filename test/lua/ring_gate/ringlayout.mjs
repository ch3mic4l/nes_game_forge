// The RPG tileset layout of a gate cell (phase 3b S5 C3). A LEAF module (no imports): test/lib/ringrpg.js re-exports it, test/lua/run_sw_move_manifest.mjs and ringcli.mjs apply it, and none of
// the six pinned harness files (test/lua/sw_provenance.mjs HARNESS_FILES) imports it or is edited for it -- an edit there moves the harness hash every curve and identity certificate binds.
//
// The lightest valid RPG: ONE tileset, the battle drawn on the field's (rpg.battleTilesetId 0). On UNROM 512 every tileset takes an 8 KB CHR region off the front, so this is the shape that reaches the
// board's universal RPG ceiling (62 regions - 1 minimum CHR payload - 1 RPG code region = 60); the default two-tileset RPG (Main + Battle) reaches 59. MMC1 and MMC3 keep their tilesets in CHR ROM,
// so the shape moves neither of their ceilings (13, 29).
export function oneTilesetRpg(project) {
  project.tilesets = project.tilesets.slice(0, 1);
  project.rpg.battleTilesetId = 0;
  return project;
}

/**
 * A scene `mutate` for a ring spec: the project is laid out as `ring.oneTileset` says (set by ringcli.mjs prepareRing, only where rpgLayoutFor found it strictly deeper), then `inner` (the scene's own
 * authored mutation, if any) runs and its result is returned unchanged. With no `oneTileset` flag this returns `inner` itself, so every other cell's scene call is exactly what it was.
 * buildSceneProject applies the mutation BEFORE normalization and validation, so the layout is a validated project, never a patched-up one.
 */
export function layoutMutate(ring, inner = null) {
  if (!ring?.oneTileset) return inner;
  return (project, helpers) => { oneTilesetRpg(project); return inner ? inner(project, helpers) : null; };
}
