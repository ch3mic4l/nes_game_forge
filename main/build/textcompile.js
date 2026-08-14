// Compiles a project's authored text into the strings and events the engine
// runs, through shared/font.js so the wrapping the editor previews is the
// wrapping the ROM performs.
//
// A string is glyph tiles with three control codes below the font's base: end,
// newline and page break. An event is a list of pages, each
// [cond, arg, value, body length, commands...], ended by EVT_PAGES_END; the
// engine runs the first page whose condition passes. Both tables are
// byte-indexed, so a project may carry at most 255 of each. A question's option
// labels are strings like any other, which is why they cost nothing new: two
// actors offering the same answer share the bytes it is written in.
//
// The header is a fixed four bytes even though only the conditions that compare
// a variable against a number read `value`: `script_skip` steps over a declined
// page without looking at its condition, so a header whose size depended on
// which condition it carried would have to be decoded before it could be
// skipped. EVT_PAGE_HEAD in engine/constants.asm is the other half of this.

import { BOX_COLS, BOX_ROWS, textToTiles, wrapText } from '../../shared/font.js';
import {
  CHOICE_LIMITS,
  EVENT_COMMANDS,
  EVENT_CONDITIONS,
  RPG_LIMITS,
  choiceLabel,
  conditionArgLimit,
  enabledCommands,
  compiledPages,
  entityLabel,
  screenLabel
} from '../../shared/project.js';

// String control codes, matching engine/constants.asm.
export const TXT_END = 0x00;
export const TXT_NEWLINE = 0x01;
export const TXT_PAGE = 0x02;

// Page conditions and command opcodes are numbered by their position in
// EVENT_CONDITIONS and EVENT_COMMANDS — that order *is* the wire format, so it
// is read from there rather than restated as a second list of constants.
export const condIndex = (id) => Math.max(0, EVENT_CONDITIONS.findIndex((entry) => entry.id === id));
export const opIndex = (id) => Math.max(0, EVENT_COMMANDS.findIndex((entry) => entry.id === id));
export const COND_NONE = 0;
export const EVT_PAGES_END = 0xff;
export const OP_END = 0x00;
export const OP_SAY = opIndex('say');

export const NO_EVENT = 0xff;
export const MAX_TABLE = 255; // $FF is the "none" marker in both tables
// Every length in this format is one byte: a page body's, and each side of a
// branch. `script_skip` adds it to the pointer, so 255 is the whole of it.
export const MAX_BODY = 255;
export const OP_JUMP = 0xfe; // the compiler's own punctuation; see constants.asm

/**
 * Authored text as engine bytes: pages of wrapped lines, then a terminator.
 * A page break costs one byte and a line break one, so what the editor shows as
 * four lines is what the box types.
 */
export function encodeString(text) {
  const bytes = [];
  const unmapped = new Set();
  wrapText(text, BOX_COLS, BOX_ROWS).forEach((page, pageIndex) => {
    if (pageIndex) bytes.push(TXT_PAGE);
    page.forEach((line, lineIndex) => {
      if (lineIndex) bytes.push(TXT_NEWLINE);
      const mapped = textToTiles(line);
      for (const char of mapped.unmapped) unmapped.add(char);
      bytes.push(...mapped.tiles);
    });
  });
  bytes.push(TXT_END);
  return { bytes, unmapped };
}

/**
 * Every event in the project, and which placed actor runs which.
 *
 * The returned `eventFor` is keyed by the entity objects themselves, because
 * that is what generate.js has in hand when it writes each screen's actor list
 * and it saves both sides agreeing on a naming scheme for the same thing.
 */
