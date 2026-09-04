#!/usr/bin/env node
// Writes the RPG battery-save sample project -- a durable, repeatable fixture
// (not a mkdtemp throwaway) exercising engine/save.asm's battery path on an
// RPG build, on MMC1:
//   node tools/make-rpg-save-sample.js [dir]
//
// Same 2x1 world, doorway rows 5-8, title map, saver actor at (128, 96) with
// trigger 'touch', start (112, 112), switch 0 / variable 0 = 7 / give item 0 /
// Save as sample-mmc1/ (tools/make-mmc1-sample.js) -- every coordinate is
// identical on purpose, so test/lua/save_sram.lua's hardcoded walk and its
// SAVED_X/SAVED_Y (118, 100) stay shared across all three boards it drives.
//
// What is different: gameType is 'rpg', not 'action', and the saver's page
// runs `join member 1` immediately before `save`. That is what this fixture
// exists for -- see docs/design-rpg-save-fixture.md and CLAUDE.md's fixture
// passage for why sample-mmc1/sample-mmc3 cannot exercise it: continue_game
// (engine/save.asm) calls call_battle(BE_RESTORE) between reading the record
// out of WRAM and redraw_screen, and script_op_join calls
// call_battle(BE_JOIN) before the Save that follows it on the same page --
// both are real MMC1 PRG bank switches (switch_prg_bank's `and #$0F` in
// engine/banks.asm), and only an RPG build ever makes either one happen
// around a save.
//
// Every map's encounters.rate is left at createMap()'s own default of 0 (no
// random encounters), so the walk stays exactly as deterministic as
// sample-mmc1's -- no wandering monster can ever interrupt it.
//
// No monster actor and no party metasprite art: TWO warnings are the expected,
// non-blocking result of that -- validateProject's "No actor deals damage, so
// no battle can ever start" (shared/project.js) and checkBattleTables' own
// separate "No actor is hostile, so no battle can start. Give a monster some
// contact damage." (main/build/battletables.js) -- and neither blocks the
// build (checkCapacity only fails on an 'error' severity, generate.js's own
// errors = problems.filter(severity === 'error')). Nothing here ever triggers
// a battle screen for either to be drawn on, so both stay omitted to keep the
// fixture small, the same way sample-mmc1/ itself carries no player sprite
// art. `createProject(name, 'rpg')` supplies an RPG-capable mapper and a
// second Battle tileset by default; palettes are project-global, so no extra
// palette authoring is needed.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, createPartyMember, createSpell, LIMITS } from '../shared/project.js';
import { saveProject } from '../main/project-io.js';
import { tile, split16, screenFromArt, metasprite } from './sample-common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? path.resolve(__dirname, '../sample-rpg-mmc1');

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
// A 2x1 world: the start screen (west) and the saver's screen (east), open
// to each other along rows 5-8, identical to sample-mmc1's own layout -- this
// is what gives the save round trip a screen to leave from that is not the
// start screen.
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

const project = createProject('RPG Save Sample', 'rpg');
project.cartridge.mapper = 1; // MMC1 -- the board a PRG bank write can take WRAM away on

const background = project.tilesets[0].background.tiles;
background[1] = tile(GRASS);
background[2] = tile(WALL);

project.palettes.bg[0] = [0x0f, 0x1a, 0x2a, 0x30]; // grass
project.palettes.bg[1] = [0x0f, 0x00, 0x10, 0x20]; // wall
project.palettes.sprite[0] = [0x0f, 0x16, 0x27, 0x30]; // player
project.palettes.sprite[1] = [0x0f, 0x17, 0x28, 0x30]; // gem
project.palettes.sprite[2] = [0x0f, 0x0a, 0x2a, 0x30]; // saver

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
    // Stands still and is talked to by walking into it, same as sample-mmc1's own Saver --
    // its `npc` behaviour is what keeps it stationary, not the speed value, so speed is
    // authored as 1 (normalizeActor's own clamp floor -- shared/project.js) to keep the
    // generator's source and the checked-in normalized JSON agreeing byte for byte.
    { id: 1, name: 'Saver', behavior: 'npc', speed: 1, hp: 1, anims: { idle: 1 } }
  ]
};

// The one item this project hands out, backed by the Gem pickup above -- see
// tools/make-mmc1-sample.js's own comment on why this has to be authored,
// not left for the migration: createProject() already supplies `items: []`.
project.items = [{ id: 0, name: 'Gem', actorId: 0, metaspriteId: null }];

project.metatiles[1] = { ...project.metatiles[1], name: 'Grass', tiles: [1, 1, 1, 1], palette: 0, collision: 'open' };
project.metatiles[2] = { ...project.metatiles[2], name: 'Wall', tiles: [2, 2, 2, 2], palette: 1, collision: 'solid' };

const west = screenFromArt(WEST, LEGEND, screenOpts);
const east = screenFromArt(EAST, LEGEND, screenOpts);

// The saver: touch triggers setSwitch, setVar, give (the gem), join (member 1)
// and Save. The Join is what puts BE_JOIN's own field bank switch ahead of
// the Save on this fixture's one page -- see the header comment above.
//
// The page guards itself on the switch it sets, the engine's own "this
// happened already" idiom, and load-bearing here rather than decorative --
// see tools/make-mmc1-sample.js's identical comment for why: Save records
// where the player is standing, which for a touch trigger is on top of the
// actor that fired it, so Continue restores the player mid-contact and
// spawn_entities arms the trigger again during the load's own redraw. Without
// the guard the page re-runs a frame later, handing out a second gem and
// re-joining an already-joined member (party_join's own `pc_in_party,x / bne`
// guard makes the second join a no-op, but the gem and the bag are not
// idempotent the same way).
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
              { op: 'setSwitch', switch: 0 },
              { op: 'setVar', variable: 0, value: 7 },
              { op: 'give', item: 0 },
              { op: 'join', member: 1 },
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
  // battleSkyTile/battleGroundTile/encounters left at createMap()'s own
  // defaults (rate 0, no actors) -- no random encounter can ever fire, so the
  // walk below stays exactly as deterministic as sample-mmc1's own.
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

// Two party members: Rian starts in the party (createPartyMember's own
// default, id === 0) -- this is also this fixture's own authored invariant
// for save_sram.lua's RPG detector (round 2 review, finding 3): the detector
// itself keys off pc_level, not pc_in_party, precisely so that flipping this
// to false would not silently disable every RPG assertion -- it would instead
// fail phase 4/6's own `pc_in_party[0] == 1` check loudly. Iris does not start
// in the party, and is recruited on the field by the saver page's own
// `join member 1` moments before the Save. Both keep every other
// createPartyMember() default, so their level-1 pc_hp_max/pc_mp_max are the
// plain, unmodified base stats -- but Rian alone knows one spell from level 1
// (round 2 review, finding 2: a spell known by neither member made the
// pc_spells assertion vacuously zero on both sides), so the two members'
// pc_spells values differ -- see docs/design-rpg-save-fixture.md for the
// exact numbers and where they come from.
project.spells = [createSpell(0, 'Spark')];
project.party = [
  { ...createPartyMember(0, 'Rian'), spells: [{ spellId: 0, level: 1 }] },
  createPartyMember(1, 'Iris')
];

project.project.startMap = 0;
project.project.startScreen = 0;
project.project.startX = 112;
project.project.startY = 112;

await saveProject(target, project);
console.log(`wrote RPG save sample project to ${target}`);
