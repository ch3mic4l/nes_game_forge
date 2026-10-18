// Equipment (ROADMAP item 5), build commit C3: the engine half of docs/design-equipment.md sections 2, 3 and 10 rows 8, 9, 11, 12.
// Every test boots a ROM built from an equipment variant of sample-rpg in the headless emulator and asserts on engine RAM
// and real battle rounds. No menu exists yet (C4): pieces are worn through `startEquip`, or, where a test needs to put one
// on mid-session, through the engine's own equip_set called in isolation. Every test names the wrong implementation it
// catches. Nothing touches a checked-in fixture (every build is a mkdtemp variant).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { statAt } from '../../main/build/battletables.js';
import {
  A,
  ACCESSORY,
  ARMOR,
  BC_FIGHT,
  BC_MAGIC,
  BC_RUN,
  BP_MENU,
  MAX_ITEMS,
  MAX_PARTY,
  NO_ITEM,
  RAM,
  ST_BATTLE,
  ST_GAMEOVER,
  ST_GAMEPLAY,
  START,
  WEAPON,
  RIGHT,
  SELECT,
  ST_MENU,
  bag,
  boot,
  buildEquip,
  call,
  chooseCommand,
  eqIndex,
  equate,
  equipProject,
  pcBonus,
  pcEquip,
  piece,
  plain,
  selectBattleBank,
  setBag,
  startFight,
  tap,
  walkTo,
  waitForMenu
} from '../lib/equipharness.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const opts = { skip: !hasNesasm && 'nesasm not found on PATH' };

// sample-rpg's party: Rian (member 0) and Iris (1), both baseAtk 6 +1/level, baseDef 4 +1/level; members 2 and 3 are
// createPartyMember defaults. Read from the project under test, never typed twice.
const levelStat = (member, stat, level = 1) =>
  statAt(member[`base${stat}`], member[`${stat.toLowerCase()}PerLevel`], level);

/** The three-slot rig: items 1 Sword (weapon), 2 Mail (armor), 3 Charm (accessory), each with the given stats. */
const rig = (sword, mail, charm) => [
  piece(1, 'Sword', WEAPON, sword),
  piece(2, 'Mail', ARMOR, mail),
  piece(3, 'Charm', ACCESSORY, charm)
];

test('combatant_atk / def / mag / mdef add exactly the worn bonus for the member who wears it, and for nobody else', opts, async (t) => {
  // Member 0 wears the Sword (atk 7), member 2 the Mail (def 5) and the Charm (mag 3, mdef 2): every stat has an owner, and
  // the other members and the monsters must read the same as in an identical build where nobody wears anything.
  const items = rig({ atk: 7 }, { def: 5 }, { mag: 3, mdef: 2 });
  const worn = await buildEquip(t, await equipProject({ items, start: { 0: [1, null, null], 2: [null, 2, 3] } }));
  const bare = await buildEquip(t, await equipProject({ items }));
  const stats = { atk: 'combatant_atk', def: 'combatant_def', mag: 'combatant_mag', mdef: 'combatant_mdef' };
  const read = (built) => {
    const nes = boot(built.romPath);
    selectBattleBank(nes, built);
    const out = {};
    for (const [stat, label] of Object.entries(stats)) {
      out[stat] = [];
      for (let who = 0; who < 8; who++) out[stat].push(call(nes, built, label, { a: who, x: 0xa5, y: 0x5a }));
    }
    return out;
  };
  const w = read(worn);
  const b = read(bare);
  // member -> stat -> bonus
  const expected = { atk: [7, 0, 0, 0], def: [0, 0, 5, 0], mag: [0, 0, 3, 0], mdef: [0, 0, 2, 0] };
  for (const stat of Object.keys(stats)) {
    for (let who = 0; who < 8; who++) {
      const bonus = who < MAX_PARTY ? expected[stat][who] : 0;
      assert.equal(
        w[stat][who].a - b[stat][who].a,
        bonus,
        `${stat} of combatant ${who}: expected exactly +${bonus} over the same build with nothing worn ` +
          '(a bonus added to monsters too, to member 0 only, or to the wrong stat fails here)'
      );
      assert.equal(w[stat][who].x, 0xa5, `combatant_${stat}(${who}) must preserve X`);
      assert.equal(w[stat][who].y, 0x5a, `combatant_${stat}(${who}) must preserve Y`);
    }
  }
  // The level stat is still the base the bonus is added to, not replaced by it.
  const rian = worn.project.party[0];
  assert.equal(w.atk[0].a, levelStat(rian, 'Atk') + 7);
});

