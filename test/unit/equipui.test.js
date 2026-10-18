// Equipment (ROADMAP item 5), build commit C4: the parts of the Equip screen that are not the ROM -- the unbound-Equip warning, the Controller
// Forge's label, and the two advice paths (docs/design-equipment.md sections 8, 9 and test rows 4 and 15). Nothing here needs nesasm.
// Each test names the wrong implementation it catches.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_MAPPERS } from '../../shared/cartridge.js';
import {
  ACTIONS,
  createPartyMember,
  createProject,
  projectWithoutEquipment,
  projectWithoutEquipmentMag,
  projectWithoutEquipmentMdef,
  validateProject
} from '../../shared/project.js';
import { battleShortfallAdvice, battleRegionBytes } from '../../main/build/battletables.js';
import { checkCapacity } from '../../main/build/generate.js';
import { actionDetail } from '../../renderer/forges/controller/controller.js';
import { gearProject, piece, plain, WEAPON, ARMOR, ACCESSORY } from '../lib/equipscreen.js';

const mapperOf = (id) => SUPPORTED_MAPPERS.find((entry) => entry.id === id);
const problemsOf = (project, rule) => validateProject(project).filter((problem) => problem.rule === rule);
const identity = ({ severity, where, rule, subject, counts }) => ({ severity, where, rule, subject, counts });

/** An RPG with four members, items 0 Potion, 1 Sword, 2 Mail, 3 Ring; `bind` puts `equip` in the named state/button (or nowhere). */
function rpg(bind) {
  const project = createProject('Equip', 'rpg');
  project.party = [0, 1, 2, 3].map((id) => createPartyMember(id));
  project.items = [plain(0, 'Potion', { kind: 'heal', amount: 20 }), piece(1, 'Sword', WEAPON, { atk: 5 }), piece(2, 'Mail', ARMOR, { def: 4 }), piece(3, 'Ring', ACCESSORY, { mdef: 2 })];
  for (const row of Object.values(project.input.states)) for (const button of Object.keys(row)) if (row[button] === 'equip') row[button] = 'none';
  if (bind) project.input.states[bind.state][bind.button] = 'equip';
  return project;
}

// ----------------------------------------------------------------------------------------------------- row 4: the unbound-equip warning

test('unbound equip: equipment exists and nothing opens Equip -> one warning with its rule, subject and the piece count', () => {
  // Catches a warning without an id (the diagnostics ids test), a count that is not the number of pieces, and wording that names no Forge.
  const found = problemsOf(rpg(), 'equip-unbound');
  assert.deepEqual(found.map(identity), [{ severity: 'warning', where: 'Controller Forge', rule: 'equip-unbound', subject: {}, counts: [3] }]);
  assert.match(found[0].message, /3 items are equipment, but no button opens the Equip screen/);
  assert.match(found[0].message, /Gameplay or Menu row of the Controller Forge/);
  const one = rpg();
  one.items.length = 2;
  assert.deepEqual(problemsOf(one, 'equip-unbound').map((p) => p.counts), [[1]], 'the count follows the number of pieces');
  assert.match(problemsOf(one, 'equip-unbound')[0].message, /^1 item is equipment, but no button/);
});

test('unbound equip is quiet with a binding in Gameplay or in the Menu row, and quiet with no equipment', () => {
  // Catches a warning that ignores an existing binding (sabotage 10), one that wants BOTH states bound, and one that fires on a game with
  // nothing to wear.
  for (const bind of [{ state: 'gameplay', button: 'SELECT' }, { state: 'menu', button: 'B' }, { state: 'gameplay', button: 'A' }]) {
    assert.deepEqual(problemsOf(rpg(bind), 'equip-unbound'), [], `${bind.state} ${bind.button}`);
  }
  const noGear = rpg();
  noGear.items = noGear.items.map((item) => ({ ...item, equip: null }));
  assert.deepEqual(problemsOf(noGear, 'equip-unbound'), [], 'no piece, nothing to open');
});

