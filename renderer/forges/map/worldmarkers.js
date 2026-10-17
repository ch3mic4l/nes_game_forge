// The Map Forge's World view, the data half: the markers that say what is on a screen of the whole world. Pure and DOM-free;
// imports shared/ only (it never imports eventlist.js or events.js, which import ui.js and cannot load under node:test).
//
// A marker is a *place*, a link is a *destination* (docs/design-world-overview.md, section 1): every placed actor yields at most
// one marker, every door actor and every `warp` command yields one link, so "50 warps from one cutscene actor" is one marker and
// fifty links. The markers are the start, the title screen, and the placed doors, events and (off by default) talkers:
//
//   buildWorldMarkers(project) -> { start, title, markers, links, byScreen }
//   marker: { kind, flat, mapIndex, screenIndex, entityIndex|null, x, y, title, hasLinks, ... }
//   link:   { kind, from: { flat, mapIndex, screenIndex, entityIndex, x, y }, to: { flat, mapIndex, screenIndex, x, y },
//             stored, dangling, compiled, via|null, self, source }
//   byScreen: Map flat -> { markers: [...], out: [links], in: [links] }
//
// This module is the single reader of "which screen does this stored reference mean": `doorTarget` is the door's, the warp
// commands' is the same clamp (`canonicalizeFlat`, the compiler's), and `eventlist.js` imports `doorTarget` for its own line.
// "Which fields hold a screen reference" is `remapScreenReferences`'s (shared/project.js), which this module may not edit
// around (the view is renderer-only); `referenceInventory` is the audited list of those fields on the read side, and
// test/unit/worldmarkers.test.js (M6) holds the two together and fails when either file they read changes.

import {
  LIMITS,
  CHOICE_LIMITS,
  DOOR_LANDING_DEFAULT,
  EVENT_TRIGGERS,
  canonicalizeFlat,
  commonEventId,
  resolveCommonEventIds,
  liveCommonEventIds,
  effectiveTrigger,
  entityLabel,
  screenLabel
} from '../../../shared/project.js';
import { allCommands, liveCommands, compiledPages, effectiveDialogue, projectEvents } from '../../../shared/eventrules.js';

/** How far into the 256 x 240 screen a 16 x 16 thing can start: the pixel the engine clamps a landing or a start to. */
const MAX_X = LIMITS.screenCols * 16 - 16;
const MAX_Y = LIMITS.screenRows * 16 - 16;
const clampPixel = (value, high) => Math.max(0, Math.min(high, Number.isFinite(value) ? Math.trunc(value) : 0));

/** `offsets[m]` is the flat index of map m's first screen: the numbering every door, warp and the compiler's start and title use. */
function flatOffsets(project) {
  const offsets = [];
  let total = 0;
  for (const map of project.maps) {
    offsets.push(total);
    total += map.screens.length;
  }
  return { offsets, total };
}

/** The `{ flat, mapIndex, screenIndex }` of a flat screen index, or null when the project has no such screen. */
function locate(project, offsets, flat) {
  for (let mapIndex = project.maps.length - 1; mapIndex >= 0; mapIndex--) {
    if (flat >= offsets[mapIndex]) {
      const screenIndex = flat - offsets[mapIndex];
      return screenIndex < project.maps[mapIndex].screens.length ? { flat, mapIndex, screenIndex } : null;
    }
  }
  return null;
}

/** A landing coordinate as the compiler clamps it (`byte(value, high)`, textcompile.js; doors normalize alike): 0..high, `fallback` when it is no number. */
function landing(value, high, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(high, Math.trunc(number))) : fallback;
}

/**
 * Where a stored flat screen number really goes. `canonicalizeFlat(stored, total)` is the compiler's clamp (generate.js holds a
 * door's target to the last screen, textcompile.js a warp's), so a number past the end resolves to the last screen and is
 * `dangling`; the link is drawn to the screen the ROM uses and never dropped. Null when the project has no screen at all.
 */
function resolveScreen(project, offsets, total, stored) {
  if (total === 0) return null;
  const number = Number(stored);
  const dangling = !(Number.isFinite(number) && number >= 0 && number < total);
  const resolved = canonicalizeFlat(Number.isFinite(number) ? number : 0, total);
  const where = locate(project, offsets, resolved);
  return where ? { ...where, dangling } : null;
}

