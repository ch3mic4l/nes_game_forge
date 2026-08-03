#!/usr/bin/env node
// Writes the turn-based RPG demo project:
//   node tools/make-rpg-sample.js [dir]
//
// Deliberately small. It exists to show the battle system working end to end —
// a party, a monster with block artwork, a spell, a potion, an encounter table —
// not to be a game. `sample/` stays the action-adventure fixture the engine
// tests are written against; this one is the RPG fixture.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, createPartyMember, createSpell, LIMITS } from '../shared/project.js';
import { saveProject } from '../main/project-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? path.resolve(__dirname, '../sample-rpg');

const tile = (rows) => rows.join('');

const GRASS = ['11111111', '11211111', '11111121', '11111111', '12111111', '11111211', '11111111', '11121111'];
const PATH  = ['22222222', '22122222', '22222212', '22222222', '21222222', '22222122', '22222222', '22212222'];
const WALL  = ['11111111', '12222222', '12222222', '12222222', '11111111', '22212222', '22212222', '22212222'];
const SKY   = ['11111111', '11111111', '11111111', '11111111', '11111111', '11111111', '11111111', '11111111'];
const SOIL  = ['22222222', '21222122', '22222222', '22122212', '22222222', '21222122', '22222222', '22212221'];

/** Split a 16x16 grid into TL, TR, BL, BR tile strings. */
function split16(rows) {
  const out = [];
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const originX = (quadrant % 2) * 8;
    const originY = Math.floor(quadrant / 2) * 8;
    let text = '';
    for (let y = 0; y < 8; y++) text += rows[originY + y].slice(originX, originX + 8);
    out.push(text);
  }
  return out;
}

const HERO = [
  '0000111111110000',
  '0001111111111000',
  '0011122222211100',
  '0011233223321100',
  '0011222222221100',
  '0001122222211000',
  '0000133333310000',
  '0001333333333100',
  '0011133333331100',
  '0011133333331100',
  '0001133333311000',
  '0000122222210000',
  '0000110000110000',
  '0001110000111000',
  '0000000000000000',
  '0000000000000000'
];

const SLIME = [
  '0000000000000000',
  '0000011111100000',
  '0000122222210000',
  '0001222222221000',
  '0012233223322100',
  '0012222222222100',
  '0122222222222210',
  '0122222222222210',
  '0122233333322210',
  '0122222222222210',
  '0112222222222110',
  '0011222222221100',
  '0001111111111000',
  '0000111111110000',
  '0000000000000000',
  '0000000000000000'
];

const POTION = [
  '0000000000000000',
  '0000001111000000',
  '0000001221000000',
  '0000011111100000',
  '0000122222210000',
  '0001233333321000',
  '0001233333321000',
  '0001233333321000',
  '0001233333321000',
  '0001222222221000',
  '0000111111110000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000'
];

// Battle artwork is a block of *background* tiles on the battle tileset, laid
// out on a 16-wide sheet so `tile + row * 16 + column` reaches each one. This is
// a 4x4 block, which is exactly one attribute cell — that is why the engine
// anchors monsters to a four-row, four-column grid.
const BOSS = [
  '00001111111111110000000000000000',
  '00011222222222211000000000000000',
  '00112222222222221100000000000000',
  '01122233333332221100000000000000',
  '01223333333333322110000000000000',
  '12233333333333333211000000000000',
  '12333333333333333321000000000000',
  '12333311133331113321000000000000',
  '12333111133331111321000000000000',
  '12333333333333333321000000000000',
  '12333333311133333321000000000000',
  '12333333333333333321000000000000',
  '01233333333333333210000000000000',
  '00122333333333322100000000000000',
  '00011222222222211000000000000000',
  '00001111111111110000000000000000',
  '00000111111111100000000000000000',
  '00011122222221110000000000000000',
  '00111222222222111000000000000000',
  '01112222222222111100000000000000',
  '01111111111111111100000000000000',
  '00111111111111111000000000000000',
  '00011111111111110000000000000000',
  '00001111111111100000000000000000',
  '00000011111110000000000000000000',
  '00000111001110000000000000000000',
  '00001110000111000000000000000000',
  '00011100000011100000000000000000',
  '00111000000001110000000000000000',
  '00110000000000110000000000000000',
  '00000000000000000000000000000000',
  '00000000000000000000000000000000'
];

/** Cut a wide pixel grid into 8x8 tile strings, row-major on a 16-wide sheet. */
function cutBlock(rows, cols, height) {
  const out = [];
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      let text = '';
      for (let y = 0; y < 8; y++) text += rows[ty * 8 + y].slice(tx * 8, tx * 8 + 8);
      out.push({ index: ty * 16 + tx, text });
    }
  }
  return out;
}

