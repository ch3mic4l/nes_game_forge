// The engine's built-in text face and the rules for when a project carries it.
//
// Single writer for: the glyph art, the character-to-tile mapping, the reserved
// tile ranges (96 background tiles for the font, two sprite tiles for the HUD
// hearts), and the predicates that decide when a project pays for them. The
// generator stamps these into the build-time CHR copies; the Tile Forge marks
// the ranges; validateProject refuses user art inside them — all from here, so
// the three can never disagree.
//
// Free of DOM and Node APIs: imported by the main process, the renderer and
// node:test alike.

import { compiledPages, damageAmount, liveCommands, projectEvents } from './eventrules.js';

// --------------------------------------------------------------- reserved map

/** First background tile the font occupies: 96 glyphs at $A0-$FF. */
export const FONT_BASE = 0xa0;
export const FONT_COUNT = 96;

/**
 * Sprite-table tiles the HUD hearts use when combat is in play. These share
 * their indices with two of the font's window glyphs, which is not a clash: the
 * font lives in the background pattern table and the hearts in the sprite one,
 * and the hardware reads them from different halves of the CHR bank.
 */
export const HEART_FULL_TILE = 0xfe;
export const HEART_EMPTY_TILE = 0xff;

/**
 * The battle targeting cursor's sprite tile, reserved only on a split-font
 * board (see fontBankSplit): there the background arrow glyph is in the font's
 * own CHR bank, which is switched in below the text windows — and the cursor
 * points at monsters *above* them, so it has to be a sprite instead.
 */
export const SPRITE_ARROW_TILE = 0xfd;

/** The message window's text area: 4 rows of 28 characters. */
export const BOX_COLS = 28;
export const BOX_ROWS = 4;

// ---------------------------------------------------------------- glyph art
//
// Each glyph is up to 8 rows of up to 8 columns, '#' = colour slot 3, '.' = the
// shared backdrop. Missing rows and short rows pad with backdrop, so lowercase
// bodies simply start at their x-height row. ASCII 32-127 is exactly 96 codes;
// the four rarely-typed codes { | } ~ are spent on window furniture and 127
// (DEL) on the page-advance arrow — see the named aliases at the bottom.

