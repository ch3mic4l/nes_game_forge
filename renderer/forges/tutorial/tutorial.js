// Tutorial Forge: a guided tour of what every part of the app does and how the
// pieces fit together. Pure reading — it never touches the project — so each
// topic ends with a button that jumps to the Forge it just explained.

import { el, fill } from '../../ui.js';

// ------------------------------------------------------------ tiny helpers

const p = (...children) => el('p', null, ...children);
const b = (text) => el('strong', null, text);
const code = (text) => el('code', null, text);
const h3 = (text) => el('h3', null, text);

function table(headers, rows) {
  return el(
    'table.tutorial-table',
    null,
    el('thead', null, el('tr', null, headers.map((cell) => el('th', null, cell)))),
    el('tbody', null, rows.map((row) => el('tr', null, row.map((cell) => el('td', null, cell)))))
  );
}

function tip(...children) {
  return el('div.tutorial-tip', null, ...children);
}

// ----------------------------------------------------------------- topics

const TOPICS = [
  {
    id: 'start',
    label: 'How it fits together',
    glyph: '⚒',
    forge: null,
    render: () => [
      p(
        'NES Game Forge builds ',
        b('real NES cartridges'),
        '. A project is a folder of JSON; pressing Build turns it into assembly, runs the ',
        code('nesasm'),
        ' assembler, and produces a ',
        code('.nes'),
        ' ROM that plays in the built-in emulator — or on real hardware.'
      ),
      p('Each Forge on the left owns one part of the game:'),
      table(
        ['Forge', 'What you make there'],
        [
          ['▦ Tile', 'The pixel art: background tiles, sprite tiles, palettes — and the player character'],
          ['👾 Sprite', 'Metasprites, animations, and the actors that walk your world'],
          ['🗺 Map', 'Metatiles, screens, actor placement, dialogue, events, doors'],
          ['♪ Sound', 'Music, in a four-channel tracker'],
          ['🎮 Control', 'What every button does, in every game state'],
          ['⚙ Build', 'The cartridge type, capacity, the ROM itself, and a debugger']
        ]
      ),
      p(
        'A good first session: draw a few tiles, group them into metatiles in the Map Forge, ',
        'paint a screen, press ',
        b('Build & Play'),
        '. A brand-new project is playable immediately — while the player tiles are empty, ',
        'the build draws a placeholder character so there is always something to walk around with.'
      ),
      h3('Saving and undoing'),
      p(
        code('Ctrl+S'),
        ' saves. ',
        code('Ctrl+Z'),
        ' / ',
        code('Ctrl+Shift+Z'),
        ' undo and redo — every edit in every Forge goes through the same history, and a drag ',
        'of the pencil counts as one step, not fifty.'
      ),
      tip(
        'Want a worked example? Run ',
        code('npm run sample'),
        ' in the project folder and open ',
        code('./sample'),
        ' — a small field with a talking slime, a chest, a chaser and collectable gems. ',
        code('npm run sample:rpg'),
        ' writes a turn-based RPG demo next to it.'
      )
    ]
  },
  {
    id: 'tile',
    label: 'Tile Forge',
    glyph: '▦',
    forge: 'tile',
    render: () => [
      p(
        'Everything on an NES screen is built from 8×8-pixel tiles. A ',
        b('tileset'),
        ' holds 256 background tiles and 256 sprite tiles — the two tabs at the top — and is ',
        'the unit the cartridge swaps as one graphics bank.'
      ),
      p(
        'Draw with the pencil at 1×1, or switch the region size to 2×2 or 4×4 to work on a ',
        'block of tiles as one image — that is how anything bigger than 8×8 is made. ',
        'Colours come from the palette strip: four background palettes and four sprite ',
        'palettes, each three colours plus the shared backdrop.'
      ),
      h3('The player lives here'),
      p(
        'The player character is drawn in this Forge, not the Sprite Forge: the engine reads ',
        'sprite tiles ',
        code('$00–$1F'),
        ' as four directions × two walk frames (down, up, left, right — four tiles each). ',
        'Use the 4×4 region on the Sprites tab and draw each pose as one 16×16 block.'
      ),
      h3('Importing art'),
      p(
        'The Import button accepts an ordinary image and quantises it to NES colours with ',
        'dithering, or raw ',
        code('CHR'),
        ' / ',
        code('PAL'),
        ' files if you already work in another NES tool. Export goes the other way.'
      ),
      tip(
        'If your game shows dialogue, tiles ',
        code('$A0–$FF'),
        ' of every background table are shaded: the message font is stamped there at build ',
        'time. On an MMC3 cartridge the shading disappears — that board gives the font its ',
        'own graphics bank, so you keep all 256 tiles. See the Dialogue topic.'
      )
    ]
  },
  {
    id: 'sprite',
    label: 'Sprite Forge',
    glyph: '👾',
    forge: 'sprite',
    render: () => [
      p(
        'Three tabs. ',
        b('Metasprites'),
        ' assemble sprite tiles into one figure — a slime, a chest, a townsperson. ',
        b('Animations'),
        ' sequence metasprites on a timeline with a live preview. ',
        b('Actors'),
        ' bind an animation set to a behaviour, which is what you place on maps.'
      ),
      p('An actor gets one animation per situation — walk down, walk up, walk sideways, idle, attack, hurt — each falling back to idle when left empty. Its behaviour decides how it moves:'),
      table(
        ['Behaviour', 'What the engine does'],
        [
          ['Patroller', 'Walks a straight line, reverses at walls and screen edges'],
          ['Chaser', 'Steps toward the player on each axis, so walls deflect it'],
          ['Pickup', 'Vanishes when touched and goes into the inventory'],
          ['Door', 'Warps the player to another screen (set where it is placed)'],
          ['NPC', 'Stands still and can be talked to — chests, signs, townsfolk'],
          ['Player', 'Marks the player actor, spawned at the map start position']
        ]
      ),
      p(
        'Two numbers make an actor dangerous or durable: ',
        b('contact damage'),
        ' costs the player a heart on touch, and ',
        b('hit points'),
        ' decide how many attacks it survives.'
      ),
      tip(
        'In a turn-based RPG project this Forge also grows a ',
        b('Party'),
        ' tab (members, stats, spells) and an ',
        b('In battle'),
        ' section on each actor (a monster’s stats, element, gold and drops). ',
        'See the Turn-based RPGs topic.'
      )
    ]
  },
  {
    id: 'map',
    label: 'Map Forge',
    glyph: '🗺',
    forge: 'map',
    render: () => [
      p(
        'Maps are painted in ',
        b('metatiles'),
        ': 16×16 blocks of four tiles carrying their own palette and a collision type ',
        '(walkable, solid, or damage). Build them in the left panel, then stamp them onto ',
        'the screen. A metatile lines up exactly with one NES attribute square, which is why ',
        'each one can have its own palette with no compromise.'
      ),
      p(
        'One screen is 16×15 metatiles — one NES nametable. A map is a grid of screens; ',
        'walking off an edge loads the neighbour. The navigator below the canvas moves ',
        'between screens and adds new ones.'
      ),
      h3('The tools'),
      table(
        ['Tool', 'Does'],
        [
          ['▪ Stamp', 'Paint the selected metatile (right-click erases)'],
          ['▭ Rect / ▨ Fill', 'Rectangles and flood fill of the same'],
          ['💧 Pick', 'Grab the metatile under the cursor, then return to Stamp'],
          ['⚑ Start', 'Set where the player begins'],
          ['☗ Actor', 'Place an actor from the Sprite Forge — up to eight per screen']
        ]
      ),
      p(
        'A placed actor is where gameplay is wired up: a door gets its destination, an NPC ',
        'gets dialogue or an event, an actor can be hidden once a switch is set. Each map also ',
        'names its tileset and its song, and the map settings hold the battle backdrop and ',
        'encounter table in RPG projects.'
      ),
      tip(
        'Point ',
        b('Title screen'),
        ' at any screen and the cartridge boots into it, with the game’s name and a blinking ',
        'PRESS START over it. Keep metatile rows 4–5 and 8–9 clear — that is where the text lands.'
      )
    ]
  },
  {
    id: 'dialogue',
    label: 'Dialogue & events',
    glyph: '💬',
    forge: 'map',
    render: () => [
      p(
        'Give a placed actor something to say in the Map Forge and it gets a ',
        b('message box'),
        ': a window along the bottom of the screen, text typed out a letter at a time, ',
        '▼ to turn the page. The world freezes while it is open.'
      ),
      p(
        'Text costs background tiles ',
        code('$A0–$FF'),
        ' of every tileset — the font has to live somewhere — and the Tile Forge shades the ',
        'range so nothing is quietly overwritten. A game that never shows text keeps all 256 ',
        'tiles. On ',
        b('MMC3'),
        ' every game keeps all 256: that cartridge’s scanline interrupt switches a dedicated ',
        'font bank in exactly where the text windows start, mid-frame.'
      ),
      h3('Events'),
      p(
        'A line of dialogue is the simple case. ',
        b('Event…'),
        ' on a placed actor is the rest: a list of ',
        b('pages'),
        ', where the engine runs the first page whose condition holds. A page can show text, ',
        'give or take an item, set or clear one of 64 ',
        b('switches'),
        ', warp the player, or recruit a party member.'
      ),
      p('The whole trick behind a chest that opens once:'),
      table(
        ['Page', 'Condition', 'Does'],
        [
          ['1', 'Switch “Chest opened” is off', 'Say “A gem glitters up at you”, give the Gem, set the switch'],
          ['2', 'Always', 'Say “The chest is empty.”']
        ]
      ),
      p(
        'Switches survive screen changes and warps, so they are also how an actor leaves for ',
        'good: ',
        b('Gone once…'),
        ' on a placed actor means it does not spawn while its switch is on. Name your ',
        'switches with the ',
        b('Switches…'),
        ' button — the engine sees 64 bits, but the editor reads better with words.'
      )
    ]
  },
  {
    id: 'combat',
    label: 'Health & damage',
    glyph: '♥',
    forge: 'sprite',
    render: () => [
      p(
        'An actor with ',
        b('contact damage'),
        ' above zero costs the player a heart on touch; a metatile with the ',
        b('Damage'),
        ' collision type does the same to anyone standing on it. Either way the player is ',
        'thrown clear, flickers, and is invincible for a second.'
      ),
      p(
        'Hearts appear along the top of the screen. Actors have hit points too: the ',
        b('Attack'),
        ' action beats the nearest actor within reach, taking one hit point per swing.'
      ),
      p(
        'Running out of hearts is ',
        b('GAME OVER'),
        ', and Start from there returns to the title — or straight into a new game if there ',
        'is no title. It is a genuinely new game: hearts, bag and switches all reset.'
      ),
      tip(
        'All of this is conditional. A game where nothing deals damage draws no health bar ',
        'and spends nothing on one — the two sprite tiles the hearts would use stay yours.'
      )
    ]
  },
  {
    id: 'rpg',
    label: 'Turn-based RPGs',
    glyph: '⚔',
    forge: 'sprite',
    render: () => [
      p(
        'Choose ',
        b('Turn-based RPG'),
        ' when creating a project and the cartridge gains a battle system: random ',
        'encounters, FIGHT / MAGIC / ITEM / RUN menu battles, experience, gold, levels, ',
        'elements, poison and drops.'
      ),
      p(
        'The choice is made once, up front, because it decides the cartridge as well as the ',
        'engine — the battle system lives in a switchable program bank, which rules out the ',
        'simplest boards. RPG projects start on MMC1, which is what Final Fantasy shipped on.'
      ),
      h3('Where everything is set'),
      table(
        ['Where', 'What you set'],
        [
          ['Sprite ▸ Party', 'Up to four members: stats, growth per level, spells learned and when'],
          ['Sprite ▸ Party ▸ Spells…', 'The spell list — cost, damage or healing, element, one target or all'],
          ['Sprite ▸ Actors ▸ In battle', 'A monster’s stats, experience, gold, weakness, resistance and drop'],
          ['Map ▸ Battles here', 'The battle backdrop, encounter rate, and which monsters appear'],
          ['Build ▸ RPG progression', 'The experience curve, level cap, and the monster-art tileset']
        ]
      ),
      p(
        'An actor becomes a monster by having contact damage above zero — walking into one ',
        'placed on the map starts a fight you cannot run from; the step counter starts ones ',
        'you can. Give a monster ',
        b('battle artwork'),
        ' (a block of background tiles) for a proper portrait, or leave it off and its ',
        'ordinary animation fights as sprites — every actor you have can fight without being redrawn.'
      ),
      p(
        'Members past the first are recruited in play with an event’s ',
        b('Party member joins'),
        ' command, and an ',
        b('item'),
        ' is just an actor with a Heals value: pick it up on the field and it appears in ',
        'battle under ITEM.'
      )
    ]
  },
  {
    id: 'sound',
    label: 'Sound Forge',
    glyph: '♪',
    forge: 'sound',
    render: () => [
      p(
        'A tracker: rows of notes down the page, one column per channel — two pulse waves, ',
        'the triangle, and noise for percussion. Notes are entered from the keyboard, ',
        'patterns are arranged by an order list with a loop point.'
      ),
      p(
        b('Instruments'),
        ' carry a duty cycle (the pulse channels’ timbre) and a volume envelope. The ',
        'triangle ignores both, because the NES gives it neither — it is always the same ',
        'soft wave, which is why it usually carries the bassline.'
      ),
      p(
        'Assign a song to a map in the Map Forge and the engine starts it there. The preview ',
        'in this Forge plays through a replayer that is tested byte-for-byte against the real ',
        'ROM’s sound driver, so what you hear is what the cartridge plays — pitch, rhythm and ',
        'volume exactly; only the timbre is approximate.'
      )
    ]
  },
  {
    id: 'controller',
    label: 'Controller Forge',
    glyph: '🎮',
    forge: 'controller',
    render: () => [
      p(
        'The D-pad always walks. A, B, Select and Start are yours to bind, and every ',
        'binding is compiled into a table the engine reads each frame — rebinding is a data ',
        'change, not an engine change.'
      ),
      table(
        ['Action', 'What the engine does'],
        [
          ['Attack', 'Beats the nearest non-pickup actor within reach'],
          ['Interact', 'Collects a nearby pickup, or talks to any other actor in reach'],
          ['Dash', 'Doubles walking speed while held'],
          ['Pause', 'Freezes everything until pressed again'],
          ['Item', 'Opens and closes the inventory'],
          ['Confirm', 'Spends the highlighted item, or turns a dialogue page'],
          ['Cancel', 'Closes the inventory, or turns a dialogue page']
        ]
      ),
      p(
        'The table has one row per ',
        b('game state'),
        ' — walking around, in the menu, reading dialogue, on the title, and so on — and the ',
        'engine reads the row for the state it is in. That is why Item, Confirm and Cancel ',
        'exist: they are what buttons do while the world is frozen.'
      ),
      p(
        'An action bound in a state where it means nothing (Confirm while walking around, ',
        'Attack inside a menu) is marked “ignored here” and ignored — never silently ',
        'reinterpreted as something else.'
      )
    ]
  },
  {
    id: 'build',
    label: 'Build & Play',
    glyph: '⚙',
    forge: 'build',
    render: () => [
      p(
        b('Build'),
        ' generates assembly from the project, assembles it with ',
        code('nesasm'),
        ', verifies the ROM, and reports capacity — how full each part of the cartridge is. ',
        'Any limit you hit is reported in plain language naming the Forge responsible, ',
        'before the assembler ever runs.'
      ),
      h3('The cartridge'),
      p(
        'The cartridge type (the ',
        b('mapper'),
        ') is chosen here, and it is what decides how big the game can be: NROM (the ',
        'default) holds one tileset and one bank of screens; boards like MMC1 and MMC3 ',
        'switch program and graphics banks for many times that. The panel lists every ',
        'board’s capacity, and greys out any the project cannot use — an RPG needs a board ',
        'that can switch program banks, and the reason is written next to the choice.'
      ),
      h3('Play and debug'),
      p(
        'The built ROM plays right in the panel. Behind the screen sits a full debugger: ',
        'breakpoints, step / over / out, scanline and frame stepping, a disassembly view ',
        'that knows the engine’s symbols, a memory editor, and PPU viewers for the ',
        'nametables, pattern tables and palettes.'
      ),
      p(
        '“Open in Mesen” hands the same ROM to a second, independent emulator — useful as a ',
        'cross-check, and for anything a JavaScript emulator cannot cover. The ROM file in ',
        'the project’s ',
        code('build/'),
        ' folder is a perfectly ordinary ',
        code('.nes'),
        ' — it runs anywhere, including real hardware with a flash cartridge.'
      )
    ]
  },
  {
    id: 'mappers',
    label: 'Cartridges & mappers',
    glyph: '🗄',
    forge: 'build',
    render: () => [
      p(
        'The NES console itself can only see 32 KB of program and 8 KB of graphics at a ',
        'time. Every game bigger than that ships extra chips ',
        b('on the cartridge'),
        ' that swap what the console sees — a ',
        b('mapper'),
        '. Which mapper a project uses is chosen in the Build panel, and it sets two ',
        'ceilings: how many ',
        b('tilesets'),
        ' the game can hold (each is one 8 KB graphics bank) and how many ',
        b('screen banks'),
        ' (each is 16 KB of map data — around 45 screens, a little fewer where actors are dense).'
      ),
      table(
        ['Board', 'Tilesets', 'Screen banks', 'What it does'],
        [
          [b('NROM-256'), '1', '1', 'No switching at all — everything is mapped at once. The default, and enough for a small game.'],
          [b('CNROM'), '4', '1', 'Adds graphics switching: each map can pick which tileset it draws with. Program space stays NROM-sized.'],
          [b('GxROM'), '4', '1', 'The same capacity as CNROM on a licensed Nintendo board — prefer it if you intend to have real cartridges made.'],
          [b('Color Dreams'), '16', '1', 'The most tilesets without program switching. An unlicensed board: fine in every emulator, rarer as a real reproduction cartridge.'],
          [b('UxROM'), '1', '7', 'The opposite trade: one fixed tileset, but seven switchable banks of screens. Pick it when you run out of world, not art.'],
          [b('MMC1'), '16', '7', 'Switches both program and graphics. The mapper more NES games used than any other, and what Final Fantasy and Zelda shipped on.'],
          [b('MMC3'), '32', '15', 'The largest board here, with a bonus: its scanline interrupt gives the message font its own graphics bank (see below).'],
          [b('UNROM 512'), '4', '31', 'A modern homebrew board. Its graphics are RAM filled from program space at boot, so each tileset costs about one screen bank.']
        ]
      ),
      h3('Three boards with a twist'),
      p(
        b('MMC3'),
        ' can interrupt the CPU at an exact scanline, and the engine uses that to switch a ',
        'dedicated font bank in mid-frame, exactly where a text window starts. On every other ',
        'board a game with dialogue gives up background tiles ',
        code('$A0–$FF'),
        ' in every tileset to the font; on MMC3 you keep all 256.'
      ),
      p(
        b('UNROM 512'),
        ' has no graphics ROM at all — its four pattern pages are RAM, and the engine copies ',
        'each tileset into place from program space at boot. That is why its tilesets consume ',
        'screen capacity, and it is the only board offering four-screen mirroring (at the ',
        'cost of one more tileset).'
      ),
      p(
        b('MMC1'),
        ' and ',
        b('MMC3'),
        ' are the boards a ',
        b('turn-based RPG'),
        ' can use, along with UNROM 512: the battle system lives in a switchable program ',
        'bank and monster art in a switchable tileset, so the board must swap both. The ',
        'Build panel greys out anything the project cannot use and says why.'
      ),
      tip(
        'Switching mappers later is safe in the shrinking direction too — the Build panel ',
        'recomputes capacity immediately and tells you what no longer fits, before the ',
        'assembler ever runs. Start on NROM and move up when a capacity bar fills.'
      )
    ]
  }
];

