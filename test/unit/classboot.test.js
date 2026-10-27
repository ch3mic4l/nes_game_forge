// Build-time classes, slice C2 (ROADMAP item 5 remainder; handoff-next/classes-bc/design.md sec 6 "Headless ROM identity", last sentence): the
// classed ROM BOOTED. test/unit/classidentity.test.js reads the generated .inc tables and compares ROM images; neither shows what the engine
// reads out of the assembled bytes. Here the real ROM runs in the vendored jsnes core and the engine's own routines answer:
//
//   * `party_join` and `party_restore` (Continue's re-derivation) write pc_hp_max / pc_mp_max / pc_spells from the assembled pc_*_at /
//     pc_spells_at rows (bank-aware: the battle bank is switched in by the engine's own switch_prg_bank); `combatant_atk/def/mag/mdef` read
//     the other four. A post-assembly patch of a table, or a table that was written but not assembled where the engine looks, fails here.
//   * the Equip screen's pick list (`eq_open_list`, which tests `eq_who`) shows a class-masked piece to the right classes only.
//
// Every expectation is the case family's hand-written intent (test/lib/classcases.js), never read from shared/. Addresses are engine RAM
// names taken from the build's symbol file, each checked against the value engine/constants.asm gives. Variants live in mkdtemp directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_BASES,
  CASE_BOARDS,
  GATE_SCENARIOS,
  buildCase,
  classedTwin,
  learnedRow,
  statOracle
} from '../lib/classcases.js';
import { boot, buildEquip, call, selectBattleBank } from '../lib/equipharness.js';
import { BUTTON, BP, R, ST, screenFor } from '../lib/equipscreen.js';

// engine RAM, from engine/constants.asm (a test that read the file under test would prove nothing)
const ADDR = { pc_hp_max: 0x039c, pc_mp_max: 0x03a4, pc_level: 0x03a8, pc_in_party: 0x03b4, pc_spells: 0x03b8 };

/** The address of an engine RAM name: the build's symbol when it has one (and it must agree), else the constants.asm value. */
const ram = (built, name) => {
  const symbol = built.symbols[name];
  if (symbol !== undefined) assert.equal(symbol, ADDR[name], `${name}: the symbol file and engine/constants.asm agree`);
  return ADDR[name];
};

const LEVELS = (maxLevel) => [1, 5, maxLevel];
const caseFor = (board, scenario = GATE_SCENARIOS[1]) => buildCase(CASE_BASES[0], board, scenario);

