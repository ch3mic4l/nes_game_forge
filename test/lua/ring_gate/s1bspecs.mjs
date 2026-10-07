// Phase 3b S1b: the witness SPEC list (leaf module, no imports of the gate, so the harness fingerprint and the matrix read one declaration).
// `noSeam` = the spec teleports the player (a Warp), so its screen changes are landings, not crossings, and are not seam-decoded (S1a certifies a landing's VRAM).
// A spec = one scripted scene measured in Mesen (G + counters) and jsnes (counters + the seam decode). `kind` 'manifest' runs a sw_manifest scenario
// (test/lua/run_sw_manifest.mjs SCENARIOS), 'move' a scripted-Move scene (test/lua/run_sw_move_manifest.mjs measureMove). `provides` = the classes /
// paths the spec is the witness of (the judge requires them from the union of the specs that ran).
import { populations } from '../run_sw_move_manifest.mjs';

const axisKey = (ring) => (ring.ring === 1 ? 'right' : 'down');
/** Phases of the world-end walk: hold the ring axis for 900 bodies from the start screen (n-4): the last screen's far wall is reached and pushed against. */
export const edgePhases = (ring) => [{ name: 'boot', waitFor: 'gameplay' }, { name: 'edge', frames: 900, held: { [axisKey(ring)]: true }, collect: true }];

export const SPECS = [
  { name: 'walk', kind: 'manifest', scenario: 'walk', desc: 'eight actors, Right/Down walk across two target screens: C1, C2, C3a, C3b (action), the RPG contact battle (C0, live battle)' },
  // the arm/touch alignment sweep: the touch Shake+Flash+Sfx npc moved 1..7 px along the ring axis, so the 3-body touch window slides across every phase of the
  // 8 px arm schedule (one arm per tile column/row) -- the least-favourable coincidence of the arm with the touch, and of the arm with each cross/probe alignment
  ...[1, 2, 3, 4, 5, 6, 7].map((k) => ({ name: `touch+${k}`, kind: 'manifest', scenario: 'walk', flashAt: (ring) => (ring.ring === 1 ? [40 + k, 120] : [120, 40 + k]), desc: `walk with the touch npc ${k} px along the ring axis (arm / touch / probe alignment sweep)` })),
  { name: 'say', kind: 'manifest', scenario: 'say', desc: 'touch Flash + Say while a strip drains: C4a with a strip in flight' },
  { name: 'stand', kind: 'manifest', scenario: 'stand', desc: 'standing rows: C1s, M3/M6 Flash, menu and dialog frozen frames' },
  { name: 'edge', kind: 'manifest', phases: edgePhases, desc: 'walk into the last screen\'s far wall: the off-grid probe path (no bank switch)' },
  { name: 'heavy', kind: 'manifest', scenario: 'walk', sizes: populations(15)['many-small'], anim: 'P1', desc: '15 tiles on the screen (the STREAM_TILE_BOUND), every actor on its largest pose advancing every body (animation frames), the far +-128 metasprite straddling' },
  // a Warp event is the one action-ring way into a forced-blank redraw mid-game (RPG: the battle entry): C0, witnessed by the observed $2001 blank + draw + restore
  { name: 'warp', noSeam: true, kind: 'manifest', scenario: 'walk', phases: (ring) => [{ name: 'boot', waitFor: 'gameplay' }, { name: 'pre', frames: 95, held: { down: true } }, { name: 'walkR', frames: 200, held: ring.ring === 1 ? { right: true, down: true } : { right: true, down: true }, collect: true }],
    flashCmds: (ring) => [{ op: 'warp', screen: ring.n - 4, x: 120, y: 120 }, { op: 'say', text: 'Back.' }], desc: 'touch event = Warp back to the start screen: the forced-blank redraw (C0) with its $2001 evidence' },
  { name: 'chase', ringExtra: { chaserDamage: 1 }, kind: 'manifest', scenario: 'walk', sizes: populations(15)['many-small'], anim: 'P1', desc: 'the eight-actor walk with DAMAGING chasers (damage 1): contact damage -> action knockback with every entity, Shake + Flash + Sfx and the strip arm live in one body' },
  { name: 'heavy14', kind: 'manifest', scenario: 'walk', sizes: populations(14)['many-small'], anim: 'P1', bound: true, desc: '14 tiles on the screen, a project with a bound tile (STREAM_TILE_BOUND_WITH_BOUND_TILES = 14): the same heaviest walk' },
  { name: 'mv-say', kind: 'move', lead: 'none', tail: 'say', touchY: 150, desc: 'scripted Move across the next seam, then a Say: C4b (probes + camera + arm + the seam crossing), C4c final handoff' },
  { name: 'mv-lead', kind: 'move', lead: 'say', tail: 'none', touchY: 150, desc: 'Say, then the Move: the close-for-Move handoff (C4c) before C4b' },
  { name: 'mv-flash', kind: 'move', lead: 'flash', tail: 'say', touchY: 150, desc: 'Flash lead + Move: the Flash packet coincides with the Move frames' },
  { name: 'mv-wait', kind: 'move', touchY: 150, script: (ring) => ({ cmds: [{ op: 'wait', frames: 30 }, { op: 'move', who: 'player', dir: axisKey(ring), dist: 100 }, { op: 'wait', frames: 40 }, { op: 'say', text: 'Done.' }], presses: [], frames: 400 }), desc: 'Wait, Move, Wait, Say: the nonterminal Wait (wait_tick with no move_tick)' }
];
// row 7's DISTINGUISHABLE-terrain seams (round 2 finding 5): the same walk and the same scripted Move on a ring whose every block's metatile is a function of (screen, col, row), so the decoder can compare
// every viewport block's tiles and attribute against the project's own record around each crossing. `terrain` is the spec's own marker; the scene flag is ringExtra.terrain.
SPECS.push(
  { name: 'seam-walk', kind: 'manifest', scenario: 'walk', ringExtra: { terrain: true }, terrain: true, desc: 'the walk across the seams on a distinguishable-terrain ring: viewport terrain + attributes decoded around every ownership crossing' },
  { name: 'seam-move', kind: 'move', lead: 'none', tail: 'say', touchY: 150, ringExtra: { terrain: true }, terrain: true, desc: 'the scripted Move across the next seam on a distinguishable-terrain ring: Move scroll (one frame behind) and viewport terrain + attributes decoded around the crossing' }
);
export const SPEC_NAMES = SPECS.map((s) => s.name);
