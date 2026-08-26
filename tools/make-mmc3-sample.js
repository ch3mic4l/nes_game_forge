#!/usr/bin/env node
// Writes the MMC3 sample project -- a durable, repeatable fixture (not a
// mkdtemp throwaway) exercising battery-backed save on the scanline-IRQ
// board, the one where fontBankSplit (shared/font.js) gives the font its own
// CHR bank instead of stamping it into every tileset:
//   node tools/make-mmc3-sample.js [dir]
//
// Deliberately small -- see CLAUDE.md's "Fixtures" note for what this project
// is for and why it is a separate project rather than a variant of sample/ or
// sample-rpg/.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, LIMITS } from '../shared/project.js';
import { saveProject } from '../main/project-io.js';
import { tile, split16, screenFromArt, metasprite } from './sample-common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? path.resolve(__dirname, '../sample-mmc3');

// --- art ---------------------------------------------------------------
const GRASS = ['11111111', '11211111', '11111121', '11111111', '12111111', '11111211', '11111111', '11121111'];
const WALL = ['11111111', '12222222', '12222222', '12222222', '11111111', '22212222', '22212222', '22212222'];

const GEM = [
  '0000000000000000',
  '0000000000000000',
  '0000000000000000',
  '0000011111100000',
  '0000123333210000',
  '0001233333321000',
  '0012333333332100',
  '0012333223332100',
  '0012333333332100',
  '0001233333321000',
  '0000123333210000',
  '0000011111100000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000'
];

const SAVER = [
  '0000011111100000',
  '0001122222211000',
  '0011222222221100',
  '0112222332222110',
  '0112223223222110',
  '0112223223222110',
  '0112222332222110',
  '0112222222222110',
  '0112233333322110',
  '0112222222222110',
  '0011222222221100',
  '0001111111111000',
  '0000110000110000',
  '0000110000110000',
  '0000000000000000',
  '0000000000000000'
];

// --- screens -------------------------------------------------------------
// A 2x1 world, open along rows 5-8, same doorway idiom tools/make-sample.js
// uses -- so the save round trip leaves from a screen that is not the start
// screen.
const LEGEND = { '.': 1, T: 2 };

const WEST = [
  'TTTTTTTTTTTTTTTT',
  'T..............T',
  'T..............T',
  'T..............T',
  'T..............T',
  'T...............',
  'T...............',
  'T...............',
  'T...............',
  'T..............T',
  'T..............T',
  'T..............T',
  'T..............T',
  'T..............T',
  'TTTTTTTTTTTTTTTT'
];

const EAST = [
  'TTTTTTTTTTTTTTTT',
  'T..............T',
  'T..............T',
  'T..............T',
  'T..............T',
  '...............T',
  '...............T',
  '...............T',
  '...............T',
  'T..............T',
  'T..............T',
  'T..............T',
  'T..............T',
  'T..............T',
  'TTTTTTTTTTTTTTTT'
];

const TITLE_ART = [
  'TTTTTTTTTTTTTTTT',
  'T..............T',
  'T..............T',
  'T..............T',
  '................',
  '................',
  'T..............T',
  'T..............T',
  '................',
  '................',
  'T..............T',
  'T..............T',
  'T..............T',
  'T..............T',
  'TTTTTTTTTTTTTTTT'
];

const screenOpts = { cols: LIMITS.screenCols, screenRows: LIMITS.screenRows };

// --- assemble --------------------------------------------------------------

const project = createProject('MMC3 Save Sample');
project.cartridge.mapper = 4; // MMC3 -- the only board with scanlineIrq

const background = project.tilesets[0].background.tiles;
background[1] = tile(GRASS);
background[2] = tile(WALL);

project.palettes.bg = [
  [0x0f, 0x1a, 0x2a, 0x30], // grass
  [0x0f, 0x00, 0x10, 0x20] // wall
];
project.palettes.sprite = [
  [0x0f, 0x16, 0x27, 0x30], // player
  [0x0f, 0x17, 0x28, 0x30], // gem
  [0x0f, 0x0a, 0x2a, 0x30] // saver
];

