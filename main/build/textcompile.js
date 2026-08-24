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
//
// project.commonEvents share this same events table: a common event compiles
// through the same encodeEvent as a placement's, and OP_CALL's one-byte
// argument is the table slot it landed in, resolved from project.commonEvents'
// own index by commonEventTableIndex before anything is encoded. The engine
// remembers where to come back to on a small fixed stack (call_ret_lo/hi in
// engine/constants.asm) rather than anything this module tracks — a call is a
// jump the engine can unwind, not a shape the compiler flattens.

import { BOX_COLS, BOX_ROWS, textToTiles, wrapText } from '../../shared/font.js';
import {
  CHOICE_LIMITS,
  EVENT_COMMANDS,
  EVENT_CONDITIONS,
  MOVE_DIRECTIONS,
  MOVE_TARGETS,
  RPG_LIMITS,
  actorMissing,
  battleFormationSlice,
  NO_ACTOR,
  choiceLabel,
  choiceOptionsSlice,
  conditionArgLimit,
  enabledCommands,
  compiledPages,
  entityLabel,
  screenLabel,
  liveCommonEvents,
  commonEventId
} from '../../shared/project.js';
import { damageAmount } from '../../shared/eventrules.js';

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

export const OP_CALL = opIndex('call');
export const OP_MUSIC = opIndex('music');
export const OP_BATTLE = opIndex('battle');

export const NO_EVENT = 0xff;
// A map's own songId is $FF for the same reason (see generate.js's maps.inc),
// so a screen change and a Play music command reach the engine's NO_SONG
// through the same byte, no matter which one decided it.
export const NO_SONG = 0xff;
// An empty formation slot: the same sentinel shared/project.js's
// mapEncounterFormation pads a map's own (random) encounter table with, so
// mon_slot_actor reads one byte shape regardless of which of the two ever
// filled it. Defined there rather than here now that the schema writes it
// too (renumberActorDeletion), and re-exported so every existing importer of
// it still reads the same one byte from the same definition.
export { NO_ACTOR };
// OP_CALL's own operand: the table slot the named common event would occupy,
// or this when nothing resolves -- deleted since, never live to begin with,
// or a `call` never given a target. Named apart from shared/project.js's own
// `NO_COMMON_EVENT_ID` (-1) on purpose, not just kept in separate modules:
// that one is a schema-level "no reference chosen" value `command.event` can
// hold before compiling, in the same space real ids live in, so importing
// the wrong sentinel into the wrong place would not fail loudly -- $FF read
// as a schema id would go looking for a stable id 255 could really have.
// This is the wire-level byte script_op_call reads and refuses, in the same
// $FF space every other table-slot sentinel here uses, safe for the
// identical reason MAX_TABLE below caps the table at 255 entries -- $FF can
// never be a real slot.
export const NO_COMMON_EVENT_SLOT = 0xff;
export const MAX_TABLE = 255; // $FF is the "none" marker in both tables
// Every length in this format is one byte: a page body's, and each side of a
// branch. `script_skip` adds it to the pointer, so 255 is the whole of it.
export const MAX_BODY = 255;
export const OP_JUMP = 0xfe; // the compiler's own punctuation; see constants.asm

/**
 * The byte a song id becomes: NO_SONG for Silence, or for an id that is not a
 * live song any more — deleted since, or never valid to begin with. Shared by
 * a map's own songId (generate.js's map_song table) and a Play music command's
 * argument, so the two reach the same answer for the same value rather than
 * one clamping loosely in the schema and the other trusting it outright.
 * Takes `songs` rather than a whole project because generate.js calls this
 * once per map from inside a `.map()`, not once for the whole project.
 */
export function songByte(songs, id) {
  if (id === null || id === undefined) return NO_SONG;
  const n = Number(id);
  return Number.isInteger(n) && n >= 0 && n < (songs?.length ?? 0) ? n : NO_SONG;
}

