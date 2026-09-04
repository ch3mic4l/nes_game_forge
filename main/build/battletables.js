// The tables the battle system reads, and only the battle system.
//
// All of it is emitted into the switchable code region beside engine/battle.asm
// rather than the fixed kernel, which is what makes a battle system affordable
// at all: monster stats, spells, party bases, level curves and the strings the
// battle box says add up to more than the kernel has spare.
//
// The shape is FALLEN STAR's: parallel arrays keyed by actor id, one table per
// stat, so the engine indexes with a single `lda mon_hp,y`. Presentation sits
// next to the numbers — art, palette and name are tables like any other.
//
// This file must stay free of Node and DOM APIs, the same rule `shared/`
// carries -- a constraint it did not have until the region's capacity check
// (below) landed. It is imported by main/build/generate.js, by node:test, and
// now by renderer/forges/build/build.js for the Build panel's own meter, the
// same way renderer/forges/sound/sound.js already imports compileSong from
// main/build/songcompile.js. It imports only from `shared/`; keep it that way,
// or the meter loses the one expression it shares with the check that refuses
// the build.
//
// mon_heal and mon_name coexist with item_heal and item_name (phase 4)
// rather than the item-keyed tables replacing the actor-keyed ones. They
// look redundant in isolation, but they are not: mon_name still has a second
// reader with nothing to do with items (push_combatant_name, naming which
// monster is acting or being hit in battle text), and item_chosen /
// draw_list_item_name both branch on ITEMS_ENABLED at the engine level -- a
// project with no items[] at all still has a bag that holds legacy actor
// ids, and reading an item-keyed table with an actor id in hand would be
// wrong, not merely mismatched. Deleting either table would break the
// disabled path's byte-for-byte promise to master. Banked-region headroom
// (~3870 free bytes, measured) is why carrying both costs nothing worth
// economizing.

import {
  ELEMENTS,
  RPG_LIMITS,
  SPELL_KINDS,
  SPELL_SCOPES,
  NO_ITEM,
  itemMissing,
  isMonsterActor,
  projectUsesItems
} from '../../shared/project.js';
import { NESASM_BANK_BYTES } from '../../shared/cartridge.js';
import { textToTiles } from '../../shared/font.js';

/** Longest name the battle box has room for, in its 12-column message area. */
export const NAME_LIMIT = RPG_LIMITS.nameLength;

const elementIndex = (id) => Math.max(0, ELEMENTS.findIndex((entry) => entry.id === id));
const kindIndex = (id) => Math.max(0, SPELL_KINDS.findIndex((entry) => entry.id === id));
const scopeIndex = (id) => Math.max(0, SPELL_SCOPES.findIndex((entry) => entry.id === id));