test('the bonus tracks the level stat: effective stat is level row + bonus at a raised level, and level-up leaves pc_eq_* alone', opts, async (t) => {
  const items = rig({ atk: 7 }, {}, {});
  const built = await buildEquip(t, await equipProject({ items, start: { 0: [1, null, null] } }));
  const nes = boot(built.romPath);
  selectBattleBank(nes, built);
  const bonusBefore = pcBonus(nes);
  nes.cpu.mem[RAM.PC_LEVEL] = 5;
  const rian = built.project.party[0];
  assert.equal(
    call(nes, built, 'combatant_atk', { a: 0 }).a,
    levelStat(rian, 'Atk', 5) + 7,
    'at level 5 the effective ATK is the level-5 row plus the worn +7'
  );
  assert.deepEqual(pcBonus(nes), bonusBefore, 'a level change must not touch the cached bonuses');
  // The real level-up routine, not just a poked level byte: try_level_up recomputes stats from the level rows and must neither
  // clear the equipment cache nor fold it into the level row (a cache rebuilt from pc_atk_at would lose the +7; one folded in
  // would double it).
  nes.cpu.mem[RAM.PC_LEVEL] = 1;
  nes.cpu.mem[RAM.PC_XP_LO] = 255;
  nes.cpu.mem[RAM.PC_XP_HI] = 255;
  call(nes, built, 'try_level_up', { x: 0 });
  const level = nes.cpu.mem[RAM.PC_LEVEL];
  assert.ok(level > 1, 'try_level_up should have raised the level');
  assert.deepEqual(pcBonus(nes), bonusBefore, 'a real level-up must leave pc_eq_* alone');
  assert.equal(call(nes, built, 'combatant_atk', { a: 0 }).a, levelStat(rian, 'Atk', level) + 7);
  assert.deepEqual(pcEquip(nes), [1, ...Array(11).fill(NO_ITEM)], 'a level-up must leave the worn ids alone');
});

test('every sum saturates at 255 for ALL FOUR stats: the stat (250 + 20), the three-slot bonus (3 x 100), and the monster side is unaffected', opts, async (t) => {
  // One rig, all four stats at once. Member 0: a weapon giving +20 of every stat on level stats pushed to 250 (zero growth), so
  // the reader's own add must saturate (a wrapped one is 270 mod 256 = 14). Member 1: three pieces giving +100 of every stat, so
  // the cache sum 3 x 100 must saturate (a wrapped one is 300 mod 256 = 44, and the effective stat 44 + level stat). Each of the
  // four combatant_* readers and each of the four equip_recalc sums has its own saturation, so removing any ONE of the eight
  // fails exactly the matching assertion below (tests/fix1 sabotage runs R1).
  const all = (n) => ({ atk: n, def: n, mag: n, mdef: n });
  const items = [
    piece(1, 'Big', WEAPON, all(20)),
    piece(2, 'H1', WEAPON, all(100)),
    piece(3, 'H2', ARMOR, all(100)),
    piece(4, 'H3', ACCESSORY, all(100))
  ];
  const built = await buildEquip(
    t,
    await equipProject({
      items,
      start: { 0: [1, null, null], 1: [2, 3, 4] },
      mutate: (p) => {
        for (const stat of ['Atk', 'Def', 'Mag', 'Mdef']) {
          p.party[0][`base${stat}`] = 250;
          p.party[0][`${stat.toLowerCase()}PerLevel`] = 0;
        }
      }
    })
  );
  const nes = boot(built.romPath);
  selectBattleBank(nes, built);
  const stats = { atk: ['combatant_atk', RAM.PC_EQ_ATK], def: ['combatant_def', RAM.PC_EQ_DEF], mag: ['combatant_mag', RAM.PC_EQ_MAG], mdef: ['combatant_mdef', RAM.PC_EQ_MDEF] };
  for (const [stat, [routine, cache]] of Object.entries(stats)) {
    assert.equal(call(nes, built, routine, { a: 0 }).a, 255, `${stat}: 250 + 20 saturates at 255 in the reader, it does not wrap to 14`);
    assert.equal(nes.cpu.mem[cache + 1], 255, `${stat}: three slots of +100 saturate the cached sum at 255, not 44`);
    assert.equal(call(nes, built, routine, { a: 1 }).a, 255, `${stat}: and member 1's effective stat with it`);
    assert.equal(nes.cpu.mem[cache + 0], 20, `${stat}: member 0's cache is exactly the one weapon's +20`);
  }
});