for (const board of CASE_BOARDS) {
  test(`${board.name}: the engine's own party_join and party_restore derive the CLASS stats and spells from the assembled tables`, async (t) => {
    // Catches a table the engine does not actually read the intended bytes from (a post-assembly patch, a wrong label, a wrong bank), a class
    // stat or spell list that exists in the .inc and not in the ROM, and a join that reads the member's own list while Continue reads the
    // class's (the two must agree: spells are never saved, always re-derived).
    const c = await caseFor(board);
    for (const key of ['resolved', 'swapped', 'remasked']) { // `fallback` cannot be built: the build gate refuses a profile-less assigned class
      const built = await buildEquip(t, classedTwin(c, key));
      const nes = boot(built.romPath);
      selectBattleBank(nes, built);
      const mem = nes.cpu.mem;
      const [hpMax, mpMax, level, inParty, spells] = ['pc_hp_max', 'pc_mp_max', 'pc_level', 'pc_in_party', 'pc_spells'].map((name) => ram(built, name));
      const intent = c.intent[key];
      const gates = { mag: built.symbols.combatant_mag !== undefined, mdef: built.symbols.combatant_mdef !== undefined };
      assert.deepEqual(gates, { mag: true, mdef: false }, `${c.tag} [${key}]: the class-only-MAG scenario assembles combatant_mag and not combatant_mdef`);
      const check = (m, L, how) => {
        const where = `${c.tag} [${key}] ${how}: member ${m} at level ${L}`;
        assert.equal(mem[hpMax + m], statOracle(intent[m].growth.hp, L), `${where}: pc_hp_max`);
        assert.equal(mem[mpMax + m], statOracle(intent[m].growth.mp, L), `${where}: pc_mp_max`);
        assert.equal(mem[spells + m], learnedRow(c.slotOf, intent[m].spells, c.maxLevel)[L - 1], `${where}: pc_spells`);
        for (const [stat, label] of [['atk', 'combatant_atk'], ['def', 'combatant_def'], ['mag', 'combatant_mag']]) {
          assert.equal(call(nes, built, label, { a: m }).a, statOracle(intent[m].growth[stat], L), `${where}: ${label} (pc_${stat}_at)`);
        }
      };
      for (const L of LEVELS(c.maxLevel)) {
        // a recruit at level L (party_join -> party_apply_level)
        for (let m = 0; m < intent.length; m++) {
          mem[level + m] = L;
          mem[inParty + m] = 0;
          mem[hpMax + m] = mem[mpMax + m] = 0;
          mem[spells + m] = 0xff;
          call(nes, built, 'party_join', { x: m });
          check(m, L, 'party_join');
        }
        // Continue: poisoned RAM re-derived from the restored levels
        for (let m = 0; m < intent.length; m++) { mem[hpMax + m] = 0x55; mem[mpMax + m] = 0x55; mem[spells + m] = 0xff; }
        call(nes, built, 'party_restore');
        for (let m = 0; m < intent.length; m++) check(m, L, 'party_restore');
      }
    }
  });

  test(`${board.name}: the Equip pick list shows a class-masked piece to the classes that may wear it and hides it from the others`, async (t) => {
    // Catches eq_who still holding raw usableBy (the engine would list Blade for the Mage and Rod for the Warrior), a class mask applied to the
    // classless wearers (members 2 and 3 see every piece their member bit names), and a mask read as the wrong class's bit (swapped).
    const c = await caseFor(board, GATE_SCENARIOS[0]);
    for (const key of ['resolved', 'swapped', 'remasked']) {
      const project = classedTwin(c, key);
      project.input.states.gameplay.SELECT = 'equip';
      const screen = await screenFor(t, project);
      screen.boot();
      screen.recruit(0, 1, 2, 3);
      screen.setBag(c.pieceIds);
      screen.frames(3);
      screen.openFromGameplay();
      assert.equal(screen.state, ST.BATTLE, `${c.tag} [${key}]: Equip opened`);
      const lists = [[], [], [], []]; // lists[member][slot]: Blade is the weapon (slot 0), Guard the armour (1), Rod the accessory (2)
      for (let m = 0; m < 4; m++) {
        assert.equal(screen.mem[R.BT_ACTOR], m, `${c.tag} [${key}]: the screen is on member ${m}`);
        const seen = new Set();
        for (let step = 0; step < 3; step++) {
          const slot = screen.mem[R.EQ_CUR_SLOT];
          seen.add(slot);
          screen.tap(BUTTON.A, 4);
          assert.equal(screen.phase, BP.EQ_LIST, `${c.tag} [${key}]: member ${m} slot ${slot}: the list opened`);
          const listed = Array.from(screen.mem.slice(R.BT_LIST, R.BT_LIST + screen.mem[R.BT_LEN]));
          const want = c.pieceIds.filter((_, i) => i === slot && c.wearers[key][c.pieceNames[i]].includes(m));
          lists[m][slot] = listed;
          assert.deepEqual(listed, want, `${c.tag} [${key}]: member ${m} slot ${slot}: the pick list`);
          screen.tap(BUTTON.B, 4);
          assert.equal(screen.phase, BP.EQ_SLOTS, `${c.tag} [${key}]: back on the slot rows`);
          screen.tap(BUTTON.DOWN, 3);
        }
        assert.deepEqual([...seen].sort(), [0, 1, 2], `${c.tag} [${key}]: member ${m}: all three slots were listed`);
        if (m < 3) screen.tap(BUTTON.RIGHT, 4);
      }
      if (key === 'resolved') { // the headline case, named: the piece masked to class 0 is absent from class 1 and the reverse
        const [blade, , rod] = c.pieceIds;
        assert.deepEqual([lists[0][0], lists[1][0], lists[2][0]], [[blade], [], [blade]], 'Blade (class 0 only): the Warrior and the classless member 2 see it, the Mage does not');
        assert.deepEqual([lists[0][2], lists[1][2], lists[2][2]], [[], [rod], [rod]], 'Rod (class 1 only): the Mage and the classless member 2 see it, the Warrior does not');
      }
    }
  });
}