const hex = (value) => `$${(value & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;

function dbRows(values, perLine = 16) {
  if (!values.length) return '  .db $00';
  const lines = [];
  for (let i = 0; i < values.length; i += perLine) {
    lines.push(`  .db ${values.slice(i, i + perLine).map(hex).join(',')}`);
  }
  return lines.join('\n');
}

/**
 * How much experience it takes to reach each level, as a running total.
 *
 * Computed here rather than in the engine because the engine would need a
 * multiply to do it, and a fifteen-entry table is cheaper than the code. Levels
 * are one-based; entry 0 is the threshold for reaching level 2.
 */
export function xpCurve({ xpBase, xpGrow, maxLevel }) {
  const totals = [];
  let running = 0;
  for (let level = 1; level < maxLevel; level++) {
    running += xpBase + (level - 1) * xpGrow;
    totals.push(Math.min(0xffff, running));
  }
  return totals;
}

/** A party member's stats at a given level: base plus growth, capped at a byte. */
export function statAt(base, perLevel, level) {
  return Math.max(0, Math.min(255, base + perLevel * (level - 1)));
}

/** A name as glyph tiles, padded to NAME_LIMIT so the engine needs no length. */
export function nameTiles(name) {
  const text = String(name ?? '').slice(0, NAME_LIMIT).padEnd(NAME_LIMIT, ' ');
  return textToTiles(text).tiles;
}

/**
 * Every table the battle bank needs. Returns assembly source; the caller decides
 * which `.bank` it lands in.
 */
export function battleTables(project, battleStrings = BATTLE_STRINGS) {
  checkBattleStringsCapacity(battleStrings);
  const actors = project.sprites.actors;
  const party = project.party ?? [];
  const spells = project.spells ?? [];
  const rpg = project.rpg;
  const chunks = ['; Generated -- the battle system\'s own tables, in its own bank.'];

  // --- monsters: one entry per actor, hostile or not ------------------------
  // Keyed by actor id rather than packed, so a placed actor's id indexes
  // straight in and nothing has to keep a second numbering in step.
  const column = (pick) => actors.map(pick);
  const battle = (pick) => column((actor) => pick(actor.battle ?? {}, actor));

  chunks.push(`mon_hp:\n${dbRows(column((actor) => actor.hp ?? 1))}`);
  chunks.push(`mon_mp:\n${dbRows(battle((b) => b.mp ?? 0))}`);
  chunks.push(`mon_atk:\n${dbRows(battle((b) => b.atk ?? 4))}`);
  chunks.push(`mon_def:\n${dbRows(battle((b) => b.def ?? 2))}`);
  chunks.push(`mon_acc:\n${dbRows(battle((b) => b.acc ?? 180))}`);
  chunks.push(`mon_eva:\n${dbRows(battle((b) => b.eva ?? 4))}`);
  chunks.push(`mon_speed:\n${dbRows(battle((b) => b.speed ?? 4))}`);
  chunks.push(`mon_xp_lo:\n${dbRows(battle((b) => (b.xp ?? 0) & 0xff))}`);
  chunks.push(`mon_xp_hi:\n${dbRows(battle((b) => ((b.xp ?? 0) >> 8) & 0xff))}`);
  chunks.push(`mon_gold:\n${dbRows(battle((b) => b.gold ?? 0))}`);
  chunks.push(`mon_weak:\n${dbRows(battle((b) => elementIndex(b.weak)))}`);
  chunks.push(`mon_strong:\n${dbRows(battle((b) => elementIndex(b.strong)))}`);
  // NO_ITEM ($FF) is "leaves nothing behind" -- for a drop that names no
  // item at all (null) and for one itemMissing says does not exist alike,
  // exactly as mon_spell below already treats a stale spell id the same as
  // no spell. `b.drop` is an item id now, and reaches the ROM as one
  // directly -- the same resolution main/build/textcompile.js's Give/Take
  // and Carrying-condition compilation use (itemMissing), so none of the
  // three can resolve a drop differently than the others do. Under
  // ITEMS_ENABLED, roll_drop (engine/battleturn.asm) hands this byte
  // straight to add_item, which now itself refuses NO_ITEM centrally (see
  // engine/ui.asm) -- so this only has to avoid handing add_item a byte that
  // is neither NO_ITEM nor a real item id, which itemMissing already
  // guarantees regardless of whether the project has passed validateProject
  // (buildProject compiles the project the app is holding, not one that has
  // passed validation).
  chunks.push(
    `mon_drop:\n${dbRows(battle((b) => (itemMissing(project.items, b.drop) ? NO_ITEM : b.drop)))}`
  );
  chunks.push(`mon_drop_pct:\n${dbRows(battle((b) => b.dropPct ?? 0))}`);
  // The ITEMS_ENABLED-false path's own table: item_chosen (engine/
  // battleturn.asm) still reads this, keyed by actor id, when a project has
  // no items[] at all and the bag still holds legacy actor ids. Stays
  // alongside item_heal below rather than being replaced by it -- see this
  // file's own header note on why both tables exist.
  chunks.push(`mon_heal:\n${dbRows(battle((b) => b.heal ?? 0))}`);
  // Background art on the battle tileset. $FF means "no block art"; the engine
  // falls back to the actor's own metasprite, so every actor can fight.
  chunks.push(
    `mon_tile:\n${dbRows(battle((b) => (b.battleTile === null || b.battleTile === undefined ? 0xff : b.battleTile)))}`
  );
  chunks.push(`mon_w:\n${dbRows(battle((b) => b.battleW ?? 4))}`);
  chunks.push(`mon_h:\n${dbRows(battle((b) => b.battleH ?? 4))}`);
  // The spell this monster casts when it can afford to. $FF = it only swings;
  // a stale id past the spell table is treated the same rather than compiled.
  chunks.push(
    `mon_spell:\n${dbRows(
      battle((b) => (b.spellId === null || b.spellId === undefined || b.spellId >= spells.length ? 0xff : b.spellId))
    )}`
  );
  // One attribute byte tints the monster's whole block, which is why the art is
  // anchored to a 4x4 grid: a block that size lies inside one attribute cell.
  chunks.push(`mon_attr:\n${dbRows(battle((b) => (b.battlePalette ?? 2) * 0x55))}`);
  chunks.push(`mon_name:\n${dbRows(actors.flatMap((actor) => nameTiles(actor.name)), NAME_LIMIT)}`);

  // --- items (ITEMS_ENABLED path only) ---------------------------------------
  // item_chosen and draw_list_item_name (engine/battleturn.asm,
  // engine/battleui.asm) read these when a project's bag holds item ids;
  // mon_heal/mon_name above stay exactly as they are for the disabled path,
  // where the bag still holds legacy actor ids -- see this file's own header
  // note on why an ITEMS_ENABLED-false project needs both tables to keep
  // working unmodified.
  //
  // Emitted only when projectUsesItems(project) is true -- round 4 finding:
  // dbRows([]) still emits a one-byte ".db $00" stub for an empty array, so
  // pushing these unconditionally cost every items-disabled RPG 2 real
  // banked bytes (and shifted every label after them) for two tables
  // nothing in that build ever reads, silently breaking the
  // items-disabled-and-no-Save byte-identity promise for any RPG -- a defect
  // the action-only pinned baseline (items.test.js) could never have caught,
  // since it never exercises the battle region at all.
  if (projectUsesItems(project)) {
    const items = project.items ?? [];
    // Only the battle item list ever draws an item's name; built from the
    // item's own name field directly, not resolved through a backing actor --
    // unlike mon_name, this has no legacy economy to reproduce, since nothing
    // drew an item-specific name before this table existed.
    chunks.push(`item_name:\n${dbRows(items.flatMap((item) => nameTiles(item.name)), NAME_LIMIT)}`);
    // item_chosen's enabled-path heal amount. Phase 4c: items[] now carries
    // its own `effect` field (shared/project.js's normalizeItem), so this
    // reads that directly rather than the backing actor's battle.heal --
    // phase 4b's economy, kept alive only as `effect`'s own one-time
    // migration source (deriveItemEffect), not read again here. A `damage`
    // or `none` kind contributes 0: `use_item_apply` (round 2) is what will
    // actually spend a damage-kind item, and this table is item_chosen's
    // heal-only reader, so anything that is not a positive heal has nothing
    // for it to apply. The table's existence, size and every reader of it
    // (item_chosen, engine/battleturn.asm) are unchanged from 4b -- only the
    // source of each row moved.
    chunks.push(
      `item_heal:\n${dbRows(items.map((item) => (item.effect?.kind === 'heal' ? item.effect.amount : 0)))}`
    );
  }

  // --- spells ---------------------------------------------------------------
  chunks.push(`NUM_SPELLS = ${spells.length}`);
  chunks.push(`spell_cost:\n${dbRows(spells.map((spell) => spell.mpCost))}`);
  chunks.push(`spell_kind:\n${dbRows(spells.map((spell) => kindIndex(spell.kind)))}`);
  // Replaces the old flat `spell_amount` row: `roll_spell_amount`/`mod8`
  // (engine/battleturn.asm) reject-then-modulo a 0-254 RNG draw down to a
  // uniform value in [0, n-1] and add it to `amountMin` -- see the design's
  // own derivation for why a masked-AND draw is biased and this exact
  // reject-to-the-largest-multiple-of-n construction is not.
  // `spell_amount_n === 1` (amountMin === amountMax) is the flat case: the
  // engine's own `cmp #1 / beq` skips the roll entirely and consumes no RNG.
  chunks.push(`spell_amount_min:\n${dbRows(spells.map((spell) => spell.amountMin))}`);
  chunks.push(
    `spell_amount_n:\n${dbRows(spells.map((spell) => spell.amountMax - spell.amountMin + 1))}`
  );
  chunks.push(
    `spell_amount_limit:\n${dbRows(
      spells.map((spell) => {
        const n = spell.amountMax - spell.amountMin + 1;
        return Math.floor(255 / n) * n;
      })
    )}`
  );
  chunks.push(`spell_element:\n${dbRows(spells.map((spell) => elementIndex(spell.element)))}`);
  chunks.push(`spell_scope:\n${dbRows(spells.map((spell) => scopeIndex(spell.scope)))}`);
  chunks.push(`spell_name:\n${dbRows(spells.flatMap((spell) => nameTiles(spell.name)), NAME_LIMIT)}`);

  // --- the party ------------------------------------------------------------
  // Stats are pre-computed per level rather than derived at runtime: the engine
  // has no multiply, and maxLevel entries per member is a handful of bytes.
  chunks.push(`PARTY_SIZE = ${party.length}`);
  chunks.push(`MAX_LEVEL  = ${rpg.maxLevel}`);
  chunks.push(`pc_starts:\n${dbRows(party.map((member) => (member.startsInParty ? 1 : 0)))}`);
  chunks.push(`pc_metasprite:\n${dbRows(party.map((member) => member.metaspriteId ?? 0xff))}`);
  chunks.push(`pc_speed:\n${dbRows(party.map((member) => member.speed))}`);
  chunks.push(`pc_acc:\n${dbRows(party.map((member) => member.acc))}`);
  chunks.push(`pc_eva:\n${dbRows(party.map((member) => member.eva))}`);
  chunks.push(`pc_name:\n${dbRows(party.flatMap((member) => nameTiles(member.name)), NAME_LIMIT)}`);

  // One row of maxLevel entries per member, so `member * MAX_LEVEL + level - 1`
  // reaches the number.
  const levelTable = (pick) =>
    party.flatMap((member) =>
      Array.from({ length: rpg.maxLevel }, (_, index) => pick(member, index + 1))
    );
  chunks.push(`pc_hp_at:\n${dbRows(levelTable((m, l) => statAt(m.baseHp, m.hpPerLevel, l)), rpg.maxLevel)}`);
  chunks.push(`pc_mp_at:\n${dbRows(levelTable((m, l) => statAt(m.baseMp, m.mpPerLevel, l)), rpg.maxLevel)}`);
  chunks.push(`pc_atk_at:\n${dbRows(levelTable((m, l) => statAt(m.baseAtk, m.atkPerLevel, l)), rpg.maxLevel)}`);
  chunks.push(`pc_def_at:\n${dbRows(levelTable((m, l) => statAt(m.baseDef, m.defPerLevel, l)), rpg.maxLevel)}`);

  // Which spells a member knows at a level: one bitmask byte per member per
  // level, so up to eight spells each. Spells are learned and never forgotten.
  const known = party.flatMap((member) => {
    const learned = new Array(rpg.maxLevel).fill(0);
    for (const entry of member.spells ?? []) {
      const slot = spells.findIndex((spell) => spell.id === entry.spellId);
      if (slot < 0 || slot > 7) continue;
      for (let level = Math.max(1, entry.level); level <= rpg.maxLevel; level++) {
        learned[level - 1] |= 1 << slot;
      }
    }
    return learned;
  });
  chunks.push(`pc_spells_at:\n${dbRows(known, rpg.maxLevel)}`);

  // --- progression ----------------------------------------------------------
  const curve = xpCurve(rpg);
  chunks.push(`xp_next_lo:\n${dbRows(curve.map((total) => total & 0xff))}`);
  chunks.push(`xp_next_hi:\n${dbRows(curve.map((total) => (total >> 8) & 0xff))}`);

  // --- the engine's own words ----------------------------------------------
  chunks.push(`NAME_LEN = ${NAME_LIMIT}`);
  chunks.push(`CMD_NAME_LEN = ${CMD_LEN}`);
  battleStrings.forEach(([name], index) => chunks.push(`BS_${name} = ${index}`));
  chunks.push(
    `bs_text:\n${dbRows(
      battleStrings.flatMap(([, text]) => textToTiles(text.padEnd(MSG_COLS, ' ').slice(0, MSG_COLS)).tiles),
      MSG_COLS
    )}`
  );
  chunks.push(
    `cmd_names:\n${dbRows(
      BATTLE_COMMANDS.flatMap((text) => textToTiles(text.padEnd(CMD_LEN, ' ').slice(0, CMD_LEN)).tiles),
      CMD_LEN
    )}`
  );

  return `${chunks.join('\n')}\n`;
}

