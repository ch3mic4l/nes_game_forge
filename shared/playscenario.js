// Turning a chosen test scenario into a description, and a description back
// into something to run — ROADMAP item 3's "Reload the ROM while keeping the
// selected test scenario". Kept free of DOM/Node APIs, the same reasoning
// testoverrides.js and testplay.js already give for that split.
//
// The scenario is a description, not a reference: "the map named World,
// screen 5" and "the actors currently named Slime, Slime, Bat", resolved
// fresh against whatever project is in hand at the moment it matters, never
// a cached numeric id or a cached label. A screen or an actor's numeric
// position is not its identity — createScreen()'s own comment in
// shared/project.js already says so for screens ("the number is where it
// sits in the map and changes when the map is resized, so storing it would
// leave a name that quietly lies"), and sprites.js renumbers every actor
// after the one it deletes for the identical reason. Following a name is
// defined behaviour, including when the name has moved to a different actor
// or screen since it was chosen: two actors both currently named "Slime" is
// the one case with no defined answer, and that refuses rather than guesses.
//
// describePlayScenario runs once, at the moment a scenario is chosen,
// against the project as it stands then. resolveStartAt/resolveFormation run
// later, against whatever project the ROM actually being reloaded was built
// from — see renderer/forges/build/build.js's reload coordinator for why
// that has to be the build's own returned project, not a second, possibly
// since-edited read of the live one.

import { flatScreens, screenLabel } from './project.js';

/**
 * Map Forge's own raw `{startAt, battleTest}` — a flat screen index, a pixel
 * position, and numeric actor ids — into the name/position description the
 * scenario record stores. No label survives here: everything a control shows
 * later is rendered from a fresh `resolveStartAt`/`resolveFormation` result,
 * never from a string frozen at the moment this ran.
 *
 * @param {{startAt?: {screen: number, x: number, y: number}, battleTest?: {formation: number[]}}} options
 * @param {object} project
 */
export function describePlayScenario({ startAt = null, battleTest = null } = {}, project) {
  return {
    startAt: startAt ? describeStartAt(startAt, project) : null,
    battleTest: battleTest ? describeBattleTest(battleTest, project) : null
  };
}

function describeStartAt({ screen, x, y }, project) {
  const flat = flatScreens(project)[screen];
  if (!flat) return null;
  return { mapName: flat.map.name, screenIndex: flat.screenIndex, screenName: flat.screen.name, x, y };
}

function describeBattleTest({ formation }, project) {
  return { formation: (formation ?? []).map((id) => project.sprites.actors[id]?.name ?? null) };
}

/** Every current map named `name`, as `{map, index}` pairs. */
function mapsNamed(project, name) {
  return project.maps.map((map, index) => ({ map, index })).filter((entry) => entry.map.name === name);
}

/** Every current screen in `map` named `name`, as `{screen, index}` pairs. */
function screensNamed(map, name) {
  return map.screens.map((screen, index) => ({ screen, index })).filter((entry) => entry.screen.name === name);
}

/**
 * Resolve a remembered start description against the current `project`.
 * `{ok: true, value: {screen, x, y, label} | null}` on success (`value` is
 * `null` only when nothing was remembered at all), `{ok: false, reason}`
 * when the description no longer resolves to exactly one thing.
 */
export function resolveStartAt(remembered, project) {
  if (!remembered) return { ok: true, value: null };
  const { mapName, screenIndex, screenName, x, y } = remembered;

  const maps = mapsNamed(project, mapName);
  if (maps.length === 0) return { ok: false, reason: `no map is named "${mapName}" anymore` };
  if (maps.length > 1) return { ok: false, reason: `more than one map is named "${mapName}"` };
  const { map, index: mapIndex } = maps[0];

  let resolvedScreenIndex;
  if (screenName) {
    const screens = screensNamed(map, screenName);
    if (screens.length === 0) {
      return { ok: false, reason: `"${mapName}" no longer has a screen named "${screenName}"` };
    }
    if (screens.length > 1) {
      return { ok: false, reason: `more than one screen in "${mapName}" is named "${screenName}"` };
    }
    resolvedScreenIndex = screens[0].index;
  } else {
    // An unnamed screen has no identity but its position — see this file's
    // own header — so the only question is whether that position still
    // exists in the map's *current* shape, not whether the screen sitting
    // there is provably the one that was there before.
    if (screenIndex >= map.screens.length) {
      return { ok: false, reason: `"${mapName}" no longer has a screen at position ${screenIndex}` };
    }
    resolvedScreenIndex = screenIndex;
  }

  const screen = flatScreens(project).findIndex(
    (entry) => entry.mapIndex === mapIndex && entry.screenIndex === resolvedScreenIndex
  );
  return { ok: true, value: { screen, x, y, label: screenLabel(project, mapIndex, resolvedScreenIndex) } };
}

/**
 * Resolve a remembered formation against the current `project`. Every named
 * actor must resolve to exactly one current actor or the whole formation
 * refuses — a partial fight silently substituting whatever sits at a stale
 * id is exactly the failure this exists to prevent, so nothing here ever
 * returns fewer names resolved than were asked for.
 */
export function resolveFormation(remembered, project) {
  if (!remembered) return { ok: true, value: null };
  const ids = [];
  const names = [];
  for (const name of remembered.formation) {
    const matches = project.sprites.actors
      .map((actor, index) => ({ actor, index }))
      .filter((entry) => entry.actor.name === name);
    if (matches.length === 0) return { ok: false, reason: `no actor is named "${name}" anymore` };
    if (matches.length > 1) return { ok: false, reason: `more than one actor is named "${name}"` };
    ids.push(matches[0].index);
    names.push(name);
  }
  return { ok: true, value: { formation: ids, label: names.join(' + ') } };
}
