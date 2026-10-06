#!/usr/bin/env node
// FIXED by 5138c1f (save.asm no longer refuses y 225..239): this is now a regression guard. A pass is the defect's END state: the save was written, the
// power-cycled title's Continue reached ST_GAMEPLAY on the streamed map, and the player is at the SAVED place (worldX, worldY, cur_map, flat_screen), whose y lies in the > MAX_Y band.
// Original defect, kept for the record: found while building the save->Continue redraw scene (coverage campaign), NOT caused by the ring prototype: a Save made while
// the player stands on a streamed Y-scrolling world's last 15 pixel rows of a screen (player_y 225..239) writes a record that Continue refuses
// (engine/save.asm save_check_valid: `lda SAVE_PLAYER_Y / cmp #MAX_Y+1 / bcs save_check_invalid`, MAX_Y = 224) -- the title never leaves ST_TITLE.
// The check's own comment calls the mismatch "pre-existing ... left alone" for START positions; in a vertical-scrolling streamed world ordinary
// walking reaches y = 228 (the player crosses to the next screen only past MAX_Y), so a save there is unloadable.
//   node test/lua/ring_gate/repro_continue_y.mjs [y-npc-local]     default 239 (player stops at y ~ 228); 200 saves at y ~ 189: Continue works
// Applies the ring patch (a horizontal streamed world on MMC1) because the ordinary build has no Y-scrolling streamed layout; the failing check is
// stock engine code (engine/save.asm) -- see the sabotage-free run below.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTree } from './ringtree.mjs';
import { ringProject, buildCell, cellById } from './ringworld.mjs';
import { bootRom, runSteps } from './ringrun_jsnes.mjs';
import { createMap } from '../../../shared/project.js';

const local = Number(process.argv[2] ?? 239);
const cell = cellById('MMC1-H');
const tree = makeTree({ ring: true });
const { project } = ringProject({ cell, gameType: 'action', n: 4, talkers: 'none', mutate: (p) => {
  p.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
  p.maps.push(createMap(p.maps.length, 'Title'));
  p.project.titleMap = p.maps.length - 1; p.project.titleScreen = 0;
  p.maps[0].screens[1].entities.push({ actorId: p.sprites.actors.length - 1, x: 120, y: local, props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } } });
} });
const built = await buildCell({ tree, project, cell, gameType: 'action', label: 'repro-continue-y', requestedPlacement: 'resident', provDir: fs.mkdtempSync(path.join(os.tmpdir(), 'repro-cy-')) });
const steps = [{ op: 'title' }, { op: 'boot' }, { op: 'save', btn: 'down', axis: 'y', max: 4000, target: 's', battery: true }, { op: 'cycle', axis: 'y', target: 's', battery: true }];
const recs = runSteps(bootRom(built.romPath), steps).filter((r) => r.kind === 'hold');
for (const r of recs) console.log(r.label, JSON.stringify({ reached: r.hold.reached, why: r.hold.why, worldY: r.hold.pos }));
fs.rmSync(built.dir, { recursive: true, force: true });
fs.rmSync(tree.root, { recursive: true, force: true });
// the hold records: [0] the save, [1] the Continue (reached = ST_GAMEPLAY on the streamed map with a masked redraw, read on the FIRST such frame). `place` is
// worldX, worldY and the owning map (cur_map, flat_screen) at each: all four must be equal, and the saved worldY must lie in the y > MAX_Y band
// (the band save_check_valid used to refuse). A Continue that lands the player at the wrong X, the wrong screen or the wrong map fails here.
const MAX_Y = 224, SCREEN_H = 240; // engine/constants.asm
const [saved, cont] = recs;
const reached = recs.length === 2 && recs.every((r) => r.hold.reached);
const same = reached && ['worldX', 'worldY', 'curMap', 'flatScreen'].every((k) => cont.hold.place[k] === saved.hold.place[k]);
const inBand = reached && saved.hold.place.worldY % SCREEN_H > MAX_Y;
const pass = reached && same && inBand;
const fmt = (r) => (r ? `worldX ${r.hold.place.worldX} worldY ${r.hold.place.worldY} cur_map ${r.hold.place.curMap} flat_screen ${r.hold.place.flatScreen}` : 'no record');
console.log(pass ? `continue landed in gameplay at the saved place: worldX ${cont.hold.place.worldX} worldY ${cont.hold.place.worldY} (local y ${cont.hold.place.worldY % SCREEN_H} > MAX_Y ${MAX_Y}) cur_map ${cont.hold.place.curMap} flat_screen ${cont.hold.place.flatScreen}`
  : `NOT PASSED: reached=${reached} same=${same} inBand=${inBand}; saved ${fmt(saved)}; continue ${fmt(cont)}`);
process.exit(pass ? 0 : 1);