const project = createProject('Fallen Star', 'rpg');

// --- the field tileset ------------------------------------------------------
const field = project.tilesets[0];
field.name = 'Overworld';
field.background.tiles[1] = tile(GRASS);
field.background.tiles[2] = tile(PATH);
field.background.tiles[3] = tile(WALL);

const sprites = field.sprites.tiles;
split16(HERO).forEach((quadrant, index) => (sprites[index] = quadrant));      // the player, $00-$03
split16(HERO).forEach((quadrant, index) => (sprites[4 + index] = quadrant));  // ...and its walk frame
split16(HERO).forEach((quadrant, index) => (sprites[0x20 + index] = quadrant));
split16(SLIME).forEach((quadrant, index) => (sprites[0x24 + index] = quadrant));
split16(POTION).forEach((quadrant, index) => (sprites[0x28 + index] = quadrant));

// --- the battle tileset -----------------------------------------------------
// A second CHR bank the engine switches to when a battle starts, which is why an
// RPG needs a mapper that can switch graphics as well as program banks.
project.tilesets.push({
  id: 1,
  name: 'Battle',
  background: { tiles: field.background.tiles.map(() => '0'.repeat(64)) },
  sprites: { tiles: field.sprites.tiles.slice() }
});
const battleBg = project.tilesets[1].background.tiles;
battleBg[1] = tile(SKY);
battleBg[2] = tile(SOIL);
for (const { index, text } of cutBlock(BOSS, 4, 4)) battleBg[0x20 + index] = text;

project.palettes.bg = [
  [0x0f, 0x1a, 0x2a, 0x30], // grass, and the battle box's text
  [0x0f, 0x07, 0x17, 0x27], // path and battle ground
  [0x0f, 0x0c, 0x1c, 0x2c], // sky
  [0x0f, 0x06, 0x16, 0x26]  // the monster
];
project.palettes.sprite = [
  [0x0f, 0x16, 0x27, 0x30],
  [0x0f, 0x0a, 0x2a, 0x30],
  [0x0f, 0x14, 0x24, 0x30],
  [0x0f, 0x11, 0x21, 0x31]
];

const metasprite = (id, name, firstTile, palette) => ({
  id,
  name,
  tiles: [
    { x: 0, y: 0, tile: firstTile, palette, hflip: false, vflip: false },
    { x: 8, y: 0, tile: firstTile + 1, palette, hflip: false, vflip: false },
    { x: 0, y: 8, tile: firstTile + 2, palette, hflip: false, vflip: false },
    { x: 8, y: 8, tile: firstTile + 3, palette, hflip: false, vflip: false }
  ]
});

project.sprites.metasprites = [
  metasprite(0, 'Hero', 0x20, 0),
  metasprite(1, 'Slime', 0x24, 1),
  metasprite(2, 'Potion', 0x28, 2)
];
project.sprites.animations = [
  { id: 0, name: 'Hero', loop: true, frames: [{ metaspriteId: 0, duration: 16 }] },
  { id: 1, name: 'Slime', loop: true, frames: [{ metaspriteId: 1, duration: 16 }] },
  { id: 2, name: 'Potion', loop: true, frames: [{ metaspriteId: 2, duration: 16 }] }
];

// --- actors -----------------------------------------------------------------
// `damage` above zero is what marks an actor hostile in an RPG; how hard it
// actually hits comes out of its battle stats.
project.sprites.actors = [
  {
    id: 0,
    name: 'Slime',
    // Static, so it is a fight you choose by walking into it. A chaser would
    // cross the screen and start that fight before the step counter ever got
    // round to rolling a wandering one, which would hide half the feature.
    behavior: 'npc',
    speed: 1,
    hp: 12,
    damage: 1,
    anims: { idle: 1, walkDown: 1, walkUp: 1, walkSide: 1 },
    battle: {
      atk: 6, def: 2, acc: 170, eva: 4, speed: 3,
      mp: 0, xp: 6, gold: 4,
      weak: 'fire', strong: 'ice',
      drop: 1, dropPct: 40, heal: 0,
      // The block art at $20 of the battle tileset, four tiles square.
      battleTile: 0x20, battleW: 4, battleH: 4, battlePalette: 3
    }
  },
  {
    id: 1,
    name: 'Potion',
    behavior: 'pickup',
    speed: 1,
    hp: 1,
    damage: 0,
    anims: { idle: 2 },
    // A potion is an actor whose battle block heals: that is what makes it usable
    // from the bag during a fight.
    battle: { heal: 20, battleTile: null }
  },
  {
    id: 2,
    name: 'Iris',
    // A one-time NPC: her event recruits her into the party, turns a switch on,
    // and the switch is also what hides her — so once she has joined, she is
    // walking beside you rather than standing in the field.
    behavior: 'npc',
    speed: 1,
    hp: 1,
    damage: 0,
    anims: { idle: 0 },
    battle: {}
  },
  {
    id: 3,
    name: 'Snake',
    // A caster: no block art, so the battle screen falls back to drawing its
    // animation as sprites, and a poison spell it can afford four times.
    behavior: 'npc',
    speed: 1,
    hp: 10,
    damage: 1,
    anims: { idle: 1, walkDown: 1, walkUp: 1, walkSide: 1 },
    battle: {
      atk: 5, def: 1, acc: 170, eva: 6, speed: 5,
      mp: 8, xp: 5, gold: 3,
      weak: 'wind', strong: 'earth',
      drop: null, dropPct: 0, heal: 0,
      spellId: 2,
      battleTile: null
    }
  }
];