test('a real FIGHT round deals exactly the worn ATK bonus more, and the monster is hit by nothing else', opts, async (t) => {
  const items = rig({ atk: 9 }, {}, {});
  const dealt = async (start) => {
    const built = await buildEquip(t, await equipProject({ items, start }));
    const nes = boot(built.romPath);
    startFight(nes);
    nes.cpu.mem[RAM.MON_HP] = 250;
    chooseCommand(nes, BC_FIGHT);
    nes.cpu.mem[RAM.RNG] = 0x21;
    tap(nes, A, 20);
    return 250 - nes.cpu.mem[RAM.MON_HP];
  };
  const base = await dealt({});
  const withSword = await dealt({ 0: [1, null, null] });
  assert.ok(base > 0, 'the seeded swing must land, or the comparison measures nothing');
  assert.equal(withSword - base, 9, 'the same seeded swing, with the Sword on, hurts by exactly its ATK bonus more');
});

test('a real round: MAG adds exactly its bonus to a party spell, MDEF takes exactly its bonus off a monster spell', opts, async (t) => {
  const items = rig({}, { def: 3 }, { mag: 6, mdef: 4 });
  const prep = (p) => {
    p.spells[0].element = 'none'; // isolate from the weak/strong step
    p.sprites.actors[0].battle = { ...p.sprites.actors[0].battle, atk: 40 }; // Slime: a hit well clear of the damage floor
    p.sprites.actors[3].battle = { ...p.sprites.actors[3].battle, spellIds: [0], mag: 0, mdef: 0 }; // Snake casts a flat 10
  };
  // DEF is covered by the real monster swings below (the two physical_damage tests), not here.
  // MAG: Rian casts Ember (flat 10, no element) at Slime.
  const cast = async (start) => {
    const built = await buildEquip(t, await equipProject({ items, start, mutate: prep }));
    const nes = boot(built.romPath);
    startFight(nes);
    nes.cpu.mem[RAM.MON_HP] = 250;
    chooseCommand(nes, BC_MAGIC);
    tap(nes, A, 6);
    tap(nes, A, 20);
    return 250 - nes.cpu.mem[RAM.MON_HP];
  };
  const castBase = await cast({});
  const castCharm = await cast({ 0: [null, null, 3] });
  assert.equal(castBase, 10, 'sample-rpg Ember is a flat 10 with no element');
  assert.equal(castCharm - castBase, 6, 'the Charm adds exactly its +6 MAG to the spell');

  // MDEF: the Snake casts Ember at Rian.
  const spellTaken = async (start) => {
    const built = await buildEquip(t, await equipProject({ items, start, mutate: prep }));
    const nes = boot(built.romPath);
    walkTo(nes, 32, 112);
    walkTo(nes, 32, 208, 300);
    assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_BATTLE, 'walking into the Snake did not start a fight');
    nes.cpu.mem[RAM.PC_HP] = 255;
    nes.cpu.mem[RAM.PC_HP_MAX] = 255;
    let dealt = null;
    for (let round = 0; round < 60 && dealt === null; round++) {
      if (nes.cpu.mem[RAM.GAME_STATE] !== ST_BATTLE) break;
      const mpBefore = nes.cpu.mem[RAM.MON_SLOT_MP];
      const hpBefore = nes.cpu.mem[RAM.PC_HP];
      if (nes.cpu.mem[RAM.BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
      else tap(nes, A, 12);
      if (nes.cpu.mem[RAM.MON_SLOT_MP] < mpBefore) dealt = hpBefore - nes.cpu.mem[RAM.PC_HP];
    }
    assert.ok(dealt !== null, 'the Snake never cast');
    return dealt;
  };
  const spellBase = await spellTaken({});
  const spellCharm = await spellTaken({ 0: [null, null, 3] });
  assert.equal(spellBase, 10);
  assert.equal(spellBase - spellCharm, 4, 'the Charm takes exactly its +4 MDEF off the Snake\'s spell');
});

// --- physical_damage (ruling E11): a monster's real swing at a party member -------------------------------------------------
// physical_damage used to park the attacker's ATK in bt_tmp; combatant_def's party path runs level_row, which stores the member
// index there, so the hit was max(1, member index - DEF) + noise whatever either stat was. It parks in bt_dmg_lo now.

/**
 * Boot the build, fight Slime (ATK 40 in these projects) and let it take its first swing at party member `target`, who is made
 * the first living in-party member (pick_party_target takes the first one; Rian, who is already choosing, swings and is
 * skipped if dead). Returns the HP the swing took and its noise: the RNG is left in the state noise was rolled from, so
 * noise = rng & 3.
 */
function monsterSwing(built, target) {
  const nes = boot(built.romPath);
  startFight(nes);
  const mem = nes.cpu.mem;
  mem[RAM.MON_HP] = 250;
  for (let member = 0; member < MAX_PARTY; member++) {
    mem[RAM.PC_IN_PARTY + member] = member === target || member === 0 ? 1 : 0;
    mem[RAM.PC_HP + member] = member < target ? 0 : 255;
    mem[RAM.PC_HP_MAX + member] = 255;
  }
  mem[RAM.RNG] = 0x21;
  chooseCommand(nes, BC_FIGHT);
  for (let frame = 0; frame < 900 && mem[RAM.PC_HP + target] === 255; frame++) {
    const asking = mem[RAM.BT_PHASE] === BP_MENU || mem[RAM.BT_PHASE] === BP_TARGET;
    if (asking && frame % 10 === 0) tap(nes, A, 2);
    else nes.frame();
  }
  assert.equal(mem[RAM.GAME_STATE], ST_BATTLE, 'the fight ended before the swing');
  return { dealt: 255 - mem[RAM.PC_HP + target], noise: mem[RAM.RNG] & 3, level: mem[RAM.PC_LEVEL + target] };
}

const BP_TARGET = 2; // from engine/constants.asm
const slimeHits = (atk, shape) => (p) => {
  p.sprites.actors[0].battle = { ...p.sprites.actors[0].battle, atk };
  shape(p.party);
};

test('a real monster swing: worn DEF takes exactly its bonus off the member who wears it, and off nobody else', opts, async (t) => {
  const ATK = 40;
  const mutate = slimeHits(ATK, (party) => party.forEach((m) => { m.baseDef = 5; m.defPerLevel = 0; }));
  const items = rig({}, { def: 3 }, { def: 4 });
  const WEARER = 2; // not 0, so a bonus read at the wrong index or off the wrong column shows
  const off = await buildEquip(t, await equipProject({ items, mutate }));
  const on = await buildEquip(t, await equipProject({ items, start: { [WEARER]: [null, 2, 3] }, mutate }));
  for (let target = 0; target < MAX_PARTY; target++) {
    const before = monsterSwing(off, target);
    const after = monsterSwing(on, target);
    const bonus = target === WEARER ? 3 + 4 : 0;
    assert.equal(before.dealt, ATK - 5 + before.noise, `member ${target}, unequipped: ATK - DEF + noise exactly`);
    assert.equal(after.noise, before.noise, `member ${target}: the same seed rolled the same noise`);
    assert.equal(before.dealt - after.dealt, bonus, `member ${target}: the Mail's +3 and the Charm's +4 DEF come off the wearer's hit only`);
  }
});

test('equipment-free: a high-ATK monster swing is ATK - DEF + noise for every member, whatever the member index', opts, async (t) => {
  const ATK = 60;
  // Same DEF everywhere: members 0 and 3 must take the identical hit. Then four different DEFs: each hit follows its own member's DEF.
  const same = await buildEquip(t, await equipProject({
    mutate: slimeHits(ATK, (party) => party.forEach((m) => { m.baseDef = 7; m.defPerLevel = 0; }))
  }));
  const hits = [0, 1, 2, 3].map((member) => monsterSwing(same, member));
  hits.forEach((hit, member) => assert.equal(hit.dealt, ATK - 7 + hit.noise, `member ${member}: ATK - DEF + noise, not member index - DEF`));
  assert.equal(hits[3].dealt, hits[0].dealt, 'a member at index 3 and one at index 0 with the same DEF take the same hit');

  const DEFS = [3, 6, 9, 12];
  const distinct = await buildEquip(t, await equipProject({
    mutate: slimeHits(ATK, (party) => party.forEach((m, i) => { m.baseDef = DEFS[i]; m.defPerLevel = 0; }))
  }));
  DEFS.forEach((def, member) => {
    const hit = monsterSwing(distinct, member);
    assert.equal(hit.dealt, ATK - def + hit.noise, `member ${member} (DEF ${def}): the hit follows that member's DEF`);
  });

  // The floor: an ATK below every DEF scratches for 1, and the noise is added to the floored 1. Catches a swing that rolls the
  // noise before subtracting DEF ((ATK + noise) - DEF is the same sum everywhere above the floor, and different at it).
  const hopeless = await buildEquip(t, await equipProject({
    mutate: slimeHits(3, (party) => party.forEach((m) => { m.baseDef = 7; m.defPerLevel = 0; }))
  }));
  [0, 3].forEach((member) => {
    const hit = monsterSwing(hopeless, member);
    assert.ok(hit.noise > 0, 'the seed must roll a nonzero noise, or the floor case cannot tell the orders apart');
    assert.equal(hit.dealt, 1 + hit.noise, `member ${member}: an ATK 3 swing at DEF 7 is the floor of 1 plus the noise`);
  });
});

// --- equip_set: the bag half of putting a piece on and taking it off (design section 2, row 9) -----------------------------

/** Boot an equipment build, with the battle bank selected so equip_set can be called in isolation. */
async function equipRig(t, extra = {}) {
  const items = [
    piece(1, 'Sword', WEAPON, { atk: 7 }),
    piece(2, 'Axe', WEAPON, { atk: 12, def: 1 }),
    piece(3, 'Mail', ARMOR, { def: 5 }),
    plain(4, 'Tonic')
  ];
  const built = await buildEquip(t, await equipProject({ items, ...extra }));
  const nes = boot(built.romPath);
  selectBattleBank(nes, built);
  return { built, nes };
}
const SWORD = 1;
const AXE = 2;
const MAIL = 3;
const TONIC = 4;

test('equip_set wears a piece out of the bag, and taking it off puts it back at the end -- exact bag identities', opts, async (t) => {
  const { built, nes } = await equipRig(t);
  setBag(nes, [0, SWORD, TONIC]);
  let r = call(nes, built, 'equip_set', { a: SWORD, x: 0, y: WEAPON });
  assert.equal(r.carry, 0, 'putting a piece on is never refused');
  assert.deepEqual(bag(nes), [0, TONIC], 'the worn Sword left the bag; the others closed up in order');
  assert.equal(pcEquip(nes)[eqIndex(0, WEAPON)], SWORD);
  assert.deepEqual(pcBonus(nes).atk, [7, 0, 0, 0]);
  r = call(nes, built, 'equip_set', { a: NO_ITEM, x: 0, y: WEAPON });
  assert.equal(r.carry, 0);
  assert.deepEqual(bag(nes), [0, TONIC, SWORD], 'taking the Sword off returns exactly that id to the end of the bag');
  assert.equal(pcEquip(nes)[eqIndex(0, WEAPON)], NO_ITEM);
  assert.deepEqual(pcBonus(nes).atk, [0, 0, 0, 0], 'and its bonus is gone');
});

test('swapping a worn piece for one in a FULL bag keeps inv_count: the new piece leaves before the old one returns', opts, async (t) => {
  const { built, nes } = await equipRig(t, { start: { 0: [SWORD, null, null] } });
  setBag(nes, [0, TONIC, 0, TONIC, 0, TONIC, 0, AXE]); // eight: MAX_ITEMS
  assert.equal(nes.cpu.mem[RAM.INV_COUNT], MAX_ITEMS);
  const r = call(nes, built, 'equip_set', { a: AXE, x: 0, y: WEAPON });
  assert.equal(r.carry, 0, 'a swap is net zero for the bag and must not be refused at a full bag');
  assert.equal(nes.cpu.mem[RAM.INV_COUNT], MAX_ITEMS, 'inv_count is unchanged');
  assert.deepEqual(bag(nes), [0, TONIC, 0, TONIC, 0, TONIC, 0, SWORD], 'the Axe is on, the Sword took its bag slot -- nothing lost');
  assert.equal(pcEquip(nes)[eqIndex(0, WEAPON)], AXE);
  assert.deepEqual([pcBonus(nes).atk[0], pcBonus(nes).def[0]], [12, 1], 'the cache is the Axe\'s, not the Sword\'s plus the Axe\'s');
});

test('taking a piece off with a full bag is refused (carry set) and leaves the slot, the bag and the bonus exactly as they were', opts, async (t) => {
  const { built, nes } = await equipRig(t, { start: { 0: [SWORD, MAIL, null] } });
  setBag(nes, [0, TONIC, 0, TONIC, 0, TONIC, 0, TONIC]);
  const equipBefore = pcEquip(nes);
  const bonusBefore = pcBonus(nes);
  const r = call(nes, built, 'equip_set', { a: NO_ITEM, x: 0, y: ARMOR });
  assert.equal(r.carry, 1, 'a take-off with nowhere to put the piece is refused');
  assert.deepEqual(bag(nes), [0, TONIC, 0, TONIC, 0, TONIC, 0, TONIC]);
  assert.deepEqual(pcEquip(nes), equipBefore);
  assert.deepEqual(pcBonus(nes), bonusBefore);
});

test('wearing what is already worn, and taking off an empty slot, are no-ops with carry clear -- even at a full bag', opts, async (t) => {
  const { built, nes } = await equipRig(t, { start: { 0: [SWORD, null, null] } });
  setBag(nes, [0, TONIC, 0, TONIC, 0, TONIC, 0, TONIC]);
  const bagBefore = bag(nes);
  const equipBefore = pcEquip(nes);
  let r = call(nes, built, 'equip_set', { a: SWORD, x: 0, y: WEAPON });
  assert.equal(r.carry, 0, 'the same piece again is not a refusal');
  r = call(nes, built, 'equip_set', { a: NO_ITEM, x: 0, y: ARMOR });
  assert.equal(r.carry, 0, 'an empty slot has nothing to refuse (the D1 sketch refused this at a full bag)');
  assert.deepEqual(bag(nes), bagBefore);
  assert.deepEqual(pcEquip(nes), equipBefore);
});

test('the same piece worn by another member after its owner takes it off: slots and members are independent', opts, async (t) => {
  const { built, nes } = await equipRig(t);
  setBag(nes, [SWORD]);
  call(nes, built, 'equip_set', { a: SWORD, x: 2, y: WEAPON });
  assert.equal(pcEquip(nes)[eqIndex(2, WEAPON)], SWORD, 'member 2 holds it');
  assert.deepEqual(pcBonus(nes).atk, [0, 0, 7, 0], 'only member 2 gains the bonus');
  assert.deepEqual(pcEquip(nes).filter((id) => id !== NO_ITEM), [SWORD], 'and exactly one slot of twelve is occupied');
});

// --- starting equipment: New Game, Game Over, dormant members ---------------------------------------------------------------

test('startEquip is worn at boot for all four members, joined or not, with the bonus cache built and the bag untouched', opts, async (t) => {
  const items = [piece(1, 'Sword', WEAPON, { atk: 7 }), piece(2, 'Mail', ARMOR, { def: 5 }), piece(3, 'Charm', ACCESSORY, { mag: 3, mdef: 2 })];
  const built = await buildEquip(t, await equipProject({ items, start: { 0: [1, null, null], 2: [null, 2, 3], 3: [1, 2, 3] } }));
  const nes = boot(built.romPath);
  // slot-major: [weapon x4, armor x4, accessory x4]
  assert.deepEqual(pcEquip(nes), [1, NO_ITEM, NO_ITEM, 1, NO_ITEM, NO_ITEM, 2, 2, NO_ITEM, NO_ITEM, 3, 3]);
  assert.deepEqual(pcBonus(nes), { atk: [7, 0, 0, 7], def: [0, 0, 5, 5], mag: [0, 0, 3, 3], mdef: [0, 0, 2, 2] });
  assert.equal(nes.cpu.mem[RAM.PARTY_SIZE], 1, 'only Rian is recruited');
  assert.equal(nes.cpu.mem[RAM.INV_COUNT], 0, 'a starting piece is worn, never put in the bag');
  assert.deepEqual(Array.from(nes.cpu.mem.slice(RAM.PC_IN_PARTY, RAM.PC_IN_PARTY + 4)), [1, 0, 0, 0], 'the unjoined members keep their gear dormant');
});

test('Game Over restart re-applies startEquip: a worn set poked away before the restart is back, and a taken-off piece is not in the new bag', opts, async (t) => {
  const items = [piece(1, 'Sword', WEAPON, { atk: 7 })];
  const project = await equipProject({
    items,
    start: { 0: [1, null, null] },
    mutate: (p) => {
      p.project.titleMap = null; // titleless: a game over restarts straight into a new game
      const screen = p.maps[p.project.startMap].screens[p.project.startScreen];
      // A killing Damage on entry reaches game over through the ordinary field path (rpg.test.js's restart test does the same).
      screen.entities[0].props.trigger = 'enter';
      screen.entities[0].props.event = { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'damage', value: 255 }] }] };
    }
  });
  const built = await buildEquip(t, project);
  const nes = boot(built.romPath);
  for (let i = 0; i < 80 && nes.cpu.mem[RAM.GAME_STATE] !== ST_GAMEOVER; i++) nes.frame();
  assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_GAMEOVER, 'the entry event\'s killing Damage never reached game over');
  assert.deepEqual(pcEquip(nes).slice(0, 4), [1, NO_ITEM, NO_ITEM, NO_ITEM], 'worn through the first life');
  // Lose the gear as a player could (take it off, then lose the bag in the death), then restart.
  nes.cpu.mem.fill(NO_ITEM, RAM.PC_EQUIP, RAM.PC_EQUIP + 12);
  nes.cpu.mem.fill(0, RAM.PC_EQ_ATK, RAM.PC_EQ_ATK + 16);
  setBag(nes, [0]);
  for (let i = 0; i < 200 && nes.cpu.mem[RAM.BOX_STATE] !== 6; i++) nes.frame();
  tap(nes, START, 20);
  assert.deepEqual(pcEquip(nes).slice(0, 4), [1, NO_ITEM, NO_ITEM, NO_ITEM], 'restart_game -> init_session -> party_init re-applied startEquip');
  assert.deepEqual(pcBonus(nes).atk, [7, 0, 0, 0], 'and rebuilt the bonus cache');
  assert.equal(nes.cpu.mem[RAM.INV_COUNT], 0, 'the new session starts with an empty bag');
});

