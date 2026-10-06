// The dialogue-class scenes (coverage doc section 7): one landing per (box start residue, NT parity) class, with ONE enter talker on the landing
// screen, so the box opens at a camera the scene chose. The class is declared from arithmetic (the landing's camera, floored to 16 px by the
// dialogue's nudge) and required as a witness identity (`dlg:r=..:p=..` / `dlg:R0=..:p=..`), so a landing that produced another class fails coverage.
import { TYPING } from './ringscene.mjs';
import { startFor } from './ringsweep.mjs';
import { GEOM } from './ringwitness.mjs';
import { expectedCamera } from '../../lib/streamcamera.js';

export const DLG_N = 4;
/** Ring 1: r = 2k (k 0..15). Ring 2: R0 = (2j + 24) mod 30 (j 0..14). */
export const dialogueClasses = (ring) => (ring === 1 ? Array.from({ length: 16 }, (_, k) => ({ k })) : Array.from({ length: 15 }, (_, j) => ({ k: j }))).flatMap((c) => [0, 1].map((parity) => ({ ...c, parity })));
// (There is no Mesen subset: every class runs in both emulators -- see ringcampaign.mjs scenesFor.)
export const classLabel = (ring, { k, parity }) => (ring === 1 ? `r${2 * k}-p${parity}` : `R${(2 * k + 24) % 30}-p${parity}`);

/** The scene for one class; `fine` is the camera's pixel offset inside the floored 16 px (so the nudge really floors), chosen so the player stays on the screen. */
export function dialogueScene({ ring, k, parity }) {
  const g = GEOM[ring];
  const screenOfCam = parity === 1 ? 1 : 2; // camera screen: its parity is the NT parity
  const fine = ring === 1 ? 7 : (k === 7 ? 0 : 3);
  const camPos = screenOfCam * g.span + 16 * k + fine;
  const world = camPos + g.center;
  const start = startFor(ring, world);
  const cam = expectedCamera({ gridW: ring === 1 ? DLG_N : 1, gridH: ring === 1 ? 1 : DLG_N, col: ring === 1 ? start.screen : 0, row: ring === 1 ? 0 : start.screen, px: start.x, py: start.y });
  const camLo = ring === 1 ? cam.cam_x_lo : cam.cam_y_lo;
  if ((camLo >> 4) !== k) throw new Error(`dialogueScene: landing for k=${k} gives camera ${camLo}`);
  const nt = ring === 1 ? cam.cam_nt & 1 : (cam.cam_nt >> 1) & 1;
  if (nt !== parity) throw new Error(`dialogueScene: landing for parity ${parity} gives NT parity ${nt}`);
  const r0 = ring === 1 ? 2 * k : (2 * k + 24) % 30;
  const seam = ring === 1 ? r0 > 0 : r0 >= 25; // the box straddles the two live NTs
  const id = ring === 1 ? `dlg:r=${r0}:p=${parity}` : `dlg:R0=${r0}:p=${parity}`;
  return {
    steps: [{ op: 'boot' }, { op: 'check', label: 'seam-landing' }], start, world: { n: DLG_N, talkers: 'landing' }, classId: id,
    expect: {
      kind: 'seam', ring, n: DLG_N, screens: [start.screen], forward: 0, back: 0, holds: 0, liveNts: [], dialogues: 1, boxLiveNts: seam ? [0, 1] : [], boxSeam: seam,
      typing: TYPING, sequence: [{ t: 'dialogue', screen: start.screen }, { t: 'check', label: 'seam-landing' }], witnesses: [id]
    }
  };
}
