#!/usr/bin/env node
// Writes the sample project used as a demo and as the build pipeline's fixture:
//   node tools/make-sample.js [dir]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, LIMITS } from '../shared/project.js';
import { saveProject } from '../main/project-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? path.resolve(__dirname, '../sample');

// --- art -------------------------------------------------------------------
// Slot 3 of the tree palette is the same green as slot 1 of the grass palette,
// so a tree metatile blends into the surrounding field.

const GRASS = ['11111111', '11211111', '11111121', '11111111', '12111111', '11111211', '11111111', '11121111'];

const WATER = ['11111111', '11111111', '12211111', '11111221', '11111111', '11111111', '11222111', '11111111'];

const STONE = ['11111111', '12222222', '12222222', '12222222', '11111111', '22212222', '22212222', '22212222'];
const THORNS = ['13111311', '13113131', '31311311', '11131111', '13111131', '31131311', '13111131', '11311113'];

const TREE = [
  '3333322222333333',
  '3332222222223333',
  '3322222222222333',
  '3222222222222233',
  '2222222222222223',
  '2222222222222223',
  '2222222222222223',
  '3222222222222233',
  '3322222222222333',
  '3332222222223333',
  '3333322222333333',
  '3333331111333333',
  '3333331111333333',
  '3333331111333333',
  '3333311111333333',
  '3333333333333333'
];