/**
 * The lines the battle box says. Fixed, and part of the engine rather than the
 * project: they are the same twelve columns wide as the message area, and the
 * last three are overwritten by a number when the line has one.
 *
 * The order is the wire format — `BS_*` in the generated header is this list
 * written down, exactly as the actions and the game states are.
 */
export const BATTLE_STRINGS = [
  ['HITS', 'hits'],
  ['MISSES', 'misses'],
  ['HEALS', 'recovers'],
  ['NOMP', 'no MP'],
  ['NORUN', 'cannot run'],
  ['FLED', 'got away'],
  ['VICTORY', 'Victory!'],
  ['DEFEAT', 'Wiped out.'],
  ['NOTHING', 'no effect'],
  ['POISONS', 'poisons'],
  ['SUFFERS', 'poisoned']
];

/** The four commands down the left of the battle box, padded to one width. */
export const BATTLE_COMMANDS = ['FIGHT', 'MAGIC', 'ITEM', 'RUN'];
export const CMD_LEN = 8;
const MSG_COLS = 12;

/**
 * push_battle_string (engine/battleui.asm) accumulates index * MSG_COLS the
 * same 8-bit way name_offset_pc used to before the fix in
 * handoff-namestride/brief-namestride.md -- safe today only because
 * BATTLE_STRINGS has 11 entries (max offset 120 of 256), not because
 * anything stops a 22nd. It is out of scope for an engine change (the brief's
 * own call): a 22nd string is the same wraparound, so this fails the build
 * at the 22nd string instead, rather than leaving a comment nobody reads.
 */
export function checkBattleStringsCapacity(list = BATTLE_STRINGS) {
  if (list.length * MSG_COLS > 256) {
    throw new Error(
      `BATTLE_STRINGS has ${list.length} entries at ${MSG_COLS} columns each ` +
        `(${list.length * MSG_COLS} bytes) -- past the 256-byte range push_battle_string ` +
        '(engine/battleui.asm) can address with its 8-bit index * MSG_COLS stride. ' +
        'See handoff-namestride/brief-namestride.md.'
    );
  }
}