// --- pieces on the existing item paths (design section 2, row 12): nothing new, so each path must leave them alone --------

const BC_ITEM = 2;
const SELECT_BUTTON = SELECT;

test('use_item on a piece does nothing and keeps it; the same menu spends an ordinary item (control)', opts, async (t) => {
  const items = [piece(1, 'Sword', WEAPON, { atk: 7 })];
  const built = await buildEquip(t, await equipProject({ items }));
  const nes = boot(built.romPath);
  setBag(nes, [SWORD, 0]);
  const hpBefore = nes.cpu.mem[RAM.PC_HP];
  tap(nes, SELECT_BUTTON, 6); // gameplay SELECT = item: opens the field menu
  assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_MENU, 'SELECT should open the field menu');
  assert.equal(nes.cpu.mem[RAM.INV_SEL], 0);
  tap(nes, A, 6); // confirm the highlighted Sword
  assert.deepEqual(bag(nes), [SWORD, 0], 'a none-kind piece is a key item: kept, bag unchanged');
  assert.equal(nes.cpu.mem[RAM.PC_HP], hpBefore);
  assert.deepEqual(pcEquip(nes), Array(12).fill(NO_ITEM), 'and it was not put on by being used');
  // Control: the same menu, the next row, a Potion -- spent. Proves the keystrokes above reach use_item at all.
  nes.cpu.mem[RAM.PC_HP] = 3;
  tap(nes, RIGHT, 6); // the field menu's row of icons moves left and right
  tap(nes, A, 6);
  assert.deepEqual(bag(nes), [SWORD], 'the Potion was spent');
  assert.ok(nes.cpu.mem[RAM.PC_HP] > 3, 'and healed');
});