// Actors live in the sprite table from tile $20 onwards; $00-$1F belongs to the
// player, which the build fills with a placeholder while it is empty.
const SLIME_A = [
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

const SLIME_B = [
  '0000000000000000',
  '0000000000000000',
  '0000011111100000',
  '0000122222210000',
  '0011222222221100',
  '0012233223322100',
  '0122222222222210',
  '0122222222222210',
  '0122233333322210',
  '0122222222222210',
  '0112222222222110',
  '0111222222222110',
  '0011111111111100',
  '0001111111111000',
  '0000000000000000',
  '0000000000000000'
];

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

const tile = (rows) => rows.join('');

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

// --- screens ---------------------------------------------------------------
// Edges left open where a neighbouring screen exists, so the player can cross.

const LEGEND = { ' ': 0, '.': 1, T: 2, '~': 3, '#': 4, x: 5 };

// Columns 6-9 are kept clear top to bottom on every screen, and rows 5-8 clear
// left to right, so the doorways between screens are actually reachable.
const SCREENS = [
  // 0: north-west — open east (rows 5-6) and south (cols 6-9)
  [
    'TTTTTTTTTTTTTTTT',
    'T..............T',
    'T.~~~..........T',
    'T.~~~..........T',
    'T.~~~..........T',
    'T...............',
    'T...............',
    'T..............T',
    'T.........####.T',
    'T.........#..#.T',
    'T.........####.T',
    'T..............T',
    'T..TT..........T',
    'T..............T',
    'TTTTTT....TTTTTT'
  ],
  // 1: north-east — open west (rows 5-6) and south (cols 6-9)
  [
    'TTTTTTTTTTTTTTTT',
    'T..............T',
    'T..TT......TT..T',
    'T..............T',
    'T..............T',
    '...............T',
    '...............T',
    'T..............T',
    'T.........~~~~.T',
    'T.........~~~~.T',
    'T..............T',
    'T..............T',
    'T..TT..........T',
    'T..............T',
    'TTTTTT....TTTTTT'
  ],
  // 2: south-west — open north (cols 6-9) and east (rows 7-8)
  [
    'TTTTTT....TTTTTT',
    'T..............T',
    'T..~~~.........T',
    'T..~~~.........T',
    'T..............T',
    'T..........##..T',
    'T..........##..T',
    'T...............',
    'T...............',
    'T..............T',
    'T....TT........T',
    'T..............T',
    'T..............T',
    'T..............T',
    'TTTTTTTTTTTTTTTT'
  ],
  // 3: south-east — open north (cols 6-9) and west (rows 7-8). The thorn patch
  // sits in the same corner as the Bramble, off the corridors the tests walk:
  // stepping on it costs a heart, the painted-metatile way.
  [
    'TTTTTT....TTTTTT',
    'T..............T',
    'T..TT......TT..T',
    'T..............T',
    'T..............T',
    'T..............T',
    'T..............T',
    '...............T',
    '...............T',
    'T..............T',
    'T...~~~~~~~....T',
    'T...~~~~~~~....T',
    'T.xx...........T',
    'T..............T',
    'TTTTTTTTTTTTTTTT'
  ]
];

function screenFromArt(rows) {
  if (rows.length !== LIMITS.screenRows) throw new Error(`screen needs ${LIMITS.screenRows} rows, got ${rows.length}`);
  const metatiles = [];
  rows.forEach((row, index) => {
    if (row.length !== LIMITS.screenCols) {
      throw new Error(`row ${index} is ${row.length} characters, expected ${LIMITS.screenCols}`);
    }
    for (const character of row) {
      const id = LEGEND[character];
      if (id === undefined) throw new Error(`unknown map character "${character}"`);
      metatiles.push(id);
    }
  });
  return { metatiles, entities: [] };
}

// --- assemble --------------------------------------------------------------

const project = createProject('Sample Quest');

const treeTiles = split16(TREE);
const background = project.tilesets[0].background.tiles;
background[1] = tile(GRASS);
background[2] = treeTiles[0];
background[3] = treeTiles[1];
background[4] = treeTiles[2];
background[5] = treeTiles[3];
background[6] = tile(WATER);
background[7] = tile(STONE);
background[8] = tile(THORNS);

project.palettes.bg = [
  [0x0f, 0x1a, 0x2a, 0x30], // grass
  [0x0f, 0x18, 0x0a, 0x1a], // tree: brown trunk, dark foliage, grass to match
  [0x0f, 0x01, 0x11, 0x21], // water
  [0x0f, 0x00, 0x10, 0x20] // stone
];
project.palettes.sprite = [
  [0x0f, 0x16, 0x27, 0x30], // player
  [0x0f, 0x0a, 0x2a, 0x30], // slime
  [0x0f, 0x17, 0x28, 0x30], // gem
  [0x0f, 0x14, 0x24, 0x30]
];

// Actor art at sprite tiles $20 onwards, four tiles per 16x16 frame.
const sprites = project.tilesets[0].sprites.tiles;
[SLIME_A, SLIME_B, GEM].forEach((art, frame) => {
  split16(art).forEach((quadrant, index) => {
    sprites[0x20 + frame * 4 + index] = quadrant;
  });
});

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

/** The same art mirrored, so a turn is visible without spending more tiles. */
const mirrored = (id, name, firstTile, palette) => ({
  id,
  name,
  tiles: [
    { x: 8, y: 0, tile: firstTile, palette, hflip: true, vflip: false },
    { x: 0, y: 0, tile: firstTile + 1, palette, hflip: true, vflip: false },
    { x: 8, y: 8, tile: firstTile + 2, palette, hflip: true, vflip: false },
    { x: 0, y: 8, tile: firstTile + 3, palette, hflip: true, vflip: false }
  ]
});

project.sprites = {
  metasprites: [
    metasprite(0, 'Slime A', 0x20, 1),
    metasprite(1, 'Slime B', 0x24, 1),
    metasprite(2, 'Gem', 0x28, 2),
    mirrored(3, 'Slime sideways', 0x20, 1)
  ],
  animations: [
    { id: 0, name: 'Slime idle', loop: true, frames: [{ metaspriteId: 0, duration: 16 }, { metaspriteId: 1, duration: 16 }] },
    { id: 1, name: 'Gem shine', loop: true, frames: [{ metaspriteId: 2, duration: 30 }] },
    // A mirrored frame, so facing left or right reads differently on screen.
    { id: 2, name: 'Slime sideways', loop: true, frames: [{ metaspriteId: 3, duration: 16 }] }
  ],
  actors: [
    { id: 0, name: 'Slime', behavior: 'patroller', speed: 1, hp: 1, anims: { idle: 0, walkSide: 2 } },
    { id: 1, name: 'Gem', behavior: 'pickup', speed: 1, hp: 1, anims: { idle: 1 } },
    { id: 2, name: 'Hunter', behavior: 'chaser', speed: 1, hp: 2, anims: { idle: 0, walkSide: 2 } },
    { id: 3, name: 'Portal', behavior: 'door', speed: 1, hp: 1, anims: { idle: 1 } },
    // Stands still and can be talked to, which is what an event needs: a
    // patroller would wander out of reach between one conversation and the next.
    { id: 4, name: 'Chest', behavior: 'npc', speed: 0, hp: 1, anims: { idle: 1 } },
    // The one thing in the sample that can hurt you, and the reason the health
    // bar appears at all. Static, and well off the corridors the ROM tests walk.
    { id: 5, name: 'Bramble', behavior: 'npc', speed: 0, hp: 3, damage: 1, anims: { idle: 0 } },
    // A one-time NPC: their event sets the switch that hides them, so once
    // you have spoken they are gone the next time the screen is entered.
    { id: 6, name: 'Wanderer', behavior: 'npc', speed: 0, hp: 1, anims: { idle: 0 } }
  ]
};

// The one item this project hands out, backed by the Gem pickup above.
// createProject() already supplies `items: []`, so without this the Chest's
// Give below would resolve to nothing the moment this generator's own
// output is loaded (see phase 3 round 2, item 1): an item-schema project is
// "already migrated" the instant it has an items array at all, so a legacy
// `actor`-valued Give never gets translated for one, only authored directly.
project.items = [{ id: 0, name: 'Gem', actorId: 1, metaspriteId: null }];

const setMetatile = (id, name, tiles, palette, collision) => {
  Object.assign(project.metatiles[id], { name, tiles, palette, collision });
};
setMetatile(0, 'Void', [0, 0, 0, 0], 0, 'open');
setMetatile(1, 'Grass', [1, 1, 1, 1], 0, 'open');
setMetatile(2, 'Tree', [2, 3, 4, 5], 1, 'solid');
setMetatile(3, 'Water', [6, 6, 6, 6], 2, 'water');
setMetatile(4, 'Stone wall', [7, 7, 7, 7], 3, 'solid');
// Painted ground that hurts: the tile-based half of the damage system, beside
// the Bramble's actor-based half. Walked through, never blocked.
setMetatile(5, 'Thorns', [8, 8, 8, 8], 1, 'damage');

// --- music -----------------------------------------------------------------
// Note 0 is C-1, so 36 is C-4 and 45 is A-4 (440 Hz).
const ROWS = 16;
const emptyChannel = () => new Array(ROWS).fill(null);
const place = (channel, entries, inst) => {
  for (const [row, note] of entries) channel[row] = { note, inst };
  return channel;
};

project.songs = [
  {
    name: 'Greenwood',
    tempo: { framesPerRow: 8 },
    instruments: [
      { id: 0, name: 'Lead', duty: 2, volEnv: [15, 14, 13, 12, 11, 10, 9, 8], sustain: 7 },
      { id: 1, name: 'Harmony', duty: 1, volEnv: [9, 8, 7, 6, 5], sustain: 4 },
      { id: 2, name: 'Percussion', duty: 0, volEnv: [12, 8, 4, 1, 0], sustain: 4 }
    ],
    patterns: [
      {
        id: 0,
        rows: ROWS,
        channels: {
          pulse1: place(emptyChannel(), [[0, 48], [2, 52], [4, 55], [6, 52], [8, 53], [10, 50], [12, 43], [14, 48]], 0),
          pulse2: place(emptyChannel(), [[0, 40], [4, 43], [8, 45], [12, 40]], 1),
          triangle: place(emptyChannel(), [[0, 24], [4, 24], [8, 29], [12, 31]], 0),
          noise: place(emptyChannel(), [[0, 20], [4, 20], [8, 20], [12, 20]], 2)
        }
      }
    ],
    order: [0],
    loop: 0
  }
];

const screens = SCREENS.map(screenFromArt);
// Placed on open ground, clear of the corridors the smoke test walks.
// The slime has something to say, which is what puts a message box in the demo
// — and what makes the font show up in the ROM at all.
screens[0].entities = [
  {
    actorId: 0,
    x: 64,
    y: 160,
    props: {
      dialogue:
        'A slime blocks the path, wobbling.\n\nIt does not seem to mind you at all, ' +
        'so you step around it and carry on.'
    }
  }
];
screens[1].entities = [
  { actorId: 0, x: 48, y: 64, props: {} },
  // The Wanderer leaves after one conversation: switch 1 is both what their
  // event sets and what hides them, the same trick as the chest but aimed at
  // the actor itself rather than its words.
  {
    actorId: 6,
    x: 176,
    y: 176,
    props: {
      hideSwitch: 1,
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [
              { op: 'say', text: 'I have seen what I came to see.\n\nFarewell, traveller.' },
              { op: 'setSwitch', switch: 1 }
            ]
          }
        ]
      }
    }
  }
];
screens[2].entities = [
  // In the open, so walking straight at it reaches it.
  { actorId: 1, x: 176, y: 144, props: {} },
  { actorId: 2, x: 32, y: 192, props: {} },
  // The chest: page one is guarded by the switch page one turns on, so it gives
  // its gem exactly once and is polite about it afterwards. This is the whole
  // point of events in one actor, and it is off the corridors the other tests
  // walk down.
  {
    actorId: 4,
    x: 208,
    y: 32,
    props: {
      event: {
        pages: [
          {
            cond: { type: 'switchOff', arg: 0 },
            commands: [
              { op: 'say', text: 'The lid gives, and a gem glitters up at you.' },
              { op: 'give', item: 0 },
              { op: 'setSwitch', switch: 0 }
            ]
          },
          { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'The chest is empty now.' }] }
        ]
      }
    }
  }
];
screens[3].entities = [
  { actorId: 1, x: 128, y: 64, props: {} },
  // Tucked into a corner of the pond room, clear of the north-south corridor.
  { actorId: 5, x: 32, y: 176, props: {} },
  // A portal at the foot of the north-south corridor, leading home to screen 0.
  { actorId: 3, x: 112, y: 144, props: { toScreen: 0, toX: 112, toY: 112 } }
];