const G = {
  ' ': [],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '', '..#..'],
  '"': ['.#.#.', '.#.#.'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  "'": ['..#..', '..#..'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '*': ['', '..#..', '#.#.#', '.###.', '#.#.#', '..#..'],
  '+': ['', '..#..', '..#..', '#####', '..#..', '..#..'],
  ',': ['', '', '', '', '', '.##..', '..#..', '.#...'],
  '-': ['', '', '', '#####'],
  '.': ['', '', '', '', '', '.##..', '.##..'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['', '.##..', '.##..', '', '', '.##..', '.##..'],
  ';': ['', '.##..', '.##..', '', '', '.##..', '..#..'],
  '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
  '=': ['', '', '#####', '', '#####'],
  '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '', '..#..'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.##.', '#....', '.###.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '[': ['..###', '..#..', '..#..', '..#..', '..#..', '..#..', '..###'],
  '\\': ['#....', '.#...', '.#...', '..#..', '...#.', '...#.', '....#'],
  ']': ['###..', '..#..', '..#..', '..#..', '..#..', '..#..', '###..'],
  '^': ['..#..', '.#.#.', '#...#'],
  _: ['', '', '', '', '', '', '', '#####'],
  '`': ['.#...', '..#..'],
  a: ['', '', '.###.', '....#', '.####', '#...#', '.####'],
  b: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
  c: ['', '', '.###.', '#....', '#....', '#...#', '.###.'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  e: ['', '', '.###.', '#...#', '#####', '#....', '.###.'],
  f: ['..##.', '.#..#', '.#...', '###..', '.#...', '.#...', '.#...'],
  g: ['', '', '.####', '#...#', '#...#', '.####', '....#', '.###.'],
  h: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'],
  i: ['..#..', '', '.##..', '..#..', '..#..', '..#..', '.###.'],
  j: ['...#.', '', '..##.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  k: ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
  l: ['.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  m: ['', '', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  n: ['', '', '####.', '#...#', '#...#', '#...#', '#...#'],
  o: ['', '', '.###.', '#...#', '#...#', '#...#', '.###.'],
  p: ['', '', '####.', '#...#', '#...#', '####.', '#....', '#....'],
  q: ['', '', '.####', '#...#', '#...#', '.####', '....#', '....#'],
  r: ['', '', '#.##.', '##..#', '#....', '#....', '#....'],
  s: ['', '', '.####', '#....', '.###.', '....#', '####.'],
  t: ['.#...', '.#...', '###..', '.#...', '.#...', '.#..#', '..##.'],
  u: ['', '', '#...#', '#...#', '#...#', '#...#', '.####'],
  v: ['', '', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['', '', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['', '', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['', '', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  z: ['', '', '#####', '...#.', '..#..', '.#...', '#####'],
  // Window furniture. The frame lines run through the middle of the tile so one
  // tile serves both edges (the background has no flip bits), and the corner is
  // a bead both lines terminate into, which reads as a rounded corner.
  '{': ['', '', '', '########', '########'],
  '|': ['...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...'],
  '}': ['', '..####..', '.######.', '.######.', '.######.', '.######.', '..####..'],
  '~': ['########', '########', '########', '########', '########', '########', '########', '########'],
  '\x7f': ['', '', '#######.', '.#####..', '..###...', '...#....']
};

// Hearts are sprite tiles and use colour slot 1, which is red in the default
// sprite palette 0. Slot 0 stays transparent, as sprites always treat it.
const HEART_ART = {
  full: ['.##.##..', '#######.', '#######.', '#######.', '.#####..', '..###...', '...#....'],
  empty: ['.##.##..', '#..#..#.', '#.....#.', '#.....#.', '.#...#..', '..#.#...', '...#....']
};

/** Expand a rows-of-'#' sketch into the project's 64-character tile string. */
function rowsToTile(rows, slot = '3') {
  let out = '';
  for (let y = 0; y < 8; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < 8; x++) out += row[x] === '#' ? slot : '0';
  }
  return out;
}

/** The 96 font tiles in ASCII order, as 64-character tile strings. */
export const FONT_TILES = Array.from({ length: FONT_COUNT }, (_, index) =>
  rowsToTile(G[String.fromCharCode(32 + index)] ?? [])
);

export const HEART_TILES = {
  [HEART_FULL_TILE]: rowsToTile(HEART_ART.full, '1'),
  [HEART_EMPTY_TILE]: rowsToTile(HEART_ART.empty, '1')
};

// A right-pointing arrow for the sprite cursor, drawn in slot 1 like the
// hearts so it takes a colour every sprite palette actually defines.
export const SPRITE_ARROW_ART = rowsToTile(
  ['#....', '##...', '###..', '####.', '###..', '##...', '#....'],
  '1'
);

// ------------------------------------------------------------------ mapping

/** The background tile a character renders as, or null if it has no glyph. */
export function charToTile(char) {
  const code = char.codePointAt(0);
  if (code < 32 || code > 127) return null;
  return FONT_BASE + (code - 32);
}

/** Named window furniture, so nothing hardcodes the characters that carry it. */
export const TILE_SPACE = charToTile(' ');
export const BORDER_H = charToTile('{');
export const BORDER_V = charToTile('|');
export const BORDER_CORNER = charToTile('}');
export const BORDER_FILL = charToTile('~');
export const ARROW_TILE = charToTile('\x7f');

/**
 * Map a line of text to tile indices. Characters without a glyph become spaces
 * and are reported, so the compiler can warn once instead of dying mid-build.
 */
export function textToTiles(text) {
  const tiles = [];
  const unmapped = new Set();
  for (const char of text) {
    const tile = charToTile(char);
    if (tile === null) unmapped.add(char);
    tiles.push(tile ?? TILE_SPACE);
  }
  return { tiles, unmapped };
}

/**
 * Word-wrap authored text into message-window pages.
 *
 * Returns an array of pages, each an array of at most `rows` line strings of at
 * most `cols` characters. A newline forces a line break, a blank line forces a
 * page break, and overflow past `rows` starts a new page on a word boundary.
 * Shared by the build-time compiler and the event editor's preview, so what the
 * editor shows is what the ROM says.
 */
export function wrapText(text, cols = BOX_COLS, rows = BOX_ROWS) {
  const pages = [];
  let page = [];
  const flush = () => {
    if (page.length) pages.push(page);
    page = [];
  };
  const push = (line) => {
    if (page.length >= rows) flush();
    page.push(line);
  };

  for (const paragraph of String(text ?? '').split(/\n[ \t]*\n/)) {
    for (const hardLine of paragraph.split('\n')) {
      const words = hardLine.split(/[ \t]+/).filter(Boolean);
      if (!words.length) {
        push('');
        continue;
      }
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length <= cols) {
          line = candidate;
        } else if (line) {
          push(line);
          line = word.slice(0, cols);
        } else {
          line = word.slice(0, cols); // a single word longer than the window
        }
      }
      push(line);
    }
    flush(); // blank line in the source = page break
  }
  return pages;
}

// ---------------------------------------------------------------- predicates

/**
 * Does this project have a title screen that will actually be in the ROM —
 * `titleMap` set, *and* resolving to a map this project still has. Every
 * real consumer wants this, the effective question, not the raw value of
 * `titleMap` on its own: `kernelCodeBytes` (`main/build/generate.js`) budgets
 * `TITLE_KERNEL_ALLOWANCE_BY_MAPPER` against it, `generateAssets`'s own
 * `titleEnabled` *is* it (this function is that check's single writer now —
 * an earlier version duplicated it inline there, reasoning that the
 * `mapBase` it needed was already in hand from flattening the project's
 * screens for other reasons, so the duplicate cost nothing extra; that
 * missed the actual point, which is that a second implementation of the
 * same fact is exactly the drift this codebase's single-writer rule exists
 * to prevent), `validateProject`'s live-Save-needs-a-title-screen check
 * reads it directly, and so do `projectUsesText` just below,
 * `controller.js`'s title-row visibility and `map.js`'s own title-screen
 * picker.
 *
 * A project can carry a `titleMap` that names nothing — a hand edit, or a
 * map deleted without clearing the title that pointed at it.
 * `normalizeProject` cleans this up on load (a stale value is reset to
 * `null`), but a caller that reaches a project before or without going
 * through that clamp sees the stale value as-is, and a bare `titleMap !==
 * null` check cannot tell a stale reference from a real one. Both classes
 * of bug this predicate exists to prevent were exactly that mistake, made
 * in opposite directions: `validateProject` once approved a titleless-in-
 * effect Save project because a stale `titleMap` still read as non-null
 * (Continue with nowhere to appear — the first fix), and `kernelCodeBytes`
 * once charged the same stale project for a title screen that
 * `TITLE_ENABLED = 0` means will not be in the ROM (an overcharge
 * introduced *by* that first fix, in kernelCodeBytes's own OR against a
 * live Save — the second). There is no consumer left that wants the loose,
 * raw-intent answer instead: a title a stale reference no longer resolves
 * to is not a title screen that will exist in the ROM by any measure this
 * codebase's own build cares about, so there is nothing for a separate loose
 * predicate to be right about that this one is not.
 *
 * Single-writer by convention, not by anything a test can enforce: every
 * consumer is meant to import this rather than re-inline the same check,
 * but a behavioural test that feeds every consumer the same projects and
 * compares answers (see `test/unit/title.test.js`) can only ever catch a
 * consumer whose *answer* has drifted — it cannot tell a real import apart
 * from a consumer that happened to paste back the identical logic, since
 * the two are behaviourally indistinguishable by construction. That gap is
 * closed by review, not by this file, and is a known limit rather than an
 * oversight: this comment is the record of it, not a promise the tests
 * cover it.
 */
export function projectUsesEffectiveTitle(project) {
  const titleMap = project.project?.titleMap;
  return titleMap !== null && titleMap !== undefined && project.maps?.[titleMap] !== undefined;
}

/**
 * Does any part of the project put text on screen? True as soon as an entity
 * carries dialogue or an event, a title screen is chosen, the game is a
 * turn-based RPG (battles are text), or combat can reach the game-over screen.
 * The generator stamps the font and the Tile Forge reserves $A0-$FF exactly
 * when this is true, so a text-free project keeps all 256 tiles.
 */
export function projectUsesText(project) {
  if (project.project?.gameType === 'rpg') return true;
  if (projectUsesEffectiveTitle(project)) return true;
  if (projectUsesCombat(project)) return true;
  for (const map of project.maps ?? []) {
    for (const screen of map.screens ?? []) {
      for (const entity of screen.entities ?? []) {
        if (String(entity.props?.dialogue ?? '').trim()) return true;
      }
    }
  }
  // Every placed actor's event and every common event — a common event that a
  // `call` reaches is exactly as capable of putting text on screen as an
  // event authored directly on a placement, and it has no dialogue string of
  // its own to have already been caught above. Only an event that survives to
  // the ROM counts: one whose every command has been switched off compiles to
  // nothing, and reserving $A0-$FF — or on MMC3 a whole CHR page — for text
  // the cartridge does not contain would charge the author for work they took
  // back.
  for (const event of projectEvents(project)) {
    if (compiledPages(event).length > 0) return true;
  }
  return false;
}

/**
 * Does this build give the font its own CHR bank instead of stamping it into
 * every tileset? True on a board with a scanline interrupt (MMC3) when the
 * project shows text at all: the interrupt switches the font bank in where the
 * text windows start, so the $A0-$FF reservation disappears and the project
 * keeps all 256 background tiles. Single writer — the generator's stamping,
 * the Tile Forge's shading and validateProject's collision check all ask here,
 * so the three cannot disagree. Callers pass the *resolved* mapper
 * (shared/cartridge.js resolveMapper), keeping this module import-free.
 */
export function fontBankSplit(project, mapper) {
  return Boolean(mapper?.scanlineIrq) && projectUsesText(project);
}

/** CHR pages the font bank costs — what tilesetLimit calls reservedChrPages. */
export function fontChrPages(project, mapper) {
  return fontBankSplit(project, mapper) ? 1 : 0;
}

/**
 * Can the player be hurt? True when any actor deals damage or a damage-type
 * metatile is actually painted on a screen (merely defining one costs
 * nothing). Drives COMBAT_ENABLED, which gates whether combat.asm's contact
 * and hazard checks (entity_contact, player_hazard) can ever fire at all —
 * true for an RPG exactly as for an action project, since a monster's contact
 * damage starts a fight there instead of taking a heart, and the check that
 * decides whether to look still has to run. It does *not* by itself mean the
 * action-mode heart HUD is drawn or its sprite tiles reserved — see
 * projectUsesHeartArt, just below, for that.
 */
export function projectUsesCombat(project) {
  if ((project.sprites?.actors ?? []).some((actor) => (actor.damage ?? 0) > 0)) return true;
  const damaging = new Set(
    (project.metatiles ?? []).filter((tile) => tile.collision === 'damage').map((tile) => tile.id)
  );
  if (damaging.size) {
    for (const map of project.maps ?? []) {
      for (const screen of map.screens ?? []) {
        if (screen.metatiles.some((id) => damaging.has(id))) return true;
      }
    }
  }
  // A scripted Damage command reaches player_hp/hearts only in an action
  // project -- in an RPG it lands on pc_hp instead (engine/script.asm's
  // script_op_damage), which this predicate has nothing to do with:
  // BATTLE_ENABLED reserves the party art on its own. Only a command that
  // survives to the ROM counts, the same rule projectUsesText applies just
  // above -- via liveCommands rather than compiledPages, because a live
  // Damage sitting inside a switched-off branch would be exactly the "looks
  // functional, does nothing" case this codebase refuses to charge for. And
  // only one that would actually emit a nonzero byte: a Damage dropped onto a
  // page and left at its untouched default of 0 subtracts nothing, and
  // damageAmount (shared/eventrules.js) is the same clamp encodeCommand
  // (main/build/textcompile.js) applies to what it writes, so this cannot
  // reserve the hearts for a command the compiled ROM leaves harmless. Heal
  // never enters this predicate at all -- it cannot hurt anybody, at any
  // value.
  if (project.project?.gameType !== 'rpg') {
    for (const event of projectEvents(project)) {
      for (const page of compiledPages(event)) {
        for (const command of liveCommands(page.commands, BOX_ROWS)) {
          if (command.op === 'damage' && damageAmount(command.value) > 0) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Does this build draw the action-mode heart HUD and reserve its two sprite
 * tiles ($FE/$FF)? draw_hud and hurt_player (engine/combat.asm) are gated
 * `.if !BATTLE_ENABLED` -- the kernel diet that stops an RPG from assembling
 * code for a health model it cannot use also means it never draws hearts, so
 * an RPG must not keep the tiles reserved for a HUD that no longer exists:
 * a project could paint real party/portrait art there and the validator would
 * refuse it over a reservation the ROM does not contain. True exactly when
 * projectUsesCombat is, minus an RPG -- an RPG whose monsters carry contact
 * damage still needs COMBAT_ENABLED (that predicate, above), just not this
 * one.
 */
export function projectUsesHeartArt(project) {
  return projectUsesCombat(project) && project.project?.gameType !== 'rpg';
}