test('the battle Item menu does not list a piece, and a hand-built item_chosen for one answers BS_NOTHING and removes nothing', opts, async (t) => {
  const items = [piece(1, 'Sword', WEAPON, { atk: 7 })];
  const built = await buildEquip(t, await equipProject({ items }));
  const nes = boot(built.romPath);
  setBag(nes, [SWORD, 0]);
  startFight(nes);
  chooseCommand(nes, BC_ITEM);
  assert.equal(nes.cpu.mem[RAM.BT_LEN], 1, 'the list holds the Potion only');
  assert.equal(nes.cpu.mem[RAM.BT_LIST], 0, 'and its one entry is the Potion\'s item id');
  assert.deepEqual(bag(nes), [SWORD, 0]);

  // Back out, then hand the engine what the menu would never offer: a piece chosen as an item.
  tap(nes, 1 /* B */, 6);
  selectBattleBank(nes, built);
  nes.cpu.mem[RAM.BT_LIST] = SWORD;
  nes.cpu.mem[RAM.BT_SEL] = 0;
  nes.cpu.mem[RAM.BT_ACTOR] = 0;
  const hp = nes.cpu.mem[RAM.PC_HP];
  call(nes, built, 'item_chosen');
  assert.equal(nes.cpu.mem[RAM.BT_STR], equate(built, 'BS_NOTHING'), 'a piece "used" in battle says nothing happened');
  assert.deepEqual(bag(nes), [SWORD, 0], 'and removes nothing');
  assert.equal(nes.cpu.mem[RAM.PC_HP], hp);
  // Control: the Potion through the same routine is spent.
  nes.cpu.mem[RAM.BT_LIST] = 0;
  nes.cpu.mem[RAM.PC_HP] = 1;
  call(nes, built, 'item_chosen');
  assert.equal(nes.cpu.mem[RAM.BT_STR], equate(built, 'BS_HEALS'));
  assert.deepEqual(bag(nes), [SWORD], 'the Potion was removed');
});

