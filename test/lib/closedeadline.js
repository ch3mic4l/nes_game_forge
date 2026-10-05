// The project behind the three-producer close deadline check (test/lua/build_sw_close_deadline_roms.mjs and
// test/unit/streamclosedeadline.test.js): a streamed RPG world whose only talker stands where the camera is mid-scroll (so the
// close's first terrain row publishes as TWO packets across the nametable seam), plus the two other producers the worst frame needs:
// an ordinary map carrying one switch-bound tile (BOUND_TILE_ENABLED, so flip_tick is assembled) and a Flash command on a second
// NPC (FLASH_ENABLED, so flash_tick is). The talker's event is one Say and nothing after it: the close that follows the last
// page is the frame the check measures.
import { createStreamedProject } from './streamedproject.js';
import { flattenScreens } from '../../main/build/generate.js';
import { createMap, createScreen } from '../../shared/project.js';
import { buildPinching, OBSERVER_SCREEN, OBSERVER_X, OBSERVER_Y } from './streamedpinching.js';

export const TALKER_X = 200;
export const TALKER_Y = 112;
export const TALKER_SCREEN_IN_GRID = 3; // map row 1, column 0 -- cam_x = 200 - 128 = 72 there, so rows straddle the seam
export const BOUND_SWITCH = 5;

/** `gridH`/`talkerScreen` move the talker down a taller world: the close's terrain reads were once O(row), so a deep talker is the slow case. */
export function buildCloseDeadlineProject({ gameType = 'rpg', gridH = 2, talkerScreen = TALKER_SCREEN_IN_GRID } = {}) {
  const p = createStreamedProject({ gameType, mixed: true, gridW: 3, gridH });
  const [before, streamed] = p.maps;
  if (p.party?.[0]) p.party[0].renamable = false;
  p.metatiles[1].tiles = [5, 6, 7, 8];
  before.screens[0].boundTiles = [{ switchId: BOUND_SWITCH, row: 0, col: 0, metatileId: 1 }];
  const talker = p.sprites.actors.length;
  p.sprites.actors.push({ name: 'Talker', behavior: 'npc', hp: 1, damage: 0 });
  const flasher = p.sprites.actors.length;
  p.sprites.actors.push({ name: 'Flasher', behavior: 'npc', hp: 1, damage: 0 });
  const screen = streamed.screens[talkerScreen];
  screen.entities = screen.entities ?? [];
  screen.entities.push({
    actorId: talker,
    x: TALKER_X,
    y: TALKER_Y,
    props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hello there, traveler.' }] }] } }
  });
  // far from the talker, never reached: it exists so the Flash command is in the project
  screen.entities.push({
    actorId: flasher,
    x: 40,
    y: 40,
    props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }] }] } }
  });
  const { mapBase } = flattenScreens(p);
  p.project.startScreen = mapBase[1] + talkerScreen;
  p.project.startX = TALKER_X;
  p.project.startY = TALKER_Y;
  return p;
}

/**
 * The banked placement's twin: the committed-inventory project (its dialogue code relocates into the battle bank), its Observer cut
 * down to one Say, one other talker's event given a Flash, and an ordinary map after the streamed one carrying the bound tile.
 * Whether this still builds is the point -- the caller asserts it.
 */
export function buildCloseDeadlineBanked() {
  const { project: p, slot } = buildPinching('nosave');
  const screen = p.maps[0].screens[OBSERVER_SCREEN];
  screen.entities[slot].props.event.pages[0].commands = [{ op: 'say', text: 'Hello there, traveler.' }];
  const other = p.maps[0].screens[0].entities.find((e) => e.props?.event?.pages?.[0]?.commands?.[0]?.op === 'say');
  other.props.event.pages[0].commands.push({ op: 'flash' });
  const after = createMap(p.maps.length, 'After');
  after.screens = [createScreen()];
  after.screens[0].boundTiles = [{ switchId: BOUND_SWITCH, row: 0, col: 0, metatileId: 1 }];
  p.maps.push(after);
  p.party[0].renamable = false;
  p.project.startX = OBSERVER_X;
  p.project.startY = OBSERVER_Y;
  return p;
}