test('unbound equip: a binding in a state where the action is ignored does not count', () => {
  // The engine opens Equip from play and from the bag only (do_action_equip refuses the rest), so a button bound in the dialogue, title, game-over,
  // battle or name-entry row opens nothing. Catches a check that scans every state.
  for (const state of ['dialog', 'title', 'gameover', 'battle', 'nameentry']) {
    const project = rpg({ state, button: 'SELECT' });
    assert.equal(problemsOf(project, 'equip-unbound').length, 1, `${state} row`);
  }
});

test('unbound equip never fires on an action game (its own equip-ignored-action-game warning does)', () => {
  const project = createProject('Act', 'action');
  project.items = [piece(0, 'Sword', WEAPON, { atk: 5 })];
  assert.deepEqual(problemsOf(project, 'equip-unbound'), []);
});

// ----------------------------------------------------------------------------------------------------- the Controller Forge

test('Controller Forge: `equip` is in the action list; described in every state of an RPG with equipment, "ignored here" elsewhere', () => {
  // Catches an action missing from the picker, an RPG-with-gear row that says "ignored", an action game that describes a screen it will never open,
  // and an equipment-free RPG that offers a working-looking binding. `null` is what the Controller Forge draws as IGNORED.
  assert.equal(ACTIONS.find((action) => action.id === 'equip')?.label, 'Equip screen');
  const states = ['gameplay', 'menu', 'dialog', 'title', 'gameover', 'battle', 'nameentry'];
  const withGear = rpg();
  assert.equal(typeof actionDetail(withGear, 'equip', 'gameplay'), 'string');
  assert.equal(typeof actionDetail(withGear, 'equip', 'menu'), 'string');
  for (const state of states.slice(2)) assert.equal(actionDetail(withGear, 'equip', state), null, `${state}: the engine ignores it`);
  const noGear = rpg();
  noGear.items = noGear.items.map((item) => ({ ...item, equip: null }));
  for (const state of states) assert.equal(actionDetail(noGear, 'equip', state), null, `equipment-free RPG, ${state}`);
  const action = createProject('Act', 'action');
  action.items = [piece(0, 'Sword', WEAPON, { atk: 5 })];
  for (const state of states) assert.equal(actionDetail(action, 'equip', state), null, `action game, ${state}`);
  // The label is only for `equip`: another action keeps its text in the same project.
  assert.equal(typeof actionDetail(withGear, 'pause', 'gameplay'), 'string');
});

// ----------------------------------------------------------------------------------------------------- the banked-region advice