/**
 * Where the door `entity` (placed on flat screen `flat`) leads: the single reading of a door's stored `toScreen`/`toX`/`toY`.
 * `eventlist.js` prints its line from this, so the search list and the World view can never disagree about a door.
 *   { stored, dangling, to: { flat, mapIndex, screenIndex, x, y } | null, label, rawX, rawY, self }
 * `label` is how the target reads in a menu, or `screen N` for a number the project has no screen for (the wording the list
 * has always used); `rawX`/`rawY` are the stored landing as typed, `to.x`/`to.y` the clamped one the ROM uses.
 */
export function doorTarget(project, flat, entity) {
  const { offsets, total } = flatOffsets(project);
  const props = entity?.props ?? {};
  const stored = props.toScreen ?? 0;
  const rawX = props.toX ?? DOOR_LANDING_DEFAULT;
  const rawY = props.toY ?? DOOR_LANDING_DEFAULT;
  const where = resolveScreen(project, offsets, total, stored);
  const dangling = where ? where.dangling : true;
  const to = where
    ? {
        flat: where.flat,
        mapIndex: where.mapIndex,
        screenIndex: where.screenIndex,
        x: landing(rawX, MAX_X, DOOR_LANDING_DEFAULT),
        y: landing(rawY, MAX_Y, DOOR_LANDING_DEFAULT)
      }
    : null;
  const label = dangling || !to ? `screen ${stored}` : screenLabel(project, to.mapIndex, to.screenIndex);
  return { stored, dangling, to, label, rawX, rawY, self: Boolean(to) && to.flat === flat };
}

/**
 * The audited list of stored screen references `remapScreenReferences` rewrites, read without rewriting: every placed
 * entity's `props.toScreen` (a door or not -- the remapper walks it unconditionally) and every `warp` command's `screen`
 * found by `allCommands` in every page of every event body, each common-event body once whether anything calls it or not.
 * `[{ kind: 'door' | 'warp', stored }]`. This is a different quantity from the links (which expand a `call` per caller): it
 * is what must stay equal to the remapper's reach, held by test/unit/worldmarkers.test.js (M6).
 */
export function referenceInventory(project) {
  const found = [];
  for (const map of project.maps) {
    for (const screen of map.screens) {
      for (const entity of screen.entities ?? []) found.push({ kind: 'door', stored: entity.props?.toScreen ?? 0 });
    }
  }
  for (const event of projectEvents(project)) {
    for (const page of event.pages ?? []) {
      for (const command of allCommands(page.commands)) if (command.op === 'warp') found.push({ kind: 'warp', stored: command.screen });
    }
  }
  return found;
}

function screenEntry(result, flat) {
  let entry = result.byScreen.get(flat);
  if (!entry) {
    entry = { markers: [], out: [], in: [] };
    result.byScreen.set(flat, entry);
  }
  return entry;
}

function addMarker(result, marker) {
  result.markers.push(marker);
  screenEntry(result, marker.flat).markers.push(marker);
}

/** A link is filed under the screen it leaves (`out`) and the screen it lands on (`in`); one that stays on its screen is in both. */
function addLink(result, link) {
  result.links.push(link);
  screenEntry(result, link.from.flat).out.push(link);
  screenEntry(result, link.to.flat).in.push(link);
}

/** What a placed actor's event body says about itself, worked out once per body: which of its commands compile, and which warp and call. */
function analyseBody(event) {
  const live = new Set();
  for (const page of compiledPages(event)) for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) live.add(command);
  const warps = [];
  const calls = [];
  for (const page of event?.pages ?? []) {
    for (const command of allCommands(page.commands)) {
      if (command.op === 'warp') warps.push(command);
      else if (command.op === 'call') calls.push({ command, id: commonEventId(command.event) });
    }
  }
  return { live, warps, calls };
}

/**
 * Every warp a root actor's event can make, with whether it compiles: its own body's, and those of the common events it
 * `call`s, reached as the compiler reaches them. A `call` resolves by `commonEventId` against the ids
 * `resolveCommonEventIds` gives each entry (textcompile.js does this for a live, unnormalized project) and a callee counts
 * only if `liveCommonEventIds` admits it. A command's local status is membership in the identity Set `liveCommands` yields
 * over `compiledPages` of its own body; the status of a warp is `p && local`, where `p` holds when every `call` on the path
 * is compiled. The expansion is a worklist of `(calleeId, p)`: an entry is skipped unless it improves what is recorded for that
 * id (not reached, or reached with false and now true), so a live path is never hidden by an earlier dead one and the order
 * cannot matter, and each id is visited at most twice, so a cycle ends. A warp's `compiled` is the OR over every path, and its
 * identity is (this root, the warp command). Returns `[{ command, compiled, via: { id, name } | null }]`.
 */
