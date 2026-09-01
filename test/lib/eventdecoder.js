// A test-only decoder for the compiled event/page/command wire format.
//
// Walks the actual bytes encodeCommand/encodeEvent (main/build/textcompile.js)
// produce, opcode by opcode, against every real case in encodeCommand's own
// switch -- replacing only the two operand kinds a reorder/duplicate/delete/
// resize can ever relocate (a Warp's screen operand, a Say/choice-label
// string id) with resolved, build-independent content. Everything else --
// opcodes, length bytes, every other operand -- is compared as raw bytes,
// because nothing about a screen/map structural edit ever touches them.
//
// Lives beside the tests that use it: never exported from main/build/, and
// never imported by it (handoff-maporg/design-maporg.md §7 item 2). Built
// against encodeCommand's actual cases, not the authored EVENT_COMMANDS.args
// table -- sting/sfx/battle each diverge from the generic
// `1 + entry.args.length` rule, which is why EXCEPTIONAL_WIDTHS below exists
// rather than trusting args.length uniformly.
//
// decodeEvent(bytes, { strings, flat }) -> pages: [{ cond, body }]
// `flat` is a flattened project (flatScreens' own return shape, or
// generate.js's flattenScreens().flat) -- decodeCommand resolves a Warp's raw
// screen byte to `flat[...].screen`, a real screen object, so two builds can
// be compared by object identity rather than by a raw index a reorder is
// required to change.

import { EVENT_COMMANDS, RPG_LIMITS, canonicalizeFlat } from '../../shared/project.js';
import { OP_END, OP_JUMP, EVT_PAGES_END } from '../../main/build/textcompile.js';

// Every opcode whose compiled width diverges from the generic
// `1 + entry.args.length` rule, verified against encodeCommand's own cases
// (main/build/textcompile.js) rather than assumed from the authored schema.
// branch/choice are handled by their own framing logic in decodeCommand,
// never by this table.
const EXCEPTIONAL_WIDTHS = {
  sting: 3, // [op, index, duration] -- duration is compiler-computed, not authored
  sfx: 3, // [op, index, duration] -- same shape
  battle: 1 + RPG_LIMITS.monstersPerBattle // fixed-width, NO_ACTOR-padded actor ids
};

/**
 * Decodes one command starting at `bytes[at]`. `ctx` is `{ strings, flat }`.
 * Returns `{ form, ..., size }` where `size` is exactly how many bytes this
 * command occupied, so a caller can advance a cursor by it.
 */
