// The Map Forge's streamed-map decisions, kept out of map.js so node:test can pin them.
//
// Pure and DOM-free; imports shared/ only. It decides -- map.js draws and commits:
//   * the Streamed checkbox's state and what turning it on or off does (`streamToggleState`,
//     `planStreamOn`, `planStreamOff`, `applyStreamOn`, `applyStreamOff`);
//   * the size fields' per-axis limit, which axis is the dead one on a two-nametable board, and the
//     clamp (`sizePlan`, `clampAxis`);
//   * the refuse-before-commit preflight a resize runs (`planResize`);
//   * whether Duplicate screen can grow a map in place, and what its picker says (`hasDuplicateRoom`,
//     `duplicateFullMessage`).
//
// It restates no rule shared/ owns. The limits are `mapGridLimit`, the live axis is `streamRingMode`,
// and every refusal sentence is validateProject's or streamedGridProblems' own: a candidate edit is
// applied to a clone and any error validateProject reports that the live project did not already have
// is the reason ("new" is by rule, not by prose: `ruleKey`). A plan is made BEFORE `store.commit`, never
// inside it: commit records an undo entry and sets dirty even when its mutator does nothing, so a refusal
// handled inside it is a phantom edit (docs/design-streamed-worlds-phase4.md).

import {
  mapGridLimit,
  growOrShrinkMap,
  streamedGridProblems,
  streamedBoardProblems,
  validateProject
} from '../../../shared/project.js';
import { mirroringById, resolveMapper, streamCapable, streamRingMode } from '../../../shared/cartridge.js';

const board = (project) => ({
  mapper: resolveMapper(project.cartridge.mapper),
  mirroringId: project.cartridge.mirroring
});

/** Every error validateProject reports: `{ severity, where, message }` -- that is all a problem carries. */
export const errorProblems = (project) => validateProject(project).filter((problem) => problem.severity === 'error');

/** The same errors as message strings. */
export const errorMessages = (project) => errorProblems(project).map((problem) => problem.message);

