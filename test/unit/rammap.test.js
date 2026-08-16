// A guard against the exact class of bug that cost real debugging time this
// round: two RAM allocations landing on the same byte because their base
// addresses were each computed correctly in isolation, from an expression
// nothing forced to agree with anything else in the file.
//
// game.fns cannot be the ground truth for this: nesasm's own symbol file
// carries code and data labels but omits plain equates entirely, and
// shared/enginesyms.js's parseEquates deliberately skips anything shaped
// like an expression (`otherLabel+N`) rather than a literal `$hex`. Both are
// exactly the shape most of this engine's array bases are written in. So
// this reads engine/constants.asm itself -- generated into a real build,
// Code Forge override included, the same rule as everything else that reads
// engine addresses (see CLAUDE.md) -- and evaluates its own equate grammar
// by hand.
//
// That grammar is deliberately small: every RAM address in the file is
// `NAME = $hex`, `NAME = otherName`, or `NAME = otherName+token` (token a
// decimal literal or another already-defined name). A line that does not
// fit is not silently left out of the audit -- scanEquates fails on it
// immediately, naming the line, because an allocation this guard cannot
// parse is exactly as invisible to it as one it was never told existed:
// the same failure mode as an unannotated array, just one step earlier. A
// legitimately wider expression is a grammar this guard has not been taught
// yet, and widening scanEquates to accept it is a decision to make on
// purpose, not a `continue` to fall into by default.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createProject } from '../../shared/project.js';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// A RAM address is spelled in lower_snake_case throughout this file --
// ptr_lo, ent_active, cur_song -- and every plain value (an opcode, a game
// state, a pixel offset, a bitmask) is UPPER_SNAKE_CASE, right down to
// PPUCTRL_ON, which is a coincidence of hex formatting (`$88`) that once
// looked exactly like an address and was not one. OAM is this rule's one
// deliberate exception: the sprite shadow's own base, spelled uppercase by
// NES convention, but a real 256-byte RAM allocation like any other here.
const isRamName = (name) => /^[a-z]/.test(name) || name === 'OAM';

/**
 * Every indexed allocation's expected size, checked against what its @size
 * annotation actually resolves to -- pinned by hand against the engine code
 * that indexes each one, because nothing here parses 6502 well enough to
 * find a maximum index on its own. This guard can only tell two allocations
 * apart from overlapping; a too-small @size that merely leaves unused space
 * behind it overlaps nothing; bt_list (LIST_ROWS, 4, when
 * spell_chosen/item_chosen in engine/battleturn.asm index it with bt_sel up
 * to 7 -- see draw_list_row's own cursor comparison, bt_vrow+bt_scroll
 * against bt_sel, which is what proves bt_sel is the list's *absolute*
 * position and not a 0-3 row on screen) is exactly that shape of bug, found
 * only by checking every annotation by hand once.
 *
 * Each entry is a symbol to resolve through the same `symbols` map the
 * addresses themselves come from, a function of that map, or -- only where
 * nothing in either generated file names the true cap -- a literal. A
 * symbol reference, not a restated literal, is what keeps this table from
 * being the same mistake as the annotation twice over: if ent_active's own
 * @size were changed to name the wrong constant, this checks it against
 * MAX_ENTITIES resolved independently, not against another hardcoded 8 that
 * would have to go stale in step with a real change to MAX_ENTITIES to ever
 * catch anything.
 */