/** Problems that would make the battle system unbuildable, in plain language. */
export function checkBattleTables(project) {
  const problems = [];
  if (project.project?.gameType !== 'rpg') return problems;

  const party = project.party ?? [];
  if (!party.some((member) => member.startsInParty)) {
    problems.push({
      severity: 'error',
      where: 'Sprite Forge',
      message: 'No party member starts in the party, so the first battle would begin with nobody in it.'
    });
  }
  if ((project.spells ?? []).length > 8) {
    problems.push({
      severity: 'warning',
      where: 'Magic Forge',
      message:
        `This project has ${project.spells.length} spells, and a party member can only learn the first 8. ` +
        'The rest can still be cast by monsters.'
    });
  }
  for (const member of party) {
    for (const entry of member.spells ?? []) {
      if (entry.level > project.rpg.maxLevel) {
        problems.push({
          severity: 'warning',
          where: 'Sprite Forge',
          message:
            `${member.name} learns a spell at level ${entry.level}, past the maximum of ` +
            `${project.rpg.maxLevel}, so it will never be learned.`
        });
      }
    }
  }
  const hostile = project.sprites.actors.filter(isMonsterActor);
  if (!hostile.length) {
    problems.push({
      severity: 'warning',
      where: 'Sprite Forge',
      message: 'No actor is hostile, so no battle can start. Give a monster some contact damage.'
    });
  }
  if (party.length > RPG_LIMITS.party) {
    problems.push({
      severity: 'error',
      where: 'Sprite Forge',
      message: `The party holds ${RPG_LIMITS.party} members and this project has ${party.length}.`
    });
  }
  return problems;
}

// --------------------------------------------------------------------------
// The region's capacity check.
//
// `assets/battle.inc` (the tables above) and engine/battle.asm — which itself
// pulls in battleui.asm and battleturn.asm — share one 8 KB region of the
// switchable window, the slot `codeRegions()` (shared/cartridge.js) takes off
// the front of it for an RPG. Nothing bounded that region until this: an
// overflow surfaced as nesasm's own "Bank overflow" attributed to whatever
// source line happened to fall past the end, which is exactly the raw
// assembler output CLAUDE.md's own convention refuses to show a user.
//
// This lives here rather than beside kernelCodeBytes in main/build/generate.js,
// where this codebase otherwise keeps capacity arithmetic, for one hard
// reason: generate.js reaches for node:fs, so the renderer cannot import it,
// and the Build panel's meter would then need a second copy of the budget --
// the drift this check exists to prevent, reintroduced one layer out. It is
// also simply the better home, by the same argument battleTableBytes makes
// below: anyone changing what battleTables emits sees what sizes it.
//
// Unlike kernelCodeBytes this budget is *exact* rather than an over-estimate,
// and the difference is worth stating because it changes what the test may
// assert. kernel-lo holds engine code the JS side cannot size alongside lookup
// tables it models by hand, so it reserves generously and leaves KERNEL_SLACK
// on top. Here there are exactly two occupants, and only one of them is exact
// by construction: the tables, counted off battleTables' own emitted output
// rather than modelled, so no drift between the count and the emit is
// possible. The other half -- the stock engine code -- is a hand-measured
// constant like any other, and what keeps it honest is the equality assertion
// in test/unit/bankedbytes.test.js, not construction. "Exact today, held by
// the test" is the accurate phrasing; a stale base would be as wrong here as
// anywhere else, it would just fail loudly on the next run.
//
// What the measurement showed: across five table-varying project variants (+6
// actors, +3 spells, +1 party member, maxLevel 5, and the fixture unchanged)
// on all three RPG-capable boards, `base + battleTableBytes` equalled nesasm's
// own reported usage for the region to the byte -- fifteen builds, which is
// what the test re-runs. bankedbytes.test.js therefore asserts equality rather
// than a margin band.
//
// BASE_BATTLE_CODE_BYTES_BY_MAPPER is per mapper from the outset rather than
// one flat number split later, which is the mistake BASE_KERNEL_CODE_BYTES
// made and BASE_KERNEL_CODE_BYTES_BY_MAPPER had to undo. MMC3 is 46 bytes
// bigger than the other two, and the 46 bytes are the `.if SPLIT_ENABLED`
// blocks inside the region itself -- engine/battle.asm's split arm and
// engine/battleui.asm's sprite targeting cursor, which exists because on a
// font-split build the arrow glyph's bank is only mapped below the battle box.
//
// That does NOT need a separate conditional term the way
// SPLIT_KERNEL_ALLOWANCE does in generate.js, and the reason is worth
// writing down so nobody adds one: SPLIT_ENABLED is fontBankSplit(), which is
// `scanlineIrq && projectUsesText`, and projectUsesText (shared/font.js)
// returns true for `gameType === 'rpg'` on the game type alone. This region
// only exists for an RPG (codeRegionCount). So every project that reserves
// this region on MMC3 pays those 46 bytes -- there is no MMC3-RPG-without-the-
// split to overcharge, which is precisely the case that forced the kernel's
// split term out of MMC3's base. Here it is a property of the board.
//
// Magic Forge phase 4 (`BE_RESTORE`, handoff-magic/phase4-design.md) added a
// uniform +18 on all three boards -- measured, not estimated: `battle_entry`'s
// own dispatch chain (engine/battle.asm) grew an explicit `cmp #BE_JOIN`
// before its now-fourth arm, and the new `party_restore` routine loops every
// party member, recomputing `pc_spells`/`pc_hp_max`/`pc_mp_max` from their
// restored level on `Continue` (see `main/build/generate.js`'s own
// `SAVE_BATTLE_KERNEL_ALLOWANCE` comment for why the save's raw `pc_spells`
// byte can't be trusted). Nothing in either addition branches on
// `SPLIT_ENABLED` or anything else mapper-specific, so the +18 lands
// identically on all three boards -- MMC3's own extra 46 bytes above is
// unchanged by it (4002 - 3956 = 46, the same gap as before).
//
// The join-guard brief (handoff-next/join-guard-brief.md) added a further
// uniform +5 on all three boards: battle_entry_join (engine/battle.asm) now
// guards its own ldx bt_arg with cpx #PARTY_SIZE / bcs, the same bound
// party_init_slot already held for its own call to party_join, before the
// unguarded jmp party_join -- a stale or hand-edited member (NO_MEMBER, or a
// numeric index a shrunk party no longer covers) indexed party_apply_level's
// per-level tables past their end with no check at all. Measured with items
// stripped (project.items = []), to isolate this delta from
// ITEM_LIST_FILTER_BATTLE_ALLOWANCE the same way that allowance's own
// isolation test does: nesasm's own usage grew from 3956/3956/4002 to
// 3961/3961/4007 on UNROM 512/MMC1/MMC3 respectively -- the same +5 on every
// board because the new guard branches on nothing mapper-specific, the
// identical reasoning the BE_RESTORE paragraph above already gives for its
// own uniform +18. MMC3's own extra 46-byte SPLIT_ENABLED gap is unchanged by
// it (4007 - 3961 = 46).
export const BASE_BATTLE_CODE_BYTES_BY_MAPPER = { 30: 3961, 1: 3961, 4: 4007 };