// A second, single-screen map used only as the title. Keeping it out of the
// world means the title's decoration cannot be walked into, and the screens the
// game itself uses keep the flat indices the door targets were written against.
const TITLE_ART = [
  // Metatile rows 4-5 and 8-9 are left plain grass: those are the two bands the
  // engine forces to background palette 0 so the title text is legible, and art
  // drawn there would be recoloured. Designing around them is the whole skill of
  // making a title screen in the Forge.
  'TTTTTTTTTTTTTTTT',
  'T..............T',
  'T..TT......TT..T',
  'T..............T',
  '................',
  '................',
  'T..............T',
  'T....~~~~~~....T',
  '................',
  '................',
  'T..............T',
  'T....######....T',
  'T..TT#....#TT..T',
  'T..............T',
  'TTTTTTTTTTTTTTTT'
];

project.maps[0] = {
  id: 0,
  name: 'Greenwood',
  gridW: 2,
  gridH: 2,
  screens,
  songId: 0
};

project.maps[1] = {
  id: 1,
  name: 'Title',
  gridW: 1,
  gridH: 1,
  tilesetId: 0,
  songId: 0,
  screens: [screenFromArt(TITLE_ART)]
};
project.project.titleMap = 1;
project.project.titleScreen = 0;

// The engine only sees 64 bits; a name is what makes the event editor readable.
project.switches = ['Chest opened'];

project.project.startMap = 0;
project.project.startScreen = 0;
project.project.startX = 112;
project.project.startY = 112;

await saveProject(target, project);
console.log(`wrote sample project to ${target}`);
