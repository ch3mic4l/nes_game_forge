// The authored mutation of a sweep scene (phase 3a slice S1, (a1) sweep): actor behaviour/placement and solid metatile patches,
// applied by sw_manifest_scene.mjs BEFORE normalizeProject and validateProject, so every swept scene is an admitted project with
// zero validation errors and no RAM poke or engine override. Ported from the Q1c scratch driver (handoff-next/s1-q1c/q1c-lib.mjs)
// so that the axes it measured are first-class axes of the shipped harness.
//
// cfg: { k, pos:[x,y], geom, beh, speed, flash, bound, turn }
//   k      blocked actors: entities 0..k-1 of each populated screen (k = 8 also turns the eighth -- the Flash npc / damage npc -- into
//          a chaser without its touch event)
//   pos    where the blocked actors stand (default POS); geom the solid metatile patch around them:
//            'box'     every probe cell around the actor (the Q1c grid's own shape)
//            'r3patch' the review-3 R3-F1 patch: metatile 1 solid at columns 9-12, rows 8-11 of the FIRST busy screen only (the chasers
//                      of both busy screens are placed inside it, as the reviewer authored it)
//            'none'    nothing solid
//            'RDLU'... the named probe cells only
//   flash  false = the touch Shake/Flash/Sfx npc is not on the screen at all (the Flash-free control)
//   bound  true = an ordinary second map carrying one switch-bound tile, which turns BOUND_TILE_ENABLED on project-wide
//   turn   { side, up, down, dur } = direction-specific looping animations of those lengths for the eight scene actors (as the reviewer authored it) (R3-F1: a turn
//          onto a shorter animation resets the frame), built from the actor's own walkDown poses in alternation
export const BODY = { L: 2, R: 13, T: 8, B: 15 }; // from engine/constants.asm
export const POS = [175, 200];
export const YSET = [193, 194, 202, 209, 210, 212, 214, 216, 218, 225, 226, 234]; // the selected 12-y set of the Q1c grid

/** The one switch-bound tile of the bound-tile curve, as the NORMALIZED project must hold it (row/col, not an ignored `cell`). */
export const BOUND_TILE = { switchId: 0, row: 0, col: 0, metatileId: 2 };

export function makeMutate(cfg, shared = {}) {
  return (project, { createMap, createScreen } = shared) => {
    const speed = cfg.speed ?? 1;
    const pos = cfg.pos ?? POS;
    const k = cfg.k ?? 0;
    // the BUSY screens only (the eight-actor screens): the far actor of a wide scene stands alone on its own screen and is left where it is
    const screens = project.maps[0].screens.filter((s) => s.entities && s.entities.length >= 8);
    project.metatiles[1].collision = 'solid';
    const cellX = (x) => Math.max(0, Math.min(15, x >> 4));
    const cellY = (y) => Math.max(0, Math.min(14, y >> 4));
    const fill = (scr, c0, c1, r0, r1) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) scr.metatiles[r * 16 + c] = 1; };
    screens.forEach((scr) => {
      const ents = scr.entities;
      for (let j = 0; j < Math.min(k, ents.length); j++) {
        const e = ents[j];
        const [x, y] = pos;
        e.x = x; e.y = y;
        const a = project.sprites.actors[e.actorId];
        if (j === 7) { a.behavior = cfg.beh ?? 'chaser'; e.props = { trigger: 'interact' }; } else if (cfg.beh) a.behavior = cfg.beh;
        a.speed = speed;
        const c0 = cellX(x + BODY.L - speed - 1); const c1 = cellX(x + BODY.R + speed + 1);
        const r0 = cellY(y + BODY.T - speed - 1); const r1 = cellY(y + BODY.B + speed + 1);
        const g = cfg.geom ?? 'box';
        // the four probe cells of a chaser at (x, y): the points entity_chase tests before it moves one step
        const cell = { R: [(x + speed + BODY.R) >> 4, (y + BODY.B) >> 4], L: [(x - speed + BODY.L) >> 4, (y + BODY.B) >> 4], D: [(x + BODY.L) >> 4, (y + speed + BODY.B) >> 4], U: [(x + BODY.L) >> 4, (y - speed + BODY.T) >> 4] };
        if (g === 'box') fill(scr, c0, c1, r0, r1);
        else if (g === 'r3patch') { if (scr === screens[0]) fill(scr, 9, 12, 8, 11); }
        else if (g !== 'none') for (const ch of g) { const [cx, cy] = cell[ch]; fill(scr, cx, cx, cy, cy); }
      }
      if (cfg.flash === false && ents.length === 8 && k < 8) {
        const fi = ents.findIndex((e) => project.sprites.actors[e.actorId].name === 'ShakeFlashNpc');
        if (fi >= 0) ents.splice(fi, 1);
      }
    });
    if (cfg.turn) {
      const lengths = { walkSide: cfg.turn.side, walkUp: cfg.turn.up, walkDown: cfg.turn.down };
      for (let i = 0; i < 8; i++) {
        const a = project.sprites.actors[i];
        const base = project.sprites.animations[a.anims.walkDown];
        for (const [dir, len] of Object.entries(lengths)) {
          if (len === undefined) continue;
          const id = project.sprites.animations.length;
          project.sprites.animations.push({ id, name: `turn${i}${dir}`, loop: true, frames: Array.from({ length: len }, (_, f) => ({ ...base.frames[f % base.frames.length], duration: cfg.turn.dur ?? 1 })) });
          a.anims[dir] = id;
        }
      }
    }
    if (cfg.bound) {
      if (!createMap || !createScreen) throw new Error('a bound-tile scene needs createMap/createScreen from the repository under test');
      const om = createMap(1, 'Ordinary');
      om.tilesetId = 0; om.gridW = 1; om.gridH = 1; om.screens = [createScreen()];
      // ROW/COL, explicitly: normalizeProject reads row and col and IGNORES any other key. The earlier spelling of this one tile, `cell: 5`,
      // was ignored, so what every measured bound-tile job ran was (row 0, col 0), switch 0, metatile 2. This is that tile, said plainly.
      om.screens[0].boundTiles = [{ ...BOUND_TILE }];
      project.maps.push(om);
    }
    return { turn: cfg.turn ?? null, boundTile: cfg.bound ? BOUND_TILE : null }; // what the scene's independent art check must expect
  };
}

// the tile distribution of n over the eight slots (blocked actors are slots 0..k-1, so `front` puts the tiles on the blocked actors)
export function shapes(n) {
  const even = Array.from({ length: 8 }, (_, i) => Math.floor(n / 8) + (i < n % 8 ? 1 : 0));
  const out = { even };
  if (n >= 8) { const f = Array(8).fill(1); f[0] = n - 7; out.front = f.map((v) => Math.min(16, v)); if (out.front.reduce((a, b) => a + b, 0) !== n) delete out.front; }
  if (n >= 8) { const b = Array(8).fill(1); b[7] = Math.min(16, n - 7); if (b.reduce((a, c) => a + c, 0) === n) out.back = b; }
  if (n >= 4) { const m = Array(8).fill(0); let left = n; for (let i = 0; left > 0; i = (i + 3) % 8) { if (m[i] < 4) { m[i]++; left--; } } out.scatter = m; }
  return out;
}