const KNOWN_MAX_SIZES = {
  // The common event call stack (engine/script.asm's call_ret_lo/hi,
  // indexed by call_depth up to CALL_STACK_DEPTH-1).
  call_ret_lo: 'CALL_STACK_DEPTH',
  call_ret_hi: 'CALL_STACK_DEPTH',
  // One entry per channel (engine/music.asm indexes every mus_* array with
  // the channel number in X, bounded by MUS_CHANNELS).
  mus_ptr_lo: 'MUS_CHANNELS',
  mus_ptr_hi: 'MUS_CHANNELS',
  mus_dur: 'MUS_CHANNELS',
  mus_inst: 'MUS_CHANNELS',
  mus_step: 'MUS_CHANNELS',
  mus_note: 'MUS_CHANNELS',
  mus_trig: 'MUS_CHANNELS',
  // One entry per entity slot (engine/entities.asm indexes every ent_*
  // array with the slot number in X, bounded by MAX_ENTITIES throughout
  // spawn_entities/update_entities). ent_trigger/touched/record are the
  // same family, just declared in the trigger-RAM section of
  // engine/constants.asm rather than beside the rest.
  ent_active: 'MAX_ENTITIES',
  ent_actor: 'MAX_ENTITIES',
  ent_x: 'MAX_ENTITIES',
  ent_y: 'MAX_ENTITIES',
  ent_dir: 'MAX_ENTITIES',
  ent_frame: 'MAX_ENTITIES',
  ent_timer: 'MAX_ENTITIES',
  ent_hp: 'MAX_ENTITIES',
  ent_to_scr: 'MAX_ENTITIES',
  ent_to_x: 'MAX_ENTITIES',
  ent_to_y: 'MAX_ENTITIES',
  ent_event: 'MAX_ENTITIES',
  ent_hurt: 'MAX_ENTITIES',
  ent_trigger: 'MAX_ENTITIES',
  ent_touched: 'MAX_ENTITIES',
  ent_record: 'MAX_ENTITIES',
  // One entry per party member (engine/battleturn.asm and battleui.asm
  // index every pc_* array with a combatant index bounded by MAX_PARTY on
  // the party side of the 0-3/4-7 split).
  pc_hp: 'MAX_PARTY',
  pc_hp_max: 'MAX_PARTY',
  pc_mp: 'MAX_PARTY',
  pc_mp_max: 'MAX_PARTY',
  pc_level: 'MAX_PARTY',
  pc_xp_lo: 'MAX_PARTY',
  pc_xp_hi: 'MAX_PARTY',
  pc_in_party: 'MAX_PARTY',
  pc_spells: 'MAX_PARTY',
  pc_status: 'MAX_PARTY',
  // One entry per monster slot (the same routines, MAX_MONSTERS on the
  // monster side of the split).
  mon_slot_actor: 'MAX_MONSTERS',
  mon_slot_hp: 'MAX_MONSTERS',
  mon_slot_max: 'MAX_MONSTERS',
  mon_slot_alive: 'MAX_MONSTERS',
  mon_slot_mp: 'MAX_MONSTERS',
  mon_slot_status: 'MAX_MONSTERS',
  // Both sides at once, party then monsters (engine/battleturn.asm's
  // turn_order/combatant_* routines index 0-7).
  turn_order: 'NUM_COMBATANTS',
  // Three decimal digits, most significant first (push_battle_string,
  // engine/battleui.asm) -- no named constant anywhere calls a number
  // "three digits", so this is a literal rather than a derived reference.
  bt_digits: 3,
  // NUM_SWITCHES one-bit flags, eight to a byte (switch_split,
  // engine/script.asm, shifts by switch_idx = n >> 3). Not itself a named
  // constant, so derived by the same division switch_split performs rather
  // than restated as a bare 8.
  switches: (symbols) => symbols.get('NUM_SWITCHES') / 8,
  // Generated into config.inc from RPG_LIMITS.variables (main/build/
  // generate.js); engine/constants.asm deliberately does not restate it.
  variables: 'NUM_VARIABLES',
  // One actor id per item carried (engine/battleui.asm's build_item_list
  // and engine/ui.asm's add_item both bound the bag at MAX_ITEMS).
  inv_items: 'MAX_ITEMS',
  // The NMI VRAM queue is one full page (engine/constants.asm: "One page,
  // so the NMI's drain loop can index the whole queue with X"), and OAM is
  // the sprite shadow DMA'd every frame -- both are a literal 256 because
  // nothing names "one page" as a constant of its own.
  vram_buf: 256,
  OAM: 256,
  // The open spell or item list, up to eight entries -- see the comment
  // above the table for why this is the one that was wrong.
  bt_list: 8
};

/** Resolve one KNOWN_MAX_SIZES entry to a number, against the same `symbols` the RAM addresses themselves resolved through. */
function resolveKnownSize(spec, symbols) {
  if (typeof spec === 'number') return spec;
  if (typeof spec === 'function') return spec(symbols);
  return symbols.get(spec);
}

/**
 * Record every `NAME = expr` line's shape into `pending`, keyed by name, so
 * the two files can be scanned independently before anything is resolved --
 * a line whose grammar this guard cannot parse is a defect in the guard
 * itself (or a deliberate widening it has not been taught yet) and has to
 * fail here, not vanish from the audit the way a silently-skipped line
 * would. First definition wins, matching nesasm's own `=`.
 */