const sprites = project.tilesets[0].sprites.tiles;
split16(GEM).forEach((quadrant, index) => (sprites[0x20 + index] = quadrant));
split16(SAVER).forEach((quadrant, index) => (sprites[0x24 + index] = quadrant));

project.sprites = {
  metasprites: [metasprite(0, 'Gem', 0x20, 1), metasprite(1, 'Saver', 0x24, 2)],
  animations: [
    { id: 0, name: 'Gem shine', loop: true, frames: [{ metaspriteId: 0, duration: 30 }] },
    { id: 1, name: 'Saver idle', loop: true, frames: [{ metaspriteId: 1, duration: 30 }] }
  ],
  actors: [
    { id: 0, name: 'Gem', behavior: 'pickup', speed: 1, hp: 1, anims: { idle: 0 } },
    { id: 1, name: 'Saver', behavior: 'npc', speed: 0, hp: 1, anims: { idle: 1 } }
  ]
};

// The one item this project hands out, backed by the Gem pickup above. See
// tools/make-sample.js's own comment on why this has to be authored, not left
// for the migration: createProject() already supplies `items: []`.
project.items = [{ id: 0, name: 'Gem', actorId: 0, metaspriteId: null }];

project.metatiles[1] = { ...project.metatiles[1], name: 'Grass', tiles: [1, 1, 1, 1], palette: 0, collision: 'open' };
project.metatiles[2] = { ...project.metatiles[2], name: 'Wall', tiles: [2, 2, 2, 2], palette: 1, collision: 'solid' };

const west = screenFromArt(WEST, LEGEND, screenOpts);
const east = screenFromArt(EAST, LEGEND, screenOpts);

// The saver: a line of dialogue first -- MMC3 is the scanline-IRQ board, so
// this Say is what puts the split machinery to work during real gameplay
// (row 24's message box, not only the title's own two text bands) -- then
// setSwitch, setVar, give (the gem) and Save. That is the state a wrong
// restore would make visible (a switch, a variable, an inventory item and a
// screen that is not the start screen).
//
// The page guards itself on the switch it sets, which is the engine's own
// "this happened already" idiom and load-bearing here rather than decorative.
// Save records where the player is standing, which for a touch trigger is on
// top of the actor that fired it -- so Continue restores the player mid-
// contact, spawn_entities arms the trigger again during the load's own redraw
// and the page re-runs a frame later, handing out a second gem and (on this
// board especially) reopening the box over the restored field. Without the
// guard the restored bag can never be asserted exactly: a load that came back
// with an empty bag would be indistinguishable from one that came back
// correctly, because the re-run refills it either way.
east.entities = [
  {
    actorId: 1,
    x: 128,
    y: 96,
    props: {
      trigger: 'touch',
      event: {
        pages: [
          {
            cond: { type: 'switchOff', arg: 0 },
            commands: [
              { op: 'say', text: 'The stone hums, and remembers.' },
              { op: 'setSwitch', switch: 0 },
              { op: 'setVar', variable: 0, value: 7 },
              { op: 'give', item: 0 },
              { op: 'save' }
            ]
          }
        ]
      }
    }
  }
];

project.maps[0] = {
  id: 0,
  name: 'Fieldstone',
  gridW: 2,
  gridH: 1,
  tilesetId: 0,
  songId: null,
  screens: [west, east]
};

project.maps[1] = {
  id: 1,
  name: 'Title',
  gridW: 1,
  gridH: 1,
  tilesetId: 0,
  songId: null,
  screens: [screenFromArt(TITLE_ART, LEGEND, screenOpts)]
};
project.project.titleMap = 1;
project.project.titleScreen = 0;

project.switches = ['Saved once'];
project.variables = ['Save marker'];

project.project.startMap = 0;
project.project.startScreen = 0;
project.project.startX = 112;
project.project.startY = 112;

await saveProject(target, project);
console.log(`wrote MMC3 sample project to ${target}`);