export function compileText(project) {
  const strings = [];
  const stringIds = new Map(); // identical text is stored once
  const events = [];
  const eventFor = new Map();
  const unmapped = new Set();

  const internString = (text) => {
    const encoded = encodeString(text);
    for (const char of encoded.unmapped) unmapped.add(char);
    const key = encoded.bytes.join(',');
    if (!stringIds.has(key)) {
      stringIds.set(key, strings.length);
      strings.push(encoded.bytes);
    }
    return stringIds.get(key);
  };

  // Warp targets are flat screen indices, the same space the door records use.
  const screenCount = (project.maps ?? []).reduce((total, map) => total + (map.screens?.length ?? 0), 0);
  const byte = (value, limit = 255) => Math.max(0, Math.min(limit, value | 0));

  // Lengths in this format are single bytes: a page body's, and a branch's two.
  // Nothing checked them before branches existed, because a page long enough to
  // overflow one would have been absurd to author a command at a time. A branch
  // makes it reachable, and a length that wrapped would send the engine into the
  // middle of a command — so it is refused here, naming what to shorten.
  const tooLong = [];
  const measureLength = (length, what) => {
    if (length > MAX_BODY) tooLong.push({ what, length });
    return length;
  };
  const measured = (bytes, what) => {
    measureLength(bytes.length, what);
    return bytes;
  };

  const encodeCondition = (cond) => [
    condIndex(cond?.type),
    byte(cond?.arg, conditionArgLimit(cond?.type)),
    byte(cond?.value)
  ];

  const encodeCommand = (command, where) => {
    switch (command.op) {
      case 'say':
        return [OP_SAY, internString(command.text ?? '')];
      case 'warp':
        return [
          opIndex('warp'),
          byte(command.screen, Math.max(0, screenCount - 1)),
          byte(command.x, 240),
          byte(command.y, 224)
        ];
      case 'give':
      case 'take':
        return [opIndex(command.op), byte(command.actor)];
      case 'setSwitch':
      case 'clearSwitch':
        return [opIndex(command.op), byte(command.switch, 63)];
      case 'setVar':
      case 'addVar':
      case 'subVar':
        return [opIndex(command.op), byte(command.variable, RPG_LIMITS.variables - 1), byte(command.value)];
      case 'join':
        return [opIndex('join'), byte(command.member, 3)];
      case 'branch': {
        // [OP_IF, cond, arg, value, then-length] then [OP_JUMP, else-length]
        // else. Past the opcode that is a page header exactly, which is what
        // lets the engine read a branch with the routine it reads a page with.
        //
        // The OP_JUMP pair is emitted even with nothing in the else-branch: it
        // is what a taken then-branch runs into, so leaving it out would need
        // the engine to work out whether there was one.
        const then = measured(encodeBody(command.then, `${where} → If`), `${where} → If`);
        const otherwise = measured(encodeBody(command.else, `${where} → Else`), `${where} → Else`);
        return [
          opIndex('branch'),
          ...encodeCondition(command.cond),
          then.length,
          ...then,
          OP_JUMP,
          otherwise.length,
          ...otherwise
        ];
      }
      case 'choice': {
        // [OP_CHOICE, count, one string id per option] and then one record per
        // option: [length, commands..., OP_JUMP, what is left of the question].
        //
        // The string ids are contiguous and up front so the engine can draw the
        // options straight out of the command it is sitting on — row n is the
        // n'th byte after the count — while script_ptr stays put on the choice
        // until it is answered. Only the answer walks the records.
        //
        // The trailing jump is the branch's, doing the branch's job: it is what
        // a finished option runs into, and it steps over the options below.
        // Every option carries one, including the last, so all of them end the
        // same way and none of them is a special case.
        //
        // Clamped here as well as in the schema, and for the reason the
        // condition's argument is: buildProject is handed the project the app is
        // holding rather than one that has just been through normalization. A
        // fifth option would be drawn a row below the last row of text, which is
        // the bottom of the frame and then the attribute table — and answering a
        // question with no options at all would send the engine past the end of
        // the command it was answering.
        const options = (command.options ?? []).slice(0, CHOICE_LIMITS.options);
        if (!options.length) return null;
        const named = (option, index) => `${where} → “${choiceLabel(option.text) || `option ${index + 1}`}”`;
        const bodies = options.map((option, index) => encodeBody(option.commands, named(option, index)));
        const lengths = bodies.map((body, index) =>
          measureLength(body.length + 2, named(options[index], index))
        );
        // How far each option has to jump to reach the end: every record below
        // it, each of them a length byte and what it describes. The first option
        // has the furthest to go, so measuring that one measures all of them.
        const past = lengths.map((_, index) =>
          lengths.slice(index + 1).reduce((sum, length) => sum + 1 + length, 0)
        );
        measureLength(past[0], `${where} → the options after the first`);
        return [
          opIndex('choice'),
          options.length,
          ...options.map((option) => internString(choiceLabel(option.text))),
          ...bodies.flatMap((body, index) => [lengths[index], ...body, OP_JUMP, past[index]])
        ];
      }
      default:
        return null;
    }
  };

  /**
   * A list of commands as bytes: a page's body, or one side of a branch. Not
   * measured here — a page's body carries an OP_END the branches do not, so
   * each caller measures the bytes its own length byte will have to describe.
   */
  const encodeBody = (commands, where) =>
    enabledCommands({ commands })
      .map((command) => encodeCommand(command, where))
      .filter(Boolean)
      .flat();

  const encodeEvent = (pages, where) => {
    const bytes = [];
    pages.forEach((page, index) => {
      const at = `${where}, page ${index + 1}`;
      const body = encodeBody(page.commands, at);
      body.push(OP_END);
      measured(body, at);
      // The argument's ceiling is the condition's own, not a flat 63: a variable
      // condition's byte indexes an array of 16 that the engine does not
      // range-check, and buildProject is handed the project the app is holding
      // rather than one that has just been through the schema.
      bytes.push(...encodeCondition(page.cond), body.length, ...body);
    });
    bytes.push(EVT_PAGES_END);
    return bytes;
  };

  for (const [mapIndex, map] of (project.maps ?? []).entries()) {
    for (const [screenIndex, screen] of (map.screens ?? []).entries()) {
      for (const entity of screen.entities ?? []) {
        // An authored event wins; plain dialogue becomes an event of one
        // unconditional page that says one thing, so the engine has a single
        // path for "talking to somebody" rather than a special case beside the
        // scripted one.
        // Only the pages that still do something. An event switched off command
        // by command until nothing is left is an event that is not there, which
        // is also why the plain dialogue underneath it comes back.
        const pages = compiledPages(entity.props?.event);
        const dialogue = String(entity.props?.dialogue ?? '').trim();
        if (!pages.length && !dialogue) continue;
        eventFor.set(entity, events.length);
        events.push(
          pages.length
            ? encodeEvent(
                pages,
                // Named the way the Map Forge names it, because a length problem
                // is reported to whoever has to go and shorten it.
                `${entityLabel(project, entity)} on ${screenLabel(project, mapIndex, screenIndex)}`
              )
            : // one unconditional page: [cond, arg, value, length], then Say and End
              [COND_NONE, 0, 0, 3, OP_SAY, internString(dialogue), OP_END, EVT_PAGES_END]
        );
      }
    }
  }

  const problems = [];
  for (const { what, length } of tooLong) {
    problems.push({
      severity: 'error',
      where: 'Map Forge',
      message:
        `${what} compiles to ${length} bytes and the engine can only step over ${MAX_BODY} at a ` +
        'time. Use fewer commands here — the count is commands, not characters, so long text ' +
        'costs no more than short — or move some of them onto another actor. A branch would not ' +
        'help, because everything inside one still counts towards the body holding it, and ' +
        'another page would not either, because pages are alternatives: only the first that ' +
        'matches runs.'
    });
  }
  if (strings.length > MAX_TABLE) {
    problems.push({
      severity: 'error',
      where: 'Map Forge',
      message: `This project has ${strings.length} pieces of dialogue and the engine holds ${MAX_TABLE}.`
    });
  }
  if (events.length > MAX_TABLE) {
    problems.push({
      severity: 'error',
      where: 'Map Forge',
      message: `This project has ${events.length} events and the engine holds ${MAX_TABLE}.`
    });
  }
  if (unmapped.size) {
    problems.push({
      severity: 'warning',
      where: 'Map Forge',
      message:
        `The font has no glyph for ${[...unmapped].map((char) => `"${char}"`).join(', ')}, ` +
        'so those characters are written as spaces.'
    });
  }

  return {
    strings,
    events,
    eventFor,
    problems,
    system: systemStrings(project),
    bytes: textSize(strings, events)
  };
}

