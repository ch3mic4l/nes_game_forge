// The Shake scene (coverage doc section 8, item C4): a REAL horizontal Shake event on a horizontal-mirroring (ring 2: Y scrolls) cell. A touch NPC's
// event is `Shake 40`; the player walks into it, the recorders release once shake_left > 0 and record every quiet frame of the shake (kind
// 'shake-frame': live NTs judged against the oracle, camera registers against the camera rule, the displayed select against the camera's NT up to
// the mirroring alias). Two NPCs: one at window parity 0 (camera NT 0: PPUCTRL alternates 0/1) and one at parity 1 (camera NT 2: 2/3). After each, a
// `sw:shake-after` check (PPUCTRL exactly the camera's NT again) and a short walk with a `sw:shake-stream` check (ordinary streaming resumed).
//
// Stated limitation: PPUCTRL bit 0 is the *selected nametable*; under horizontal mirroring $2400/$2C00 alias $2000/$2800, so the select 1/3 shows
// the same live NT as 0/2. The gate observes the select (a PPUCTRL write) and the live NT bytes, never the canonical address a PPU fetch resolves
// (no PPU write/fetch trace here): a canonical-address claim stays unverified.
import { TYPING } from './ringscene.mjs';
import { GEOM, windowBlock, requiredWitnesses } from './ringwitness.mjs';
import { startFor } from './ringsweep.mjs';

export const SHAKE_N = 6;
export const SHAKE_FRAMES = 40;

export function shakeScene({ ring }) {
  if (ring !== 2) throw new Error('the Shake scene is a horizontal-mirroring (ring 2) scene');
  const g = GEOM[ring];
  const n = SHAKE_N;
  const Wf = (b) => (b + g.K) * 16 + g.center;
  // NPC world positions: window block ~6 (parity 0) and ~20 (parity 1)
  const npcs = [Wf(6) + 8, Wf(20) + 8];
  const steps = [{ op: 'boot' }, { op: 'check', label: 'sw:land' }];
  const sequence = [{ t: 'check', label: 'sw:land' }];
  npcs.forEach((w, k) => {
    steps.push({ op: 'shake', btn: g.fwd, axis: g.axis, max: 1500, label: `k${k}` });
    steps.push({ op: 'check', label: `sw:shake-after:k${k}` });
    steps.push({ op: 'hold', btn: g.fwd, axis: g.axis, gte: w + 48, max: 400 });
    steps.push({ op: 'check', label: `sw:shake-stream:k${k}` });
    sequence.push({ t: 'hold', label: `hold:shake:k${k}` }, { t: 'check', label: `sw:shake-after:k${k}` }, { t: 'hold', label: `hold:${g.fwd}:${w + 48}` }, { t: 'check', label: `sw:shake-stream:k${k}` });
  });
  const world = {
    n, talkers: 'none',
    mutate: (project) => {
      const map = project.maps[0];
      project.sprites.actors.push({ name: 'Quake', behavior: 'npc', hp: 1, damage: 0 });
      const actorId = project.sprites.actors.length - 1;
      for (const w of npcs) {
        const screen = Math.floor(w / g.span), local = w % g.span;
        map.screens[screen].entities.push({ actorId, x: 120, y: local, props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'shake', frames: SHAKE_FRAMES }] }] } } });
      }
    }
  };
  void windowBlock;
  const extra = [0, 1, 2, 3].map((k) => `shake:ppuctrl=${k}`);
  extra.push('shake-restored:cam_nt=0', 'shake-restored:cam_nt=2', 'shake-stream:cam_nt=0', 'shake-stream:cam_nt=2');
  return {
    steps, start: startFor(ring, g.center), world,
    expect: {
      kind: 'shake', ring, n, holds: steps.filter((s) => ['hold', 'shake'].includes(s.op)).length, walls: [], dialogues: 0, boxLiveNts: [], boxSeam: false,
      typing: TYPING, sequence, witnesses: requiredWitnesses({ ring, n, extra })
    }
  };
}