function rootWarps(event, calleeOf, liveIds, analyse) {
  const found = new Map();
  const note = (command, compiled, via) => {
    const prior = found.get(command);
    if (prior) prior.compiled = prior.compiled || compiled;
    else found.set(command, { command, compiled, via });
  };
  const root = analyse(event);
  for (const command of root.warps) note(command, root.live.has(command), null);
  const queue = root.calls.map(({ command, id }) => [id, root.live.has(command) && liveIds.has(id)]);
  const best = new Map();
  for (let next = 0; next < queue.length; next++) {
    const [id, ok] = queue[next];
    const callee = id === null ? null : calleeOf.get(id);
    if (!callee?.event) continue; // a missing target yields nothing
    const prior = best.get(id);
    if (prior === true || (prior === false && !ok)) continue; // not an improvement on what is recorded for this id
    best.set(id, ok);
    const body = analyse(callee.event);
    const via = { id, name: callee.name?.trim() || `Common event ${id}` };
    for (const command of body.warps) note(command, ok && body.live.has(command), via);
    for (const call of body.calls) queue.push([call.id, ok && body.live.has(call.command) && liveIds.has(call.id)]);
  }
  return [...found.values()];
}

const EVENT_TRIGGER_LABEL = Object.fromEntries(EVENT_TRIGGERS.map((entry) => [entry.id, entry.label]));
const squash = (text) => text.replace(/\s+/g, ' ');
const trimmedSays = (text) => `Says “${squash(text).slice(0, 60)}”`;

/** The markers and links of every placed actor, appended to `result` (door markers first, then events, then talkers, each in project order). */
function addActors(project, result, offsets, total) {
  const { ids } = resolveCommonEventIds(project.commonEvents, project.commonEventSeq);
  const calleeOf = new Map();
  (project.commonEvents ?? []).forEach((entry, index) => {
    if (!calleeOf.has(ids[index])) calleeOf.set(ids[index], entry);
  });
  const liveIds = liveCommonEventIds(project);
  const analysed = new Map();
  const analyse = (event) => {
    let known = analysed.get(event);
    if (!known) analysed.set(event, (known = analyseBody(event)));
    return known;
  };
  const lists = { door: [], event: [], talk: [] };
  let flat = 0;
  project.maps.forEach((map, mapIndex) => {
    map.screens.forEach((screen, screenIndex) => {
      (screen.entities ?? []).forEach((entity, entityIndex) => {
        const actor = project.sprites?.actors?.[entity.actorId];
        const label = entityLabel(project, entity);
        const x = clampPixel(entity.x, MAX_X);
        const y = clampPixel(entity.y, MAX_Y);
        const from = { flat, mapIndex, screenIndex, entityIndex, x, y };
        const marker = { flat, mapIndex, screenIndex, entityIndex, x, y, hasLinks: false, dangling: false };
        const links = [];
        const aim = (stored, rawX, rawY) => {
          const where = resolveScreen(project, offsets, total, stored);
          if (!where) return null;
          return { dangling: where.dangling, to: { flat: where.flat, mapIndex: where.mapIndex, screenIndex: where.screenIndex, x: landing(rawX, MAX_X, 0), y: landing(rawY, MAX_Y, 0) } };
        };
        const isDoor = actor?.behavior === 'door';
        const door = isDoor ? doorTarget(project, flat, entity) : null;
        if (door) {
          if (door.to) {
            links.push({ kind: 'door', from, to: door.to, stored: door.stored, dangling: door.dangling, compiled: true, via: null, self: door.self, source: label });
          }
        }
        const event = entity.props?.event;
        const pages = event?.pages?.length ?? 0;
        let warpCount = 0;
        if (pages > 0) {
          for (const { command, compiled, via } of rootWarps(event, calleeOf, liveIds, analyse)) {
            const aimed = aim(command.screen, command.x, command.y);
            if (!aimed) continue;
            warpCount++;
            links.push({ kind: 'warp', from, to: aimed.to, stored: command.screen, dangling: aimed.dangling, compiled, via, self: aimed.to.flat === flat, source: label });
          }
        }
        marker.hasLinks = links.length > 0;
        marker.dangling = links.some((link) => link.dangling);
        const says = pages > 0 ? effectiveDialogue(entity) : '';
        if (door) {
          marker.kind = 'door';
          marker.title = door.to
            ? door.dangling
              ? `${label} — Door points at screen ${door.stored} but the project has ${total}; the ROM goes to ${screenLabel(project, door.to.mapIndex, door.to.screenIndex)}, lands at ${door.to.x},${door.to.y}`
              : `${label} — Door → ${door.label}, lands at ${door.to.x},${door.to.y}`
            : `${label} — Door with nowhere to go`;
        } else if (pages > 0) {
          const compiled = compiledPages(event).length > 0;
          marker.kind = 'event';
          marker.trigger = effectiveTrigger(entity, actor, project);
          marker.compiled = compiled;
          marker.says = compiled ? '' : says;
          marker.pages = pages;
          const warps = warpCount ? `, ${warpCount} warp${warpCount === 1 ? '' : 's'}` : '';
          const state = compiled ? 'compiled' : `switched off${says ? `; says “${squash(says).slice(0, 60)}” instead` : ''}`;
          marker.title = `${label} — ${EVENT_TRIGGER_LABEL[marker.trigger] ?? marker.trigger}, ${pages} page${pages === 1 ? '' : 's'}${warps}, ${state}`;
        } else {
          const talk = effectiveDialogue(entity);
          if (talk === '') return; // nothing to mark: a pickup, a patroller, an actor with no event and nothing to say
          marker.kind = 'talk';
          marker.title = `${label} — ${trimmedSays(talk)}`;
        }
        lists[marker.kind].push(marker);
        for (const link of links) addLink(result, link);
      });
      flat++;
    });
  });
  for (const kind of ['door', 'event', 'talk']) for (const marker of lists[kind]) addMarker(result, marker);
}