test('a monster drop of a piece lands in the bag; with a full bag it is the existing silent skip', opts, async (t) => {
  const items = [piece(1, 'Sword', WEAPON, { atk: 7 })];
  const win = async (bagBefore) => {
    const built = await buildEquip(
      t,
      await equipProject({
        items,
        mutate: (p) => {
          p.sprites.actors[0].battle = { ...p.sprites.actors[0].battle, drop: SWORD, dropPct: 100 };
        }
      })
    );
    const nes = boot(built.romPath);
    setBag(nes, bagBefore);
    startFight(nes);
    nes.cpu.mem[RAM.MON_HP] = 1;
    nes.cpu.mem[RAM.RNG] = 0x40; // a swing that lands (the ATK test's seed family); loop on miss below
    for (let i = 0; i < 60 && nes.cpu.mem[RAM.GAME_STATE] === ST_BATTLE; i++) {
      if (nes.cpu.mem[RAM.BT_PHASE] === BP_MENU) {
        nes.cpu.mem[RAM.MON_HP] = Math.min(nes.cpu.mem[RAM.MON_HP], 1);
        chooseCommand(nes, BC_FIGHT);
        tap(nes, A, 20);
      } else tap(nes, A, 12);
    }
    assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_GAMEPLAY, 'the fight never ended');
    return bag(nes);
  };
  assert.deepEqual(await win([0]), [0, SWORD], 'the piece dropped into the bag like any other item');
  const full = [0, 0, 0, 0, 0, 0, 0, 0];
  assert.deepEqual(await win(full), full, 'a full bag skips the drop and loses nothing');
});