// ------------------------------------------------------------------ mount

export function mount(container, app) {
  let activeId = TOPICS[0].id;

  const nav = el('div.panel-body.tight');
  const page = el('div.tutorial-page');

  function select(id) {
    activeId = id;
    const index = TOPICS.findIndex((topic) => topic.id === id);
    const topic = TOPICS[index];
    const prev = TOPICS[index - 1];
    const next = TOPICS[index + 1];
    renderNav();
    fill(
      page,
      el(
        'div.tutorial-body',
        null,
        el('h2', null, `${topic.glyph}  ${topic.label}`),
        topic.render(),
        topic.forge
          ? el(
              'p',
              null,
              el(
                'button.btn.btn-accent',
                { onclick: () => app.goTo(topic.forge) },
                `Open the ${forgeName(topic.forge)} →`
              )
            )
          : null,
        el(
          'div.tutorial-nav',
          null,
          prev ? el('button.btn.btn-sm', { onclick: () => select(prev.id) }, `← ${prev.label}`) : el('span'),
          next ? el('button.btn.btn-sm', { onclick: () => select(next.id) }, `${next.label} →`) : el('span')
        )
      )
    );
    page.scrollTop = 0;
  }

  function forgeName(id) {
    return { tile: 'Tile Forge', sprite: 'Sprite Forge', map: 'Map Forge', sound: 'Sound Forge', controller: 'Controller Forge', build: 'Build panel' }[id] ?? id;
  }

  function renderNav() {
    fill(
      nav,
      TOPICS.map((topic) =>
        el(
          'button.tutorial-topic',
          {
            class: topic.id === activeId ? 'active' : '',
            dataset: { topic: topic.id },
            onclick: () => select(topic.id)
          },
          el('span.tutorial-topic-glyph', null, topic.glyph),
          topic.label
        )
      )
    );
  }

  container.append(
    el(
      'div.forge',
      { style: { gridTemplateColumns: '230px 1fr' } },
      el('div.panel', null, el('div.panel-head', null, 'Topics'), nav),
      page
    )
  );

  select(activeId);
  return {};
}