/**
 * The byte a Give item / Take item command's `actor` becomes: NO_ACTOR for
 * anything `actorMissing` (shared/project.js) says does not resolve —
 * `null` (renumberActorDeletion's mark for a deleted actor), or any other
 * id no actor sits at, the same shape songByte gives a stale or absent
 * song. `actorMissing` is also what validateProject asks, so the two agree
 * on the same question rather than one trusting a sentinel the other
 * merely happens to write. engine/script.asm's script_op_give/
 * script_op_take are the other half — a live command with an unresolvable
 * actor is a validateProject error, but buildProject compiles the project
 * the app is holding rather than one that has passed validation, so this
 * still has to not hand add_item/remove_item a byte that indexes the
 * actor tables past their end.
 */
export function actorByte(actors, id) {
  return actorMissing(actors, id) ? NO_ACTOR : id;
}

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
  // A battle command's monster ids are the only case, besides a song, where
  // an out-of-range reference has to be caught here rather than at the field
  // it is a byte clamp everywhere else: an actor deleted since the command
  // was authored (or a hand-edited id that was never valid) would otherwise
  // index setup_monsters' own tables past their end, exactly the reason
  // songByte exists for a stale song id.
  const actorCount = project.sprites?.actors?.length ?? 0;
  const byte = (value, limit = 255) => Math.max(0, Math.min(limit, value | 0));

  // Which slot of the shared events table each common event lands in, keyed by
  // its stable id rather than its position in project.commonEvents — a call
  // stores that id, not a position, so deleting an earlier common event must
  // not silently retarget every call naming a later one. liveCommonEvents
  // (shared/project.js) is what says which entries get a slot at all and
  // which id each one carries: buildProject is handed the project the app is
  // holding, which may not have been through normalizeProject since a common
  // event was added, so this cannot simply trust entry.id to already be there
  // — the same reason screenCount above is recomputed rather than trusted.
  // Decided before anything is encoded, because a `call` may be compiled
  // while encoding either a placement's event or another common event, and
  // either can come first. The entries are then the first things pushed into
  // `events` below, in this same order, so the slot predicted here is the
  // slot they actually land in. One with nothing live in it gets no slot at
  // all: a call naming it carries NO_COMMON_EVENT_SLOT below instead, for
  // script_op_call (engine/script.asm) to refuse.
  const commonEventTableIndex = new Map();
  const liveCommonEventEntries = liveCommonEvents(project);
  liveCommonEventEntries.forEach(({ id }, slot) => commonEventTableIndex.set(id, slot));

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
        return [opIndex(command.op), actorByte(project.sprites?.actors, command.actor)];
      case 'setSwitch':
      case 'clearSwitch':
        return [opIndex(command.op), byte(command.switch, 63)];
      case 'setVar':
      case 'addVar':
      case 'subVar':
        return [opIndex(command.op), byte(command.variable, RPG_LIMITS.variables - 1), byte(command.value)];
      // damageAmount (shared/eventrules.js) rather than the local byte()
      // above: normalizeEventCommand, projectUsesCombat (shared/font.js) and
      // the Map Forge's own number field all have to agree with this on the
      // same question, so this is the one place every one of them derives a
      // Heal/Damage value from, not four clamps that can drift.
      case 'heal':
        return [opIndex('heal'), damageAmount(command.value)];
      case 'damage':
        return [opIndex('damage'), damageAmount(command.value)];
      // No operand: one save slot, so there is nothing to name.
      case 'save':
        return [opIndex('save')];
      // [who, direction, distance]. Both selectors are stored in the project as
      // ids and become their list positions here, which is the one place that
      // mapping happens -- MOVE_DIRECTIONS is in the engine's own DIR_* order,
      // so the byte written is the byte ent_dir wants. An id this version does
      // not know (a project written by a later one) falls back to the first
      // entry rather than compiling a byte past the end of either list.
      case 'move': {
        const who = Math.max(0, MOVE_TARGETS.findIndex((entry) => entry.id === command.who));
        const dir = Math.max(0, MOVE_DIRECTIONS.findIndex((entry) => entry.id === command.dir));
        return [opIndex('move'), who, dir, byte(command.dist, 255)];
      }
      case 'join':
        return [opIndex('join'), byte(command.member, 3)];
      case 'call': {
        // A reference, not a container: the argument is the callee's slot in
        // the shared events table, resolved above rather than clamped here.
        // Read through commonEventId rather than trusted as already a
        // number — buildProject is handed live, possibly-unnormalized
        // project state, and command.event straight off an in-memory
        // command can be a string ("5") or shared/project.js's own
        // NO_COMMON_EVENT_ID sentinel; commonEventTableIndex's own keys came
        // from resolveCommonEventIds running every entry's id through the
        // same function, so a raw command.event has to go through it too or
        // the two sides drift.
        //
        // One that resolves to no live slot — deleted after being called,
        // never live to begin with, simply not a valid id, or a `call` never
        // given a target — is still emitted, carrying this module's own
        // NO_COMMON_EVENT_SLOT (the $FF table-slot sentinel, a different
        // name and a different value from NO_COMMON_EVENT_ID above on
        // purpose — see the comment beside its definition) as its operand,
        // rather than dropped the way an empty choice or an empty battle
        // formation is. A `call` is not scaffolding the way those are: the
        // page goes on to something the author wrote to run *after* it, so
        // removing the command silently keeps that -- the exact "Call
        // Reward, then Set switch Quest complete" failure this sentinel
        // exists to close. script_op_call (engine/script.asm) refuses it
        // and stops the event, the same answer script_run_bad gives an
        // opcode it does not recognise at all, and script_op_give/
        // script_op_take give NO_ACTOR — an operand naming nothing is that
        // family's shape of bug regardless of which opcode carries it.
        const slot = commonEventTableIndex.get(commonEventId(command.event));
        return [OP_CALL, slot === undefined ? NO_COMMON_EVENT_SLOT : slot];
      }
      case 'music':
        return [OP_MUSIC, songByte(project.songs, command.song)];
      case 'battle': {
        // Up to RPG_LIMITS.monstersPerBattle actor ids, NO_ACTOR-padded --
        // the same fixed-width, no-count shape generate.js's encounterRow
        // compiles a map's own (random) encounter table into, so
        // script_op_battle can copy these bytes straight into mon_slot_actor
        // without decoding a count first. An id past actorCount — an actor
        // deleted since, or never valid to begin with — becomes NO_ACTOR
        // rather than a byte setup_monsters would index its tables past the
        // end with, the same fallback songByte gives a stale song id.
        const monsters = battleFormationSlice(command.monsters).map((id) =>
          Number.isInteger(id) && id >= 0 && id < actorCount ? id : NO_ACTOR
        );
        while (monsters.length < RPG_LIMITS.monstersPerBattle) monsters.push(NO_ACTOR);
        return [OP_BATTLE, ...monsters];
      }
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
        const options = choiceOptionsSlice(command.options, CHOICE_LIMITS.options);
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

  // Pushed first, and in the same order `commonEventTableIndex` was assigned
  // in, so each one lands in exactly the slot a `call` naming it already
  // resolved to — whether that `call` sits on a placement or inside another
  // common event.
  for (const { entry, id } of liveCommonEventEntries) {
    const name = String(entry.name ?? '').trim() || `Common event ${id}`;
    events.push(encodeEvent(compiledPages(entry.event), `Common event “${name}”`));
  }

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
    // Shown instead of sys_press_start when a valid save exists (checked at
    // runtime, since that is per-cartridge state no build-time flag can know)
    // -- always compiled, the same "always emitted" rule every system string
    // here follows, even for a project with no Save command to ever show it.
    sys_press_start_continue: 'START:NEW  SELECT:CONTINUE',
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