test('E7: a worn piece is not carried (Carrying is false, Take cannot remove it), while the same piece in the bag is and can', opts, async (t) => {
  const items = [piece(1, 'Sword', WEAPON, { atk: 7 })];
  const events = (giveFirst) => ({
    pages: [
      {
        cond: { type: 'none', arg: 0 },
        commands: [
          ...(giveFirst ? [{ op: 'give', item: SWORD }] : []),
          { op: 'branch', cond: { type: 'hasItem', arg: SWORD }, then: [{ op: 'addVar', variable: 1, value: 1 }], else: [] },
          { op: 'take', item: SWORD },
          { op: 'branch', cond: { type: 'hasItem', arg: SWORD }, then: [{ op: 'addVar', variable: 2, value: 1 }], else: [] },
          { op: 'addVar', variable: 0, value: 1 }
        ]
      }
    ]
  });
  const run = async (start, giveFirst) => {
    const built = await buildEquip(
      t,
      await equipProject({
        items,
        start,
        mutate: (p) => {
          const screen = p.maps[p.project.startMap].screens[p.project.startScreen];
          screen.entities[0].props.trigger = 'enter';
          screen.entities[0].props.event = events(giveFirst);
        }
      })
    );
    const nes = boot(built.romPath);
    for (let i = 0; i < 60; i++) nes.frame();
    const v = (n) => nes.cpu.mem[0x500 + n]; // variables, engine/constants.asm
    return { carriedBefore: v(1), carriedAfter: v(2), ran: v(0), worn: pcEquip(nes)[eqIndex(0, WEAPON)], bag: bag(nes), atk: pcBonus(nes).atk[0] };
  };
  const worn = await run({ 0: [SWORD, null, null] }, false);
  assert.equal(worn.ran, 1, 'the event ran');
  assert.equal(worn.carriedBefore, 0, 'a worn Sword does not satisfy Carrying');
  assert.equal(worn.carriedAfter, 0);
  assert.equal(worn.worn, SWORD, 'and Take could not strip it from the member');
  assert.equal(worn.atk, 7, 'the bonus is intact');
  // Control: the identical event with the Sword given into the bag first -- Carrying is true, and Take removes it.
  const carried = await run({}, true);
  assert.equal(carried.carriedBefore, 1, 'a Sword in the bag is carried');
  assert.equal(carried.carriedAfter, 0, 'and Take removes it');
  assert.deepEqual(carried.bag, []);
});

test('poison does not touch the equipment: ids and bonuses are the same after a statused round', opts, async (t) => {
  const items = [piece(1, 'Sword', WEAPON, { atk: 7 })];
  const built = await buildEquip(t, await equipProject({ items, start: { 0: [SWORD, null, null] } }));
  const nes = boot(built.romPath);
  startFight(nes);
  nes.cpu.mem[RAM.MON_HP] = 255;
  nes.cpu.mem[RAM.PC_HP] = 200;
  nes.cpu.mem[RAM.PC_STATUS] = 1; // poisoned
  const before = { equip: pcEquip(nes), bonus: pcBonus(nes) };
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let i = 0; i < 12; i++) tap(nes, A, 12);
  assert.ok(nes.cpu.mem[RAM.PC_HP] < 200, 'the poison (or a hit) cost HP, so a statused round really ran');
  assert.deepEqual({ equip: pcEquip(nes), bonus: pcBonus(nes) }, before);
});