/** Bytes the compiled text will occupy in the $E000 bank, including both tables. */
export function textSize(strings, events) {
  const total = (list) => list.reduce((sum, entry) => sum + entry.length, 0);
  const system = Object.values(systemStrings(null)).reduce(
    (sum, text) => sum + encodeString(text).bytes.length + TITLE_LINE_LIMIT,
    0
  ); // the project's own name is longer than the placeholder, so allow for it
  return (
    system +
    2 * Math.max(1, strings.length) +
    total(strings) +
    2 * Math.max(1, events.length) +
    total(events)
  );
}

/**
 * Strings the engine itself says, rather than the project. Always emitted — the
 * code that refers to them is always assembled, so the labels have to exist even
 * in a game with no dialogue of its own.
 *
 * The title lines are single-line and unwrapped on purpose: the title screen
 * writes them straight into the nametable during the same rendering-off window
 * that draws the screen, so it has no message box to wrap them into.
 */
export const TITLE_LINE_LIMIT = 28;

export function systemStrings(project) {
  const name = String(project?.project?.name ?? '')
    .toUpperCase()
    .replace(/[^\x20-\x7f]/g, '')
    .trim()
    .slice(0, TITLE_LINE_LIMIT);
  return {
    sys_title: name || 'UNTITLED',
    sys_press_start: 'PRESS START',
    // One page, deliberately: a blank line would be a page break, and the box
    // would sit waiting for a press before it had said what the press is for.
    sys_game_over: 'GAME OVER\nPress Start to try again.'
  };
}