// --- the party --------------------------------------------------------------
project.party = [
  { ...createPartyMember(0, 'Rian'), metaspriteId: 0, spells: [{ spellId: 0, level: 1 }, { spellId: 1, level: 3 }, { spellId: 2, level: 2 }] },
  // Iris does not start in the party: talking to her runs a Join event, which is
  // the only way a second member ever arrives.
  { ...createPartyMember(1, 'Iris'), metaspriteId: 0, startsInParty: false, spells: [{ spellId: 1, level: 1 }] }
];
project.spells = [
  { ...createSpell(0, 'Ember'), mpCost: 3, kind: 'damage', amount: 10, element: 'fire', scope: 'one' },
  { ...createSpell(1, 'Mend'), mpCost: 4, kind: 'heal', amount: 18, element: 'none', scope: 'one' },
  { ...createSpell(2, 'Venom'), mpCost: 2, kind: 'poison', amount: 1, element: 'none', scope: 'one' }
];
project.rpg = { ...project.rpg, xpBase: 8, xpGrow: 4, maxLevel: 8, battleTilesetId: 1 };

// --- the world --------------------------------------------------------------
const LEGEND = { '.': 1, '=': 2, '#': 3 };
const FIELD = [
  '################',
  '#..............#',
  '#..====......==#',
  '#..=..=......=.#',
  '#..=..========.#',
  '...=..........=.',
  '...=..........=.',
  '#..============#',
  '#..............#',
  '#....##....##..#',
  '#....##....##..#',
  '#..............#',
  '#..==========..#',
  '#..............#',
  '################'
];

function screenFrom(rows) {
  const metatiles = [];
  for (const row of rows) for (const character of row) metatiles.push(LEGEND[character] ?? 1);
  if (metatiles.length !== LIMITS.screenCols * LIMITS.screenRows) throw new Error('bad screen art');
  return { metatiles, entities: [] };
}

const screen = screenFrom(FIELD);
screen.entities = [
  // A potion to pick up, and a slime you can walk into for a fight you cannot
  // run from — the two halves of "what is an actor for" in one screen.
  { actorId: 1, x: 48, y: 48, props: {} },
  { actorId: 0, x: 176, y: 176, props: {} },
  // The recruit: say, join, and set the switch that hides her from then on.
  {
    actorId: 2,
    x: 208,
    y: 32,
    props: {
      hideSwitch: 0,
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'say', text: 'I have waited for you.\nLet me come along.' },
              { op: 'join', member: 1 },
              { op: 'setSwitch', switch: 0 }
            ]
          }
        ]
      }
    }
  },
  // The caster, far from the corridors the tests walk.
  { actorId: 3, x: 32, y: 208, props: {} }
];

project.metatiles[1] = { ...project.metatiles[1], name: 'Grass', tiles: [1, 1, 1, 1], palette: 0, collision: 'open' };
project.metatiles[2] = { ...project.metatiles[2], name: 'Path', tiles: [2, 2, 2, 2], palette: 1, collision: 'open' };
project.metatiles[3] = { ...project.metatiles[3], name: 'Wall', tiles: [3, 3, 3, 3], palette: 3, collision: 'solid' };

project.maps[0] = {
  id: 0,
  name: 'Starfall Plain',
  gridW: 1,
  gridH: 1,
  tilesetId: 0,
  songId: null,
  screens: [screen],
  // The backdrop a battle is fought against, and how often one starts.
  battleSkyTile: 1,
  battleGroundTile: 2,
  encounters: { rate: 20, actorIds: [0] }
};

project.project.startMap = 0;
project.project.startScreen = 0;
project.project.startX = 112;
project.project.startY = 112;
project.project.titleMap = null;

await saveProject(target, project);
console.log(`wrote ${target}`);