// Phase 4c round 3, finding 6 (phase4-design.md §9), corrected round 3b
// (review K1): the two-menu-consistency filter (build_item_list's kind/
// amount check, plus battle_menu_item's own build-before-deciding fix for
// finding 5) cost 17 bytes, measured with nesasm on all three boards --
// §5's own estimate of "roughly 25-30 bytes" was a guess and overshot the
// real figure. Uniform across boards because neither change branches on
// SPLIT_ENABLED or anything else board-specific: MMC3 is still exactly 46
// bytes above the other two, the paragraph above's own SPLIT_ENABLED delta,
// undisturbed by this round.
//
// This was folded straight into BASE_BATTLE_CODE_BYTES_BY_MAPPER the first
// time, and that was wrong: every new instruction in both routines sits
// behind `.if ITEMS_ENABLED` (build_item_list's own filter block, and
// battle_menu_item's `jsr build_item_list` gate), so an item-free RPG's ROM
// never assembles a single byte of it -- confirmed directly, against real
// nesasm usage on MMC3: an item-free build assembles the region at 4320
// bytes, sample-rpg with its one live item at 4348, a 28-byte gap that is
// exactly the 17-byte code term plus the 11 bytes battleTableBytes already
// (and correctly) attributes to the item tables (item_name/item_heal).
// Those two figures are what nesasm actually assembled, not this file's own
// estimate of it -- battleRegionBytes() now predicts the identical numbers
// on both sides of that gap (bankedbytes.test.js asserts the equality), but
// before this fix it did not: conflating "what the estimator currently
// outputs" with "what the ROM actually contains" is the distinction whose
// absence let the unconditional folding above ship in the first place.
// Charging every project the 17 unconditionally is the
// identical mistake BASE_KERNEL_CODE_BYTES_BY_MAPPER's own base once made
// with a title screen it hadn't yet learned to charge conditionally
// (TITLE_KERNEL_ALLOWANCE_BY_MAPPER, generate.js) -- here it overcharges
// instead of undercharging, but the failure mode is just as real: an
// item-free project's Build-panel meter and checkCapacity's own estimate
// both grow by 17 bytes the assembled ROM never spends, and a project
// sitting in that exact 1-17 byte band would be refused for a shortfall
// that does not exist. Flat, not per-mapper, for the identical reason
// ITEM_KERNEL_ALLOWANCE (generate.js) is flat rather than *_BY_MAPPER:
// nothing this term covers branches on SPLIT_ENABLED or any other
// mapper-specific fact, only on ITEMS_ENABLED.
export const ITEM_LIST_FILTER_BATTLE_ALLOWANCE = 17;

// Deliberate headroom, and its job is NOT the job KERNEL_SLACK does. There is
// no estimation error here for it to absorb -- see the exactness note above --
// so this is purely a buffer against the stock code growing a byte or two
// between one measurement and the next, so that growth surfaces as this
// check's own plain-language refusal rather than as nesasm's raw overflow. Its
// own constant rather than a reuse of KERNEL_SLACK, because the two answer
// different questions about different banks and should be free to move apart.
export const BATTLE_SLACK = 20;

// Every board that can reach this region has its own measured entry above:
// codeRegions() hands back nothing unless the project is an RPG, and an RPG
// needs rpgCapable() -- exactly UNROM 512, MMC1 and MMC3. So unlike
// baseKernelCodeBytes's own fallback, which stands in for five real boards,
// this one stands in for none and bankedbytes.test.js asserts it is
// unreachable.
//
// It exists anyway, and specifically as the largest of the three rather than
// as a throw or an undefined, because of what `undefined` would do here: the
// whole budget becomes NaN, and every comparison against NaN is false, so the
// refusal below would silently stop firing for that board. A capacity check
// that always passes is worse than one that fails loudly -- the same hazard
// kernelbytes.test.js's own SAVE_KERNEL_ALLOWANCE_BY_MAPPER guard exists for.
// Do not delete this as dead code; it is a fail-safe, not a case.
const FALLBACK_BASE_BATTLE_CODE_BYTES = Math.max(...Object.values(BASE_BATTLE_CODE_BYTES_BY_MAPPER));
export function baseBattleCodeBytes(mapper) {
  return BASE_BATTLE_CODE_BYTES_BY_MAPPER[mapper?.id] ?? FALLBACK_BASE_BATTLE_CODE_BYTES;
}

/**
 * How many bytes `battleTables` assembles to, counted off its own emitted
 * source rather than re-derived from the table shapes here.
 *
 * That direction matters. A second, hand-maintained model of what those tables
 * are is exactly the drift checkCapacity's own `tableBytes` came to grief on
 * (it charged kernel-lo for entity records that live in screen data); counting
 * the single writer's real output cannot drift from it, because it *is* it.
 *
 * The count is complete by construction, not merely consistent: battleTables
 * emits labels, equates, one comment and `.db` rows and nothing else (66 `.db`
 * rows, 42 labels, 16 equates, 1 comment for sample-rpg today), and of those
 * only `.db` stores anything. `emittedBytes` therefore *throws* on a directive
 * it cannot size rather than skipping it -- a counter that silently ignores
 * what it does not recognise is the same shape of bug as parseNesasmErrors
 * reading an unrecognised message as a successful build. Add a `.dw` row to
 * battleTables and this fails loudly at the next build instead of quietly
 * undercounting the region by two bytes a row.
 */