/**
 * The tooltip line for a link, from the project as it stands: `Door ‘Cellar door’ → Castle · Throne room at 112,112`, a warp
 * says who makes it and, through a common event, which one; a target the project has no screen for says where the ROM goes.
 */
export function describeLink(project, link) {
  const total = project.maps.reduce((sum, map) => sum + map.screens.length, 0);
  const where = screenLabel(project, link.to.mapIndex, link.to.screenIndex);
  const what =
    link.kind === 'door' ? `Door ‘${link.source}’` : `Warp from ‘${link.source}’${link.via ? ` (via common event ‘${link.via.name}’)` : ''}`;
  const target = link.dangling ? `screen ${link.stored} — the project has ${total}; the ROM goes to ${where}` : where;
  return `${what} → ${target} at ${link.to.x},${link.to.y}`;
}

/**
 * Every marker of the project. Reads `project` and writes nothing to it. The start is `startMap` / `startScreen` (map-space)
 * resolved to the flat index the compiler uses, at the pixel `startX,startY` clamped into the cell; the title is the screen
 * `titleMap` / `titleScreen` name, only when `titleMap !== null`, and is drawn at the screen's top-left. A start or title
 * that names a screen the project does not have has no marker, never a wrong one.
 */
export function buildWorldMarkers(project) {
  const result = { start: null, title: null, markers: [], links: [], byScreen: new Map() };
  const { offsets, total } = flatOffsets(project);
  const { startMap, startScreen, startX, startY, titleMap, titleScreen } = project.project;

  if (Number.isInteger(startMap) && startMap >= 0 && startMap < project.maps.length) {
    const where = locate(project, offsets, offsets[startMap] + (Number.isInteger(startScreen) ? startScreen : 0));
    if (where && where.mapIndex === startMap) {
      const x = clampPixel(startX, MAX_X);
      const y = clampPixel(startY, MAX_Y);
      result.start = {
        kind: 'start',
        ...where,
        entityIndex: null,
        x,
        y,
        title: `Start — ${project.maps[where.mapIndex].name} · screen ${where.screenIndex}, at ${x},${y}`,
        hasLinks: false
      };
      addMarker(result, result.start);
    }
  }

  if (titleMap !== null && titleMap !== undefined && Number.isInteger(titleMap) && titleMap >= 0 && titleMap < project.maps.length) {
    // the compiler's own resolution (main/build/generate.js, titleFlat): map base + titleScreen, held to the last screen of the project
    const flat = Math.min(offsets[titleMap] + (Number.isInteger(titleScreen) ? titleScreen : 0), total - 1);
    const where = locate(project, offsets, flat);
    if (where) {
      result.title = {
        kind: 'title',
        ...where,
        entityIndex: null,
        x: 0,
        y: 0,
        title: 'Title screen',
        hasLinks: false
      };
      addMarker(result, result.title);
    }
  }
  addActors(project, result, offsets, total);
  return result;
}