function scanEquates(text, pending) {
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+)/);
    if (!m) continue;
    const [, name, rawExpr] = m;
    if (pending.has(name)) continue;
    const expr = rawExpr.trim();
    const hex = expr.match(/^\$([0-9A-Fa-f]+)$/);
    const dec = expr.match(/^(\d+)$/);
    const sum = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*([A-Za-z_][A-Za-z0-9_]*|\d+)$/);
    const bare = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
    if (hex) pending.set(name, { kind: 'literal', value: parseInt(hex[1], 16) });
    else if (dec) pending.set(name, { kind: 'literal', value: parseInt(dec[1], 10) });
    else if (sum) pending.set(name, { kind: 'sum', base: sum[1], add: sum[2] });
    else if (bare) pending.set(name, { kind: 'bare', ref: bare[1] });
    else {
      // A future equate genuinely can need a wider grammar than this -- the
      // fix then is to widen scanEquates on purpose, with eyes on what it
      // now accepts, not to let a line it cannot read disappear from the
      // audit the way `continue` here would.
      throw new Error(
        `${name} = ${expr} does not fit the restricted equate grammar this guard parses (literal $hex/decimal, ` +
          `a bare name, or name+token). Widen scanEquates deliberately, or fix the line.`
      );
    }
  }
}

/**
 * Resolve every entry `scanEquates` recorded into `symbols`, in as many
 * passes as it takes for one name to unblock the next -- a name is free to
 * be defined in either file and referenced from the other (NUM_VARIABLES
 * lives in the generated config.inc; the array it sizes lives in
 * constants.asm). What is left once a pass adds nothing is not waiting on
 * anything else; it is a dangling reference, and resolveEquates fails
 * naming it rather than leaving it out of `symbols` for later code to miss.
 */
function resolveEquates(pending, symbols) {
  let progress = true;
  while (progress) {
    progress = false;
    for (const [name, spec] of pending) {
      let value;
      if (spec.kind === 'literal') {
        value = spec.value;
      } else if (spec.kind === 'sum') {
        const base = symbols.get(spec.base);
        const add = /^\d+$/.test(spec.add) ? parseInt(spec.add, 10) : symbols.get(spec.add);
        if (base === undefined || add === undefined) continue;
        value = base + add;
      } else {
        const v = symbols.get(spec.ref);
        if (v === undefined) continue;
        value = v;
      }
      symbols.set(name, value);
      pending.delete(name);
      progress = true;
    }
  }
  if (pending.size) {
    throw new Error(`could not resolve: ${[...pending.keys()].join(', ')} -- each names something never defined`);
  }
}

/** `NAME = ... @size=TOKEN` -- TOKEN a decimal literal or another equate's name. */
function parseSizeAnnotations(text) {
  const sizes = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=.*@size=([A-Za-z0-9_]+)/);
    if (m) sizes.set(m[1], m[2]);
  }
  return sizes;
}

/**
 * Build a project, apply an optional Code Forge override of constants.asm,
 * and hand back the two generated files this guard reads addresses from.
 * The single call site for both the plain audit and the override-path proof
 * below, so the two cannot drift into reading the build differently.
 */
async function buildAndRead(t, overrideConstantsText) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-rammap-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // gameType is irrelevant to constants.asm itself -- it carries no `.if`
  // of its own, every address it defines exists in every build -- but an
  // RPG is what makes config.inc's NUM_VARIABLES (variables' own @size)
  // mean something rather than defaulting to a project with none.
  const project = createProject('RAM Map', 'rpg');
  if (overrideConstantsText !== undefined) {
    project.code.overrides = [{ name: 'constants.asm', text: overrideConstantsText }];
  }
  await saveProject(dir, project);
  await buildProject({ dir, project, log: () => {} });

  const constantsText = await fs.readFile(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const configText = await fs.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
  return { constantsText, configText };
}

/**
 * The full audit, pulled out of the test body so the override-path proof
 * below can run it a second time against a deliberately broken override
 * without duplicating it. Throws (via `assert`) on the first problem found,
 * same as before this was extracted.
 */