export function battleTableBytes(project, battleStrings = BATTLE_STRINGS) {
  return emittedBytes(battleTables(project, battleStrings));
}

/**
 * Exported for one reason: so the test that this refuses what it cannot size
 * can actually drive an unrecognised directive through it. battleTables emits
 * only `.db` today, so nothing reachable through battleTableBytes can exercise
 * the throw -- which is exactly how the first version of that test came to
 * pass with the throw replaced by a `continue`. Same reasoning as
 * screenCapacityFor and assignScreenBanks in main/build/generate.js being
 * exported and taking plain arguments: a branch no caller can reach is a
 * branch no black-box test can check.
 */
export function emittedBytes(source) {
  let bytes = 0;
  for (const [index, raw] of source.split('\n').entries()) {
    // A label is allowed to share its line with what follows it, even though
    // dbRows does not currently put one there -- stripping it is cheaper than
    // depending on a formatting choice this counter has no say over.
    const text = raw
      .replace(/;.*$/, '')
      .trim()
      .replace(/^[A-Za-z_][A-Za-z0-9_]*:\s*/, '');
    if (!text) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(text)) continue; // an equate stores nothing
    if (/^\.db\b/i.test(text)) {
      const operands = text.slice(3).trim();
      if (!operands) throw new Error(`internal: battleTables emitted a .db with no operands on line ${index + 1}`);
      bytes += operands.split(',').length; // nesasm stores one byte per .db operand
      continue;
    }
    throw new Error(
      `internal: battleTableBytes cannot size "${text}" (line ${index + 1} of battleTables' output). ` +
        'Teach emittedBytes how many bytes this directive stores before emitting it, or the banked ' +
        'code region\'s capacity check will undercount and promise room the assembler refuses.'
    );
  }
  return bytes;
}

/**
 * The stock engine files that assemble into the banked code region, and
 * therefore the ones a Code Forge override of makes battleRegionBytes an
 * estimate rather than a measurement. engine/battle.asm is what
 * assets/code.inc includes; battleui.asm and battleturn.asm are what
 * battle.asm itself includes, and they are in this region for that reason
 * rather than by being named anywhere the generator can see.
 */
export const BATTLE_REGION_SOURCES = ['battle.asm', 'battleui.asm', 'battleturn.asm'];

/**
 * Files that are not *in* the region but decide what goes into it and where.
 * engine/main.asm is the one: `assets/code.inc` -- the generated `.bank`/`.org`
 * pair, the tables, the include of battle.asm and the end-of-region `.fail` --
 * reaches the ROM only because main.asm includes it, so an override of main.asm
 * can move that include, or leave it out altogether, guard and all.
 *
 * This is a strictly weaker guarantee than a battle-source override, not the
 * same one, which is why it gets its own list and its own predicate. Overriding
 * battle.asm makes the region's *size* unknown while leaving the tables where
 * they are, so "the tables alone must fit" still holds. Overriding main.asm
 * makes it unknown whether the tables are in that region at all -- so even that
 * bound is gone, and nothing here may refuse a build on it.
 *
 * Kept separate from BATTLE_REGION_SOURCES also because the test that pins that
 * list walks battle.asm's own include graph, and main.asm is one level above it.
 */
export const BATTLE_REGION_PLACEMENT_SOURCES = ['main.asm'];

/**
 * Does this project override any of them? The one honest qualifier on the
 * word "exact" everywhere else in this block.
 *
 * BASE_BATTLE_CODE_BYTES_BY_MAPPER measures the *stock* files. How much a
 * hand-written override assembles to cannot be known from its text -- the
 * same reason CLAUDE.md gives for leaving all user code outside
 * checkCapacity's byte math -- so for an override project the base is a stale
 * measurement of a file that is no longer being assembled, and everything
 * built on it is an estimate.
 *
 * This answers only "is the region's size unknown". Whether the region is even
 * where this module thinks it is, is battleRegionPlacementOverridden below --
 * a separate question with a separate answer, because the two license
 * different amounts of arithmetic. It is deliberately not a refusal: overriding
 * battle.asm is a supported thing to do, the assembler is the capacity check
 * for hand-written code, and the `.fail` the generator emits after the
 * include is the backstop for what this cannot see. What it must not do is go
 * on calling itself exact -- so the meter says so, and so does the refusal.
 */
export function battleCodeOverridden(project) {
  return (project.code?.overrides ?? []).some((file) => BATTLE_REGION_SOURCES.includes(file.name));
}

/**
 * Does an override of a battle-region source *look like* it relocates -- does
 * its text contain a token shaped like a `.bank` or `.org` relocation?
 *
 * This exists because the end-of-region `.fail` the generator emits has a
 * second blind spot beyond the one it can reason about. The guard reads the
 * location counter *after* everything is assembled, so it bounds where the
 * region ends up, not where the assembler went in between. An override that
 * relocates, emits bytes somewhere else and comes back finishes inside the
 * bounds with the guard none the wiser. Reproduced on a real build: on
 * UNROM 512, an override ending `.bank 0 / .org $8000 / .db $AA,$BB,$CC,$DD /
 * .bank 1 / .org $B000` overwrites four bytes of the CHR payload already
 * emitted at bank 0, assembles cleanly, and ships the corruption in the ROM.
 *
 * **This is a lexical best-effort and nothing more.** It is a JavaScript
 * approximation of nesasm's parser, asked about code this codebase is
 * explicitly forbidden from sizing, so it cannot be complete and no comment or
 * message here may imply that it is. Two limits it will never close:
 *
 *  - A relocation reached through `.include` -- the directive is in another
 *    file, and this reads one file's text.
 *  - A relocation produced by macro expansion -- the directive exists only
 *    after nesasm expands it, which only nesasm can do.
 *
 * So the warning it drives says "this text contains something shaped like a
 * relocation", never "there is a directive here" and never "we checked and your
 * build is safe". False positives are the accepted cost and are deliberately
 * not filtered: an `.org` inside `.if 0`, or in a macro body nothing invokes,
 * assembles to nothing and still warns, and so does a label someone named
 * `org`. A spurious warning costs a moment's attention; a missed one costs a
 * silently corrupt ROM, and the whole point of the warning is the case the
 * guard cannot see.
 *
 * Scanning text for something shaped like a relocation is not the kind of guess
 * CLAUDE.md refuses to make about hand-written code. Refusing to *size* an
 * override is a guess; noticing that its text contains something spelled `.org`
 * is a fact about the text -- which is exactly why it stays a fact even when
 * the thing spelled that way turns out to be a label rather than a directive.
 *
 * The scan is per token rather than anchored at the start of a line, because
 * every one of these assembles cleanly under real nesasm v3.1 and an anchored
 * match sees only the last:
 *
 *   BANK 0 / ORG $8000          undotted -- the easiest to write by accident
 *   bt_lab .org $8100           a label with no colon
 *   .locallab: .org $8100       a dot-prefixed local label, which itself looks
 *                               like a directive to an anchored match
 *   bt_lab: .org $8100          a label with a colon
 *   zz_b:.org $8100             a label whose colon is glued to the directive:
 *                               nesasm needs no whitespace after a colon, so
 *                               this really does relocate, and splitting on
 *                               whitespace alone leaves it one unmatchable
 *                               token -- which is why a token carrying a colon
 *                               is judged on what follows it
 *
 * Quoted spans come out before comments do, so a `;` inside a string cannot
 * truncate the line and an `.org` inside a `.db` string cannot count.
 */