// validateProject's problems have no rule id, code or kind: `where` (a Forge name) and `message` are all there is,
// and a counted rule speaks in a different GRAMMAR as its count changes ("2 Give item / Take item commands do not
// name a real item" becomes "1 Give item / Take item command do not ..."; "has"/"have", "is"/"are", "backs ... item"
// / "back ... item each"). So a rule's identity here is its `where` plus its words with the count, the number
// inflection and punctuation taken out -- never the message string. A name in double quotes is kept verbatim
// (digits and case included, as the project's names are case-sensitive): a different map failing the same rule is a
// different instance, not the same one speaking.
const IRREGULAR = { has: 'have', is: 'be', are: 'be', does: 'do' };
const SILENT = new Set(['each']);
const foldWord = (word) => IRREGULAR[word] ?? (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

/** A rule's identity: stable across the count changing, and across the grammatical number that follows it. */
export function ruleKey(problem) {
  const words = problem.message.split(/("[^"]*")/).flatMap((part, i) =>
    i % 2 === 1
      ? [part]
      : (part.toLowerCase().match(/[a-z]+/g) ?? []).map(foldWord).filter((word) => !SILENT.has(word))
  );
  return problem.where + '|' + words.join(' ');
}

/**
 * The problems in `after` that `before` did not already have: one for one by `ruleKey`, so an edit that keeps or
 * lowers a violation of a rule the project already failed ("holds 271 screens" -> "holds 272"; 2 -> 1 commands) is
 * not new, a rule that was not failing is, and so is a second instance of one (a second map, a second screen).
 */
export function newErrors(before, after) {
  const known = new Map();
  for (const problem of before) known.set(ruleKey(problem), (known.get(ruleKey(problem)) ?? 0) + 1);
  const fresh = [];
  for (const problem of after) {
    const key = ruleKey(problem);
    const left = known.get(key) ?? 0;
    if (left > 0) known.set(key, left - 1);
    else fresh.push(problem);
  }
  return fresh;
}

/**
 * Why this board cannot stream a world, in streamedBoardProblems' own words: that function is run on
 * a one-map synthetic project (the same shape growOrShrinkMap's own guard uses), so no clone of the
 * whole project is needed just to draw the checkbox.
 */
function boardRefusal(project, mapIndex) {
  const synthetic = {
    cartridge: project.cartridge,
    project: project.project,
    maps: [{ ...project.maps[mapIndex], streamed: true }]
  };
  const problems = streamedBoardProblems(synthetic);
  return (problems.find((problem) => problem.kind === 'capability') ?? problems[0])?.message ?? null;
}

/**
 * The Streamed checkbox for one map. Always `visible`: a streamed map must stay clearable even after
 * the Build panel moved the board somewhere it cannot stream (otherwise nothing in the UI could clear
 * the flag), and an ordinary map on such a board shows the box disabled with the reason.
 *   { visible, checked, enabled, reason, note }
 * `reason` explains a disabled box; `note` is the red-Build-summary context for a streamed map that
 * the board no longer carries.
 */
export function streamToggleState(project, mapIndex) {
  const map = project.maps[mapIndex];
  const { mapper, mirroringId } = board(project);
  const capable = streamCapable(mapper, mirroringId);
  if (map.streamed === true) {
    return { visible: true, checked: true, enabled: true, reason: null, note: capable ? null : boardRefusal(project, mapIndex) };
  }
  if (capable) return { visible: true, checked: false, enabled: true, reason: null, note: null };
  return { visible: true, checked: false, enabled: false, reason: boardRefusal(project, mapIndex), note: null };
}

/**
 * Turning Streamed ON: refused, with nothing to commit, when the flag adds any validateProject error
 * (a dead-axis shape, a board that cannot stream, the camera off, bound tiles...). `message` is the
 * first new one. The caller decides before `store.commit`.
 */
export function planStreamOn(project, mapIndex) {
  const candidate = structuredClone(project);
  candidate.maps[mapIndex].streamed = true;
  const fresh = newErrors(errorProblems(project), errorProblems(candidate));
  return fresh.length ? { ok: false, message: fresh[0].message } : { ok: true };
}

/**
 * Turning Streamed OFF: refused when either axis exceeds the ordinary per-axis limit. Per axis, not by
 * area: 16 x 1 has an area of 16 and normalizeProject would still clamp it to 4 x 1 on the next load,
 * silently dropping 12 screens.
 */
export function planStreamOff(project, mapIndex) {
  const map = project.maps[mapIndex];
  const limit = mapGridLimit({});
  if (map.gridW > limit || map.gridH > limit) {
    return {
      ok: false,
      message:
        `"${map.name}" is ${map.gridW} × ${map.gridH} screens, and an ordinary map holds at most ${limit} × ${limit}. ` +
        `Shrink it to ${limit} screens or fewer along each side before turning Streamed off.`
    };
  }
  return { ok: true };
}

/** The mutator for an allowed turn-on: the flag alone (normalizeMap supplies the rest on load). */
export function applyStreamOn(project, mapIndex) {
  project.maps[mapIndex].streamed = true;
}

/**
 * The mutator for an allowed turn-off. The keys are deleted, never set false: normalizeMap writes
 * `streamed` and `fillMetatileId` only for a streamed map, so a stored `streamed: false` would be
 * silently dropped on the next save and rewrite a fixture, and the map's JSON must equal an ordinary
 * map's.
 */
export function applyStreamOff(project, mapIndex) {
  const map = project.maps[mapIndex];
  delete map.streamed;
  delete map.fillMetatileId;
}

/**
 * The size fields for one map: per axis `{ max, locked, reason }`. `max` is the map's own ceiling
 * (`mapGridLimit`). On a two-nametable board a streamed map has one dead axis, which must be 1:
 * vertical mirroring scrolls sideways (a row: height is dead), horizontal mirroring scrolls up and
 * down (a column: width is dead) -- `streamRingMode` answers it (1 = X ring, 2 = Y ring, 0 = both axes
 * live or not streamable). The dead axis's max is 1, and its field is locked once it is 1; a dead axis
 * already above 1 (the Build panel moved the board under the map) stays editable so it can be set
 * back to 1.
 */
export function sizePlan(project, mapIndex) {
  const map = project.maps[mapIndex];
  const limit = mapGridLimit(map);
  const plan = { width: { max: limit, locked: false, reason: null }, height: { max: limit, locked: false, reason: null }, deadAxis: null };
  if (map.streamed !== true) return plan;
  const { mapper, mirroringId } = board(project);
  const mode = streamRingMode(mapper, mirroringId);
  if (mode === 0) return plan;
  const deadAxis = mode === 1 ? 'height' : 'width';
  const scrolls = mode === 1 ? 'sideways, so a streamed map is one row' : 'up and down, so a streamed map is one column';
  plan.deadAxis = deadAxis;
  plan[deadAxis].max = 1;
  plan[deadAxis].locked = (deadAxis === 'width' ? map.gridW : map.gridH) <= 1;
  plan[deadAxis].reason = `${mapper.name} with ${mirroringById(mirroringId).label.toLowerCase()} mirroring scrolls ${scrolls}.`;
  return plan;
}

/** A typed size, kept to the field's own range; anything that is not a number leaves the size alone. */
export function clampAxis(plan, axis, typed, current) {
  const n = Number(typed);
  if (!Number.isFinite(n)) return current;
  return Math.max(1, Math.min(plan[axis].max, Math.round(n)));
}

/**
 * A resize, decided before `store.commit`. `{ ok: true, noop: true }` for an unchanged size: nothing to commit.
 * In a project with no streamed map the resize is what it was before the Map Forge knew streamed maps: always
 * allowed, whatever the new screens add to validateProject (a damaging metatile 0 on a new screen turns combat
 * and the message font on, which can introduce a Tile Forge error) -- no rule of a streamed world is in play.
 * In a project that holds one (resizing any of its maps, an ordinary one beside it included) the candidate runs
 * on a clone: growOrShrinkMap's own refusal (null: a streamed map's per-map grid rules, worded by
 * streamedGridProblems) or any validateProject error the live project did not already have (the project-wide
 * 255-screen total, the dead axis) refuses it.
 */
export function planResize(project, mapIndex, newWidth, newHeight) {
  const map = project.maps[mapIndex];
  if (newWidth === map.gridW && newHeight === map.gridH) return { ok: true, noop: true };
  if (!project.maps.some((other) => other.streamed === true)) return { ok: true, noop: false };
  const before = errorProblems(project);
  const candidate = structuredClone(project);
  if (growOrShrinkMap(candidate, mapIndex, newWidth, newHeight) === null) {
    // The same question growOrShrinkMap asked, for the words (it returns null without any).
    const [problem] = streamedGridProblems({ maps: [{ name: map.name, streamed: true, gridW: newWidth, gridH: newHeight }] });
    return { ok: false, message: problem?.message ?? 'That size is not allowed for a streamed map.' };
  }
  const fresh = newErrors(before, errorProblems(candidate));
  return fresh.length ? { ok: false, message: fresh[0].message } : { ok: true, noop: false };
}

/**
 * The one way a planned edit reaches the store: a refused plan, or an unchanged size, never calls
 * `store.commit` (which would record an undo entry and set dirty for an edit that did not happen).
 * Returns whether it committed.
 */
export function commitIfAllowed(store, plan, label, mutate) {
  if (!plan.ok || plan.noop) return false;
  store.commit(label, mutate);
  return true;
}

/** What the settings panel says when the project changed while a resize was waiting on its confirmation. */
export const STALE_RESIZE_NOTE = 'The project changed while the confirmation was open, so the resize was cancelled. Try it again.';

/**
 * `commitIfAllowed` behind an optional confirmation (`confirm`: null when none is needed, else a function
 * returning a promise of the answer). The plan was made against the project as it stood when this is called, and
 * Undo/Redo stay reachable while a dialog is open, so the Store's revision is read BEFORE the wait and compared
 * after it: if it moved, the answer was given about a project that no longer exists and nothing is committed (not
 * re-planned either: the user approved a different project). Returns 'committed', 'cancelled' (the dialog said
 * no), 'stale' (the project changed during the dialog) or 'refused' (the plan itself did not allow a commit).
 */
export async function commitAfterConfirm(store, plan, label, mutate, confirm) {
  const revision = store.revision;
  if (confirm && !(await confirm())) return 'cancelled';
  if (store.revision !== revision) return 'stale';
  return commitIfAllowed(store, plan, label, mutate) ? 'committed' : 'refused';
}

/**
 * Can Duplicate screen grow this map in place? A streamed map has no in-place room: it is sized with
 * the size fields, and growing it a screen at a time would choose an axis (the core's growthTarget
 * knows nothing of the live one). The picker's candidate filter asks this too, so the two never
 * disagree.
 */
export function hasDuplicateRoom(map) {
  return map.streamed !== true && map.gridW * map.gridH < mapGridLimit(map) ** 2;
}

/** The first line of Duplicate screen's "pick another map" modal, for a source map with no room. */
export function duplicateFullMessage(map) {
  if (map.streamed === true) {
    return `"${map.name}" is a streamed map, which is sized with the size fields rather than grown a screen at a time. Pick another map with room:`;
  }
  const limit = mapGridLimit(map);
  return `"${map.name}" is already full (${limit}×${limit} screens). Pick another map with room:`;
}
