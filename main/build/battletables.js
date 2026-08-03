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

import { ELEMENTS, RPG_LIMITS, SPELL_KINDS, SPELL_SCOPES } from '../../shared/project.js';
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
export function battleTables(project) {
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
  chunks.push(`mon_drop:\n${dbRows(battle((b) => (b.drop === null || b.drop === undefined ? 0xff : b.drop)))}`);
  chunks.push(`mon_drop_pct:\n${dbRows(battle((b) => b.dropPct ?? 0))}`);
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

  // --- spells ---------------------------------------------------------------
  chunks.push(`NUM_SPELLS = ${spells.length}`);
  chunks.push(`spell_cost:\n${dbRows(spells.map((spell) => spell.mpCost))}`);
  chunks.push(`spell_kind:\n${dbRows(spells.map((spell) => kindIndex(spell.kind)))}`);
  chunks.push(`spell_amount:\n${dbRows(spells.map((spell) => spell.amount))}`);
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
  BATTLE_STRINGS.forEach(([name], index) => chunks.push(`BS_${name} = ${index}`));
  chunks.push(
    `bs_text:\n${dbRows(
      BATTLE_STRINGS.flatMap(([, text]) => textToTiles(text.padEnd(MSG_COLS, ' ').slice(0, MSG_COLS)).tiles),
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
      where: 'Sprite Forge',
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
  const hostile = project.sprites.actors.filter((actor) => (actor.damage ?? 0) > 0);
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