/**
 * The assembly source. The pointer tables always exist, even for a project with
 * no text at all, because script.asm refers to them unconditionally.
 */
export function textTables({ strings, events, system = systemStrings(null) }) {
  const chunks = ['; Generated -- compiled dialogue strings and events.'];
  for (const [label, text] of Object.entries(system)) {
    chunks.push(`${label}:\n${dbRows(encodeString(text).bytes)}`);
  }
  const table = (name, list, prefix) => {
    const count = Math.max(1, list.length);
    chunks.push(`${name}_ptr_lo:\n${labelRow(count, (i) => `LOW(${prefix}_${i})`)}`);
    chunks.push(`${name}_ptr_hi:\n${labelRow(count, (i) => `HIGH(${prefix}_${i})`)}`);
    if (!list.length) chunks.push(`${prefix}_0:\n  .db $00`);
    else list.forEach((bytes, index) => chunks.push(`${prefix}_${index}:\n${dbRows(bytes)}`));
  };
  table('str', strings, 'str_data');
  table('event', events, 'event_data');
  return `${chunks.join('\n')}\n`;
}

const hex = (value) => `$${(value & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;

function dbRows(values, perLine = 16) {
  const lines = [];
  for (let i = 0; i < values.length; i += perLine) {
    lines.push(`  .db ${values.slice(i, i + perLine).map(hex).join(',')}`);
  }
  return lines.join('\n');
}

function labelRow(count, format, perLine = 8) {
  const lines = [];
  for (let i = 0; i < count; i += perLine) {
    const slice = [];
    for (let j = i; j < Math.min(i + perLine, count); j++) slice.push(format(j));
    lines.push(`  .db ${slice.join(',')}`);
  }
  return lines.join('\n');
}