export function decodeCommand(bytes, at, ctx) {
  const opcode = bytes[at];
  const entry = EVENT_COMMANDS[opcode];
  // Hard failure on anything that is not a real, live, decodable opcode at
  // this position: past the real prefix, the virtual tail (route -- never a
  // compiled opcode byte at all, see the module comment above), or either
  // framing sentinel (OP_END/OP_JUMP), neither of which is ever a real
  // command's own opcode -- both are consumed explicitly by decodeEvent and
  // the branch/choice cases below and must never reach this generic dispatch.
  if (!entry || entry.virtual || opcode === OP_END || opcode === OP_JUMP) {
    throw new Error(`decodeCommand: opcode ${opcode} at byte ${at} is not a real, decodable command`);
  }

  if (entry.id === 'branch') {
    // [OP_IF, cond, arg, value, thenLen, ...then, OP_JUMP, elseLen, ...else]
    const [cond, arg, value, thenLen] = bytes.slice(at + 1, at + 5);
    const then = decodeBody(bytes, at + 5, thenLen, ctx);
    const jumpByte = bytes[at + 5 + thenLen];
    if (jumpByte !== OP_JUMP) throw new Error(`branch at ${at}: expected OP_JUMP, got ${jumpByte}`);
    const elseLen = bytes[at + 5 + thenLen + 1];
    const els = decodeBody(bytes, at + 5 + thenLen + 2, elseLen, ctx);
    return { form: 'branch', cond: [cond, arg, value], then, else: els, size: 5 + thenLen + 2 + elseLen };
  }

  if (entry.id === 'choice') {
    // [OP_CHOICE, count, ...ids, per-option [recordLength, ...body(recordLength-2), OP_JUMP, past]]
    // recordLength = body.length + 2 (textcompile.js), so the body is
    // recordLength - 2 bytes and the whole record is 1 + recordLength bytes.
    const count = bytes[at + 1];
    const labels = bytes.slice(at + 2, at + 2 + count).map((id) => ctx.strings[id]); // CONTENT, not id
    let cursor = at + 2 + count;
    const records = [];
    for (let i = 0; i < count; i++) {
      const recordLength = bytes[cursor];
      const bodyLength = recordLength - 2;
      const body = decodeBody(bytes, cursor + 1, bodyLength, ctx);
      const jumpByte = bytes[cursor + 1 + bodyLength];
      if (jumpByte !== OP_JUMP) {
        throw new Error(`choice option ${i} at ${cursor}: expected OP_JUMP, got ${jumpByte}`);
      }
      const pastByte = bytes[cursor + 1 + bodyLength + 1];
      records.push({ body, recordLength, past: pastByte });
      cursor += 1 + recordLength; // exactly textcompile.js's own per-record size
    }
    // Validate, not merely consume, the trailing "past" byte -- the total
    // size of every record after this one, exactly how far script_skip
    // (engine/script.asm) must jump once this option is chosen. A decoder
    // that only advanced the cursor past this byte would pass a corpus where
    // every record happened to carry past=0.
    for (let i = 0; i < records.length; i++) {
      const expectedPast = records.slice(i + 1).reduce((sum, r) => sum + 1 + r.recordLength, 0);
      if (records[i].past !== expectedPast) {
        throw new Error(`choice option ${i}: past=${records[i].past}, expected ${expectedPast}`);
      }
    }
    return {
      form: 'choice',
      labels,
      options: records.map((r) => r.body),
      past: records.map((r) => r.past), // structure-only, reorder-invariant, harmless to compare
      size: cursor - at
    };
  }

  if (entry.id === 'warp') {
    const [screenByte, x, y] = bytes.slice(at + 1, at + 4);
    // Canonicalize identically to the compiler's own clamp (canonicalizeFlat,
    // mirroring generate.js:2586/textcompile.js's byte(command.screen,
    // screenCount-1)) against THIS build's own flat array, then resolve to
    // the screen OBJECT -- reference equality is sufficient since both
    // builds exist in the same test process, no serialization boundary to
    // cross.
    return {
      form: 'warp',
      target: ctx.flat[canonicalizeFlat(screenByte, ctx.flat.length)]?.screen,
      x,
      y,
      size: 4
    };
  }

  if (entry.id === 'say') {
    return { form: 'say', text: ctx.strings[bytes[at + 1]], size: 2 };
  }

  // Every remaining real op: EXCEPTIONAL_WIDTHS when listed there, else the
  // generic 1 + entry.args.length. None of these ever carry a screen or
  // string reference, so raw bytes are already the correct comparison.
  const width = EXCEPTIONAL_WIDTHS[entry.id] ?? 1 + entry.args.length;
  return { form: entry.id, raw: bytes.slice(at + 1, at + width), size: width };
}

/** Decodes a run of commands occupying exactly `length` bytes starting at `at`. */
export function decodeBody(bytes, at, length, ctx) {
  const commands = [];
  let cursor = at;
  while (cursor < at + length) {
    const decoded = decodeCommand(bytes, cursor, ctx);
    commands.push(decoded);
    cursor += decoded.size;
  }
  // Exact consumption, not "close enough": a width bug that under- or
  // over-counts leaves cursor short of or past at+length, which a bare loop
  // condition would silently absorb into the NEXT command's own opcode byte
  // instead of failing loudly.
  if (cursor !== at + length) {
    throw new Error(`decodeBody: consumed ${cursor - at}, expected exactly ${length}`);
  }
  return commands;
}

/** Decodes one compiled event: [cond,arg,value,bodyLen,...body]*, EVT_PAGES_END. */
export function decodeEvent(bytes, ctx) {
  const pages = [];
  let cursor = 0;
  while (bytes[cursor] !== EVT_PAGES_END) {
    const [cond, arg, value, bodyLen] = bytes.slice(cursor, cursor + 4);
    // The page body's own final byte is a real OP_END ($00) -- included in
    // bodyLen, but OP_END is never itself a decodable command (decodeCommand's
    // own guard refuses opcode 0). Decode the body EXCLUDING that final byte,
    // then verify it explicitly.
    const body = decodeBody(bytes, cursor + 4, bodyLen - 1, ctx);
    const endByte = bytes[cursor + 4 + bodyLen - 1];
    if (endByte !== OP_END) throw new Error(`page at ${cursor}: expected OP_END, got ${endByte}`);
    pages.push({ cond: [cond, arg, value], body });
    cursor += 4 + bodyLen;
  }
  // The terminator itself must be the exact last byte; nothing may follow it
  // unconsumed.
  if (cursor !== bytes.length - 1) {
    throw new Error(`decodeEvent: EVT_PAGES_END at ${cursor}, expected last byte of ${bytes.length}`);
  }
  return pages;
}
