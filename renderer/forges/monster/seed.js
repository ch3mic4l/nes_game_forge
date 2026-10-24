// The Monster Forge's "Start from" picker for "Derive from level..." (docs/design-monster-derive-seed.md §2). Two pure helpers, no
// DOM and no Node APIs, so node:test imports them directly. They live here and not in shared/: generatorHash
// (test/lua/sw_provenance.mjs:47) hashes every file under shared/ and main/build/, so a placement there would force a
// bound-evidence renewal (Chris, 2026-10-24, option B). Every bound, default, growth resolution and catalog rule is read from
// shared/project.js's own exports; only the generic numeric clamp is repeated.

import {
  MONSTER_GROWTH_FIELDS,
  ACTOR_BATTLE_DEFAULTS,
  GROWTH_STATS,
  RPG_LIMITS,
  effectiveGrowth,
  monsterActorIds
} from '../../../shared/project.js';

// Identical to shared/project.js's private clamp (:4863): Number conversion, the finite fallback, then rounding.
const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
};

/**
 * The starting rows the Monster Forge's "Derive from level..." picker offers (docs/design-monster-derive-seed.md §2-§5):
 * `{ rows, curves }` for one `source`, `{ kind: 'actor', index }` or `{ kind: 'party', index }`. `rows` holds only the
 * MONSTER_GROWTH_FIELDS keys that source supplies, each a fresh `{ base, perLevel }` inside that key's own bounds. An actor
 * (the open monster included) supplies all seven as flat values, `perLevel` 0; a nullish stored field is missing and reads
 * as ACTOR_BATTLE_DEFAULTS' value, a stored 0 stays 0. A party member supplies atk/def/mp/mag/mdef from effectiveGrowth (never
 * the raw baseX / xPerLevel fields, which a profile overrides) and no xp/gold. `curves` lists `{ key, shape }` for each
 * non-linear stat that actually grows, which a straight-line Derive only matches at levels 1 and 15. Never mutates `project`.
 */
export function seedMonsterGrowth(project, source) {
  const rows = {};
  const curves = [];
  if (source?.kind === 'actor') {
    const actor = project.sprites?.actors?.[source.index];
    if (!actor) throw new Error(`No actor ${source.index} to seed Derive from.`);
    const battle = actor.battle ?? {};
    for (const { key, ceiling } of MONSTER_GROWTH_FIELDS) {
      const fallback = ACTOR_BATTLE_DEFAULTS[key];
      rows[key] = { base: clamp(battle[key] ?? fallback, 0, ceiling, fallback), perLevel: 0 };
    }
  } else if (source?.kind === 'party') {
    const member = project.party?.[source.index];
    if (!member) throw new Error(`No party member ${source.index} to seed Derive from.`);
    const growth = effectiveGrowth(project, member);
    for (const { key, ceiling, perLevelMax } of MONSTER_GROWTH_FIELDS) {
      if (!GROWTH_STATS.includes(key)) continue; // xp and gold have no party analogue
      const record = growth[key];
      const perLevel = clamp(record.perLevel, 0, perLevelMax);
      rows[key] = { base: clamp(record.base, 0, ceiling), perLevel };
      if ((record.shape === 'early' || record.shape === 'late') && perLevel > 0) curves.push({ key, shape: record.shape });
    }
  } else {
    throw new Error('Unknown Derive seed source.');
  }
  return { rows, curves };
}

/**
 * The picker's list for the open monster `actorIndex`: `self` first (the actor's own values, the modal's single source of
 * initial and reset rows), then the other catalog monsters (monsterActorIds, id order), then every party member. Each entry is
 * `{ id, kind, group, name, label, rows, filled, curves }`. `rows` is total -- the source's own keys where it supplies them,
 * `self`'s elsewhere -- and every entry holds its own row objects. `filled` names the keys the source itself supplied. Plain
 * data read once, so picking later never touches the project (§9).
 */
export function monsterSeedSources(project, actorIndex) {
  const actors = project.sprites?.actors ?? [];
  const copyRows = (rows) => Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, { ...row }]));
  const own = seedMonsterGrowth(project, { kind: 'actor', index: actorIndex });
  const entries = [
    {
      id: 'self',
      kind: 'self',
      group: null,
      name: actors[actorIndex].name,
      label: 'This monster’s current values',
      rows: copyRows(own.rows),
      filled: Object.keys(own.rows),
      curves: []
    }
  ];
  for (const index of monsterActorIds(project)) {
    if (index === actorIndex) continue;
    const actor = actors[index];
    const seeded = seedMonsterGrowth(project, { kind: 'actor', index });
    const level = actor.battle?.level;
    const hasLevel = level !== null && level !== undefined;
    entries.push({
      id: `actor:${index}`,
      kind: 'actor',
      group: 'Other monsters',
      name: actor.name,
      label: hasLevel ? `${actor.name} · Lv ${clamp(level, 1, RPG_LIMITS.maxLevel)}` : actor.name,
      rows: copyRows(seeded.rows),
      filled: Object.keys(seeded.rows),
      curves: []
    });
  }
  (project.party ?? []).forEach((member, index) => {
    const seeded = seedMonsterGrowth(project, { kind: 'party', index });
    entries.push({
      id: `party:${index}`,
      kind: 'party',
      group: 'Party members',
      name: member.name,
      label: member.name,
      rows: copyRows({ ...own.rows, ...seeded.rows }),
      filled: Object.keys(seeded.rows),
      curves: seeded.curves.map((curve) => ({ ...curve }))
    });
  });
  return entries;
}