export function battleRegionRelocates(project) {
  return (project.code?.overrides ?? [])
    .filter((file) => BATTLE_REGION_SOURCES.includes(file.name))
    .some((file) => lineRelocates(String(file.text ?? '')));
}

function lineRelocates(text) {
  for (const raw of text.split('\n')) {
    const scrubbed = raw
      .replace(/"[^"]*"/g, ' ')
      .replace(/'[^']*'/g, ' ')
      .replace(/;.*$/, '');
    for (const token of scrubbed.split(/[\s,]+/)) {
      // A colon is nesasm's label terminator and it needs no whitespace after
      // it: `zz_b:.org $8100` relocates exactly as `zz_b: .org $8100` does --
      // verified against nesasm v3.1, which assembles it clean and really does
      // move the bytes. So a token carrying colons is judged on what follows
      // each of them and a token carrying none is judged whole: `zz_b:.org`
      // -> `.org`, which warns, while a bare `bank:` or `.locallab:` is a label
      // named after a directive, yields an empty trailing segment, and does not.
      // Splitting on every colon also warns on `a:b:.org`, which nesasm rejects
      // outright ("Reserved symbol!"/"Unknown instruction!", no ROM) -- an
      // accepted false positive under the policy above, not a form that
      // assembles, and it costs nothing to leave in.
      const parts = token.includes(':') ? token.split(':').slice(1) : [token];
      // A leading dot is optional and the case is not significant.
      if (parts.some((part) => /^\.?(bank|org)$/i.test(part))) return true;
    }
  }
  return false;
}

/**
 * Has this region's *placement* been taken over -- is engine/main.asm itself
 * overridden?
 *
 * False for every project that leaves engine/main.asm alone, which is all of
 * them until someone overrides it. When it is true, nothing about this region
 * may be refused: the generated tables' own `.bank`/`.org` come from
 * assets/code.inc, and an overriding main.asm decides whether that file is
 * included at all. Refusing on "the tables alone do not fit" would then turn
 * away a project whose custom main puts them somewhere they fit perfectly well.
 *
 * The end-of-region `.fail` goes with it -- it is emitted *into* code.inc, so
 * an override that drops the include drops the guard too. That is the one case
 * where neither the JS check nor the assembler backstop covers this region, and
 * it is the ordinary consequence of taking over the file that decides the ROM's
 * whole layout, not a hole in either mechanism.
 */
export function battleRegionPlacementOverridden(project) {
  return (project.code?.overrides ?? []).some((file) => BATTLE_REGION_PLACEMENT_SOURCES.includes(file.name));
}

/**
 * What the banked code region will actually hold for this project, and what it
 * may hold -- exact for stock battle code, an estimate once battleCodeOverridden
 * (above) is true. One pair, consumed by both the check that refuses the build
 * (checkCapacity, main/build/generate.js) and the Build panel's own meter
 * (renderer/forges/build/build.js) -- the projectScreenCeiling precedent, for
 * the same reason it exists: a meter that computes its own ceiling is how the
 * panel comes to promise room the build then denies.
 *
 * The pair is "what it holds / what it may hold" rather than kernelCodeBytes's
 * "what to reserve", because nothing else shares this region -- there is no
 * third occupant for a reservation to leave room for -- and because those two
 * numbers are exactly what a meter renders.
 */
export function battleRegionBytes(project, mapper) {
  return (
    baseBattleCodeBytes(mapper) +
    battleTableBytes(project) +
    (projectUsesItems(project) ? ITEM_LIST_FILTER_BATTLE_ALLOWANCE : 0)
  );
}

// `mapper` is taken and deliberately unused: the ceiling is one nesasm bank on
// every board today, and every caller already has a mapper in hand. Keeping it
// in the signature means the day a board's region stops being 8 KB, this
// function changes and no call site does -- and it keeps the pair above
// symmetrical, so neither half can be called without saying which board.
// eslint-disable-next-line no-unused-vars
export function battleRegionCeiling(mapper) {
  return NESASM_BANK_BYTES - BATTLE_SLACK;
}