test('battleShortfallAdvice names the Items Forge for equipment and the Magic fields only while a piece sets them', async () => {
  // Catches advice that offers a lever which frees nothing (it checks recomputed bytes), one that never names the Items Forge, and a Magic term
  // offered for a game whose pieces carry no Magic / Magic defence.
  const mapper = mapperOf(1);
  const project = await gearProject({ mapper: 1 }); // Mail has MDEF 2, Ring has MAG 3
  const snapshot = structuredClone(project);
  const budget = battleRegionBytes(project, mapper);
  const freedAll = budget - battleRegionBytes(projectWithoutEquipment(project), mapper);
  assert.ok(freedAll > 1000, 'the whole feature frees its core');
  // What each Magic term really frees (the 25-byte allowance plus its item columns) decides which lever a deficit reaches.
  const magFreed = budget - battleRegionBytes(projectWithoutEquipmentMag(project), mapper);
  const mdefFreed = budget - battleRegionBytes(projectWithoutEquipmentMdef(project), mapper);
  assert.ok(magFreed >= 25 && mdefFreed >= 25 && magFreed < freedAll && mdefFreed < freedAll, `MAG ${magFreed}, MDEF ${mdefFreed}, whole ${freedAll}`);
  const small = battleShortfallAdvice(project, mapper, Math.min(magFreed, mdefFreed));
  assert.match(small, /removing every equipment piece in the Items Forge/);
  assert.match(small, /the Magic field of every equipment piece in the Items Forge/, 'MAG alone frees enough');
  assert.match(small, /the Magic defence field of every equipment piece in the Items Forge/, 'so does MDEF');
  const large = battleShortfallAdvice(project, mapper, Math.max(magFreed, mdefFreed) + 1);
  assert.match(large, /removing every equipment piece in the Items Forge/);
  assert.doesNotMatch(large, /Magic field of every/, 'one byte more than the MAG term frees');
  assert.doesNotMatch(large, /Magic defence field of every/);
  assert.deepEqual(project, snapshot, 'the advisor does not mutate the project');
  // A game whose pieces set only ATK / DEF is never told about the Magic fields.
  const plainGear = await gearProject({ mapper: 1, mutate: (p) => p.items.forEach((item) => item.equip && Object.assign(item.equip, { mag: 0, mdef: 0 })) });
  const none = battleShortfallAdvice(plainGear, mapper, 20);
  assert.match(none, /removing every equipment piece in the Items Forge/);
  assert.doesNotMatch(none, /Magic field|Magic defence field/);
  // No equipment, no equipment term.
  const bare = await gearProject({ mapper: 1, mutate: (p) => p.items.forEach((item) => (item.equip = null)) });
  assert.doesNotMatch(battleShortfallAdvice(bare, mapper, 20), /equipment/);
  // An overridden battle system: the byte model is not the truth, so no banked-feature removal is offered at all.
  assert.doesNotMatch(battleShortfallAdvice(project, mapper, 20, { exact: false }), /equipment piece/);
});

// ----------------------------------------------------------------------------------------------------- the kernel-lo shortfall line

/** The first number of padded screens at which the equipment project's kernel-lo lookup tables overflow, and that refusal's message. */
async function kernelRefusal(mapperId) {
  const base = await gearProject({ mapper: mapperId });
  for (let extra = 0; extra < 400; extra += 5) {
    const project = structuredClone(base);
    for (let i = 0; i < extra; i++) project.maps[0].screens.push(structuredClone(project.maps[0].screens[0]));
    const problem = checkCapacity(project).problems.find((entry) => entry.rule === 'kernel-lo-tables-over');
    if (problem) return { project, problem };
  }
  throw new Error(`no kernel-lo refusal on board ${mapperId}`);
}

test('the kernel-lo refusal of an equipment project says what the equipment costs, and offers a board only where one closes the gap', async () => {
  // Catches a line that gives a wrong cost (it is occupancy with and without the pieces, so it moves with the kernel allowance), a line that
  // appears for an equipment-free project, and the board clause shown where no board exists (the C1 wording rule: never tell an author to choose
  // something that does not exist). MMC3 and UNROM 512 have MMC1 to move to; MMC1 itself has nothing roomier.
  for (const [mapperId, hasBoard] of [[4, true], [30, true], [1, false]]) {
    const { project, problem } = await kernelRefusal(mapperId);
    const name = mapperOf(mapperId).name;
    assert.match(problem.message, / Equipment costs 30 bytes of the program kernel; remove equipment pieces in the Items Forge/, name);
    assert.equal(/, or choose a board with more room in the Build panel\.$/.test(problem.message), hasBoard, `${name}: the board clause`);
    if (!hasBoard) assert.match(problem.message, /Items Forge\.$/, `${name}: the line ends without the clause`);
    // The same world with its pieces made ordinary items: the refusal (if any) carries no equipment line.
    const bare = projectWithoutEquipment(project);
    const bareProblem = checkCapacity(bare).problems.find((entry) => entry.rule === 'kernel-lo-tables-over');
    if (bareProblem) assert.doesNotMatch(bareProblem.message, /Equipment costs/, `${name}: equipment-free`);
  }
});
