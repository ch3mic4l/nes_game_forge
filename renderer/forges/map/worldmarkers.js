// The Map Forge's World view, the data half: the markers that say what is on a screen of the whole world. Pure and DOM-free;
// imports shared/ only (it never imports eventlist.js or events.js, which import ui.js and cannot load under node:test).
//
// A marker is a *place*, a link is a *destination* (docs/design-world-overview.md, section 1). This slice (the first of two)
// builds the two markers the project itself names -- where the player starts and which screen is the title screen -- and
// returns the whole shape, with `links` empty, so the next slice adds doors, warps and events without changing a caller:
//
//   buildWorldMarkers(project) -> { start, title, markers, links, byScreen }
//   marker: { kind, flat, mapIndex, screenIndex, entityIndex|null, x, y, title, hasLinks }
//   byScreen: Map flat -> { markers: [...], out: [links], in: [links] }

import { LIMITS } from '../../../shared/project.js';

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

function addMarker(result, marker) {
  result.markers.push(marker);
  let entry = result.byScreen.get(marker.flat);
  if (!entry) {
    entry = { markers: [], out: [], in: [] };
    result.byScreen.set(marker.flat, entry);
  }
  entry.markers.push(marker);
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
  return result;
}