/**
 * What would actually close a shortfall in this region, in plain language --
 * kernelShortfallAdvice's job (main/build/generate.js), for the other bank.
 *
 * A different board CAN help here, which is not what it looks like at first
 * and was got wrong once already. Every RPG-capable board gives this region
 * the same 8 KB, so the ceiling never moves -- but the stock code inside it
 * is not the same size on all three, and MMC3 costs 46 bytes more than MMC1
 * and UNROM 512 for the split-font blocks it alone assembles. So an MMC3
 * project over by 1 to 46 bytes fits, unchanged, on either of the others, and
 * a flat "changing mapper does not help" would be false advice in exactly the
 * band where the advice matters most. The claim is therefore computed, not
 * asserted: it is only made when no candidate actually fits.
 *
 * `alternatives` are boards the caller has already established this project
 * could switch to without losing something -- switchableMappers
 * (main/build/generate.js), which owns that question for kernelShortfallAdvice
 * too. It is passed in rather than computed here because answering it needs
 * the generator's own screen packing, and this module must stay importable by
 * the renderer. A caller that passes nothing simply gets no board suggested,
 * which is the safe direction: never recommending a switch is a weaker
 * answer, recommending an unsafe one is a wrong answer.
 *
 * `exact` is false when the project overrides the battle system's own source,
 * and it changes what may honestly be promised rather than merely adding a
 * caveat. With a stock base the deficit is a real number, so a reduction that
 * covers it *is* a fix. With an override the base is unknown, so the same
 * reduction is only the least that could possibly fit -- necessary, not
 * sufficient -- and no board can be said to fit either. Saying "would free
 * enough" there would be the same overclaim in a new place.
 *
 * An options object rather than two more positional arguments, for the reason
 * screenCapacity's own `reserveFlashSave` comment (shared/cartridge.js) gives:
 * a bare trailing `true` at the call site reads as "what does this mean"
 * without opening this file.
 *
 * Each lever is measured, not derived: the deficit is covered by re-asking
 * battleTableBytes about a clone with k units removed, smallest k first, so no
 * per-unit cost is assumed to be linear and no second model of the table
 * shapes appears here either. The clones are local; nothing mutates `project`,
 * the same way projectWithoutCommands works on its own deep clone.
 *
 * Note what is NOT offered: shorter names. nameTiles pads every name to
 * NAME_LIMIT, so renaming a monster to one letter frees exactly nothing, and
 * advice that sends an author off to do that would be worse than no advice.
 */
export function battleShortfallAdvice(project, mapper, deficit, { alternatives = [], exact = true } = {}) {
  const target = battleTableBytes(project) - deficit;
  const levers = [
    {
      units: project.sprites.actors.length,
      reduce: (draft, k) => draft.sprites.actors.splice(draft.sprites.actors.length - k, k),
      describe: (k) => `removing ${k === 1 ? 'one actor' : `${k} actors`} in the Sprite Forge`
    },
    {
      units: (project.spells ?? []).length,
      reduce: (draft, k) => draft.spells.splice(draft.spells.length - k, k),
      describe: (k) => `removing ${k === 1 ? 'one spell' : `${k} spells`} in the Magic Forge`
    },
    {
      // At least one member has to remain, and checkBattleTables already
      // refuses a party nobody starts in -- so this never offers emptying it.
      units: Math.max(0, (project.party ?? []).length - 1),
      reduce: (draft, k) => draft.party.splice(draft.party.length - k, k),
      describe: (k) => `removing ${k === 1 ? 'one party member' : `${k} party members`} in the Sprite Forge`
    },
    {
      units: Math.max(0, (project.rpg?.maxLevel ?? 1) - 1),
      reduce: (draft, k) => {
        draft.rpg.maxLevel -= k;
      },
      describe: (k) => `lowering “Highest level” by ${k} in the Build panel`
    }
  ];

  const options = [];
  for (const lever of levers) {
    for (let k = 1; k <= lever.units; k++) {
      const draft = structuredClone(project);
      lever.reduce(draft, k);
      if (battleTableBytes(draft) <= target) {
        options.push(lever.describe(k));
        break;
      }
    }
  }

  // The board sentence, computed. A candidate qualifies only if the project's
  // tables fit *that* board's own region -- base and ceiling both read per
  // mapper, so this stays correct if a board's region size ever stops being
  // one nesasm bank. With an override nothing about fit is knowable, so no
  // board is offered and none is ruled out either.
  const roomier = exact
    ? alternatives
        .filter((candidate) => battleRegionBytes(project, candidate) <= battleRegionCeiling(candidate))
        .sort((a, b) => battleRegionBytes(project, a) - battleRegionBytes(project, b))[0]
    : undefined;
  let boards;
  if (!exact) {
    boards =
      'Because this project overrides the battle system’s own source, the assembler is the only thing that ' +
      'can tell you the real total.';
  } else if (roomier) {
    // "has room for it", not "fits this project as it stands". switchableMappers
    // deliberately tolerates errors the project already had on its current
    // board -- rejecting a candidate for an inherited problem would cost the
    // author every suggestion over an unrelated mistake -- so a candidate is
    // known to have room for the battle system, not known to build.
    boards =
      `${roomier.name} in the Build panel has room for it: the region is the same 8 KB on ` +
      `every board, but ${mapper.name} spends ${baseBattleCodeBytes(mapper) - baseBattleCodeBytes(roomier)} more ` +
      'of it on the battle code itself.';
  } else if (alternatives.length) {
    // "enough less", not "less": MMC1 and UNROM 512 do spend 46 fewer bytes
    // than MMC3, and saying they spend no less would be false whenever the
    // deficit is simply bigger than 46.
    boards =
      'Every board that can hold an RPG gives this region the same 8 KB, and none of the ones this project ' +
      'could switch to spends enough less of it, so changing mapper does not help.';
  } else {
    // No candidates were offered -- either the caller supplied none, or every
    // board was ruled out for reasons this function never sees. Saying nothing
    // is the only honest option: "changing mapper does not help" is an
    // affirmative claim, and an empty list is an absence of information about
    // boards, not evidence about them. Getting this wrong told every
    // code-carrying project (which switchableMappers withholds boards from by
    // design) that no board could help, which nobody had established.
    boards = '';
  }
  const withBoards = (text) => (boards ? `${text} ${boards}` : text);

  if (!options.length) {
    return withBoards(
      'No single change closes this: it needs some combination of fewer actors, fewer spells, fewer ' +
      'party members and a lower “Highest level”.'
    );
  }
  // One option gets a plain sentence; several get a list. "would each free
  // enough" over a list of one reads as a mistake, and a list rendered as a
  // sentence reads as though every item is required rather than any one.
  const closes = exact ? 'would free enough' : 'is the least that could fit';
  if (options.length === 1) {
    const only = options[0];
    return withBoards(`${only[0].toUpperCase()}${only.slice(1)} ${closes}.`);
  }
  const last = options.pop();
  const lead = exact ? 'Any one of these frees enough' : 'The least that could fit is any one of these';
  return withBoards(`${lead}: ${options.join(', ')} or ${last}.`);
}