function auditRamMap(constantsText, configText) {
  const pending = new Map();
    scanEquates(constantsText, pending);
    scanEquates(configText, pending);
    const symbols = new Map();
    // Both files' equates resolved together: a @size annotation in
    // constants.asm can name something only config.inc defines
    // (NUM_VARIABLES), and resolveEquates' multi-pass loop does not care
    // which file a name it is waiting on turns up in.
    resolveEquates(pending, symbols);

    const sizeAnnotations = parseSizeAnnotations(constantsText);

    const intervals = [];
    for (const [name, addr] of symbols) {
      if (!isRamName(name)) continue;
      assert.ok(
        Number.isInteger(addr) && addr >= 0,
        `${name} did not resolve to a non-negative integer address`
      );
      let size = 1;
      const sizeToken = sizeAnnotations.get(name);
      if (sizeToken !== undefined) {
        size = /^\d+$/.test(sizeToken) ? parseInt(sizeToken, 10) : symbols.get(sizeToken);
        assert.ok(
          Number.isInteger(size) && size > 0,
          `${name}'s @size=${sizeToken} did not resolve to a positive integer -- ` +
            `either annotate ${sizeToken} too, or fix the reference`
        );
      }
      intervals.push({ name, start: addr, end: addr + size - 1, size });
    }
    assert.ok(intervals.length > 50, `only found ${intervals.length} RAM addresses -- the parser likely missed the file`);

    for (const [name, spec] of Object.entries(KNOWN_MAX_SIZES)) {
      const expected = resolveKnownSize(spec, symbols);
      assert.ok(
        Number.isInteger(expected) && expected > 0,
        `KNOWN_MAX_SIZES.${name} (${spec}) did not resolve to a positive integer`
      );
      const found = intervals.find((entry) => entry.name === name);
      assert.ok(found, `${name} was not found among the RAM addresses at all`);
      assert.equal(
        found.size,
        expected,
        `${name}'s @size annotation says ${found.size}, but the engine indexes it up to ${expected - 1} ` +
          '(see KNOWN_MAX_SIZES above)'
      );
    }

    // Every array expanded to the bytes it actually occupies, not just its
    // starting address: two allocations can start at different addresses
    // and still collide once one of them is wider than the gap to the next
    // one -- the ent_spawn_rec/cur_map collision this guard exists to catch
    // shared a *starting* address, but an audit that stopped there would
    // have missed the equally real case of two starts that merely overlap.
    intervals.sort((a, b) => a.start - b.start);
    for (let i = 1; i < intervals.length; i++) {
      const prev = intervals[i - 1];
      const cur = intervals[i];
      assert.ok(
        prev.end < cur.start,
        `${prev.name} ($${prev.start.toString(16)}, ${prev.size} byte${prev.size === 1 ? '' : 's'}, through ` +
          `$${prev.end.toString(16)}) overlaps ${cur.name} ($${cur.start.toString(16)}, ${cur.size} ` +
          `byte${cur.size === 1 ? '' : 's'})`
      );
    }

    // Zero page is $00-$FF; an allocation that starts inside it and runs
    // past $FF wraps to $00 on real hardware silently, which reads as a
    // second, impossible collision report if this does not catch it first
    // and by name.
    for (const { name, start, end } of intervals) {
      if (start > 0xff) continue;
      assert.ok(end <= 0xff, `${name} starts in zero page at $${start.toString(16)} but its own size runs past $FF`);
    }

    // And the NES has 2 KB of internal work RAM, mirrored every $0800 --
    // nothing this engine allocates should reach past the first mirror,
    // or it is not describing the byte it looks like it is.
    for (const { name, end } of intervals) {
      assert.ok(end < 0x0800, `${name} runs to $${end.toString(16)}, past the NES's 2 KB of internal RAM`);
    }
}

test(
  'the RAM map has no duplicate addresses and no array overruns the next label',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { constantsText, configText } = await buildAndRead(t);
    auditRamMap(constantsText, configText);
  }
);

test(
  'the guard reads constants.asm through a Code Forge override, not just the stock file',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    // Reintroduces the exact historical bug the comment above KNOWN_MAX_SIZES
    // and the one beside cur_map both describe: cur_map used to be chained
    // directly off call_ret_hi+CALL_STACK_DEPTH, until ent_spawn_rec took
    // that byte and cur_map was never moved off it. Stock constants.asm does
    // not have this bug -- it is written into an override here, purely to
    // prove this guard is reading `build/constants.asm` *after* the Code
    // Forge's copy has been written over the stock one (main/build/
    // generate.js), rather than a stock file that never had the collision to
    // find. If overrides stopped being applied, or this test started reading
    // the wrong path, this would pass when it must not.
    const stockConstantsText = await fs.readFile(path.join(ROOT, 'engine', 'constants.asm'), 'utf8');
    const collidingText = stockConstantsText.replace(
      /^cur_map\s*= bt_owner_rec\+1.*$/m,
      'cur_map     = ent_spawn_rec                ; TEST OVERRIDE: reintroduces the pre-fix collision on purpose'
    );
    assert.notEqual(collidingText, stockConstantsText, 'the cur_map line to replace was not found -- did constants.asm change shape?');

    const { constantsText, configText } = await buildAndRead(t, collidingText);
    assert.match(constantsText, /TEST OVERRIDE/, 'build/constants.asm does not contain the override -- the Code Forge override was not applied');
    assert.throws(
      () => auditRamMap(constantsText, configText),
      /ent_spawn_rec .* overlaps cur_map|cur_map .* overlaps ent_spawn_rec/,
      'the guard should have caught cur_map colliding with ent_spawn_rec through the override text'
    );
  }
);
