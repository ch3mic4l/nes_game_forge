// The redraw (d) entry-path scenes (coverage doc section 6): each drives one REAL entry into sw_render_window -- the position-jump guard, a door
// warp, an RPG battle return -- at every physical window origin c0 = b mod P (all P values: every NT parity, every local block residue 0..15 / 0..14),
// at nonzero origins, then walks on to show ordinary streaming resumed. Calling the renderer directly is never a witness.
//   guard   the live window origin is displaced by a lag >= 6 blocks (the one injected quantity: no ordinary play desyncs that far); the
//           guard's own detection, forced blank and redraw are the entry. Every b is reached by a real walk.
//   warp    a touch-triggered Doorway entity per landing, each warping to the next landing; the player walks into it.
//   battle  a monster per target b; the player walks into it and fights (A) until the world is back (RPG only). Each monster stands in a PLANNED entity
//           slot (0, 4, 5 or 7, rotating by screen; inert decoy NPCs fill the slots between, on a lane the player never walks), and the recorder
//           reads bt_from_ent on the frame the battle begins: a contact from any other slot fails.
//   continue  a Save NPC per target b; the player walks into it (a real Save), the machine is power-cycled, Continue from the title.
//   land    (landScene below) the Continue origins no walk can plant a Save on at will: the player STARTS at a chosen screen and local y (224, 225,
//           239 on the scrolling axis of a horizontal ring), an `enter` Save fires on landing, the power cycle and Continue follow.
// Targets: forward pass b = 2,4,..,P (c0 = even values, 0 at b = P); backward pass odd c0 at b = c0 (guard) or b = 2P' + c0 (battle).
import { TYPING } from './ringscene.mjs';
import { GEOM, bmaxOf, windowBlock, requiredWitnesses } from './ringwitness.mjs';
import { startFor } from './ringsweep.mjs';
import { createMap } from '../../../shared/project.js';

const posOf = (ring, world) => {
  const g = GEOM[ring];
  return ring === 1 ? { col: Math.floor(world / g.span), row: 0, px: world % g.span, py: 120 } : { col: 0, row: Math.floor(world / g.span), px: 120, py: world % g.span };
};
export const REDRAW_N = { guard: 6, warp: 8, battle: 10, continue: 10 };
/** The entity slots an RPG battle scene plants its monsters in: the first, the last four-slot boundary pair and the last (bt_from_ent 0, 4, 5, 7). */
export const BATTLE_SLOTS = [0, 4, 5, 7];
/** The monster/door touch offset (world px, ahead of the first pixel of a window block) the battle plan uses: calibrated, then pinned by the witnesses. */
export const TOUCH = 15;

export function redrawScene({ ring, entry, battery = false }) {
  const g = GEOM[ring];
  const n = REDRAW_N[entry];
  const bmax = bmaxOf(ring, n);
  const Wf = (b) => (b + g.K) * 16 + g.center;
  const Wb = (b) => Wf(b) + 15;
  const planned = (w) => windowBlock({ ring, n, ...posOf(ring, w) });
  const evens = Array.from({ length: g.P / 2 }, (_, i) => 2 * (i + 1)); // 2..P: c0 = 2..P-2 and 0
  const odds = Array.from({ length: g.P / 2 }, (_, i) => 2 * i + 1); // 1..P-1
  const steps = [...(entry === 'continue' ? [{ op: 'title' }] : []), { op: 'boot' }, { op: 'check', label: 'sw:land' }];
  const arrivals = [];
  const extra = [];
  const hold = (dir, w) => steps.push(dir === 'fwd' ? { op: 'hold', btn: g.fwd, axis: g.axis, gte: w, max: 1500 } : { op: 'hold', btn: g.back, axis: g.axis, lte: w, max: 1500 });
  const redrawCheck = (b, dir) => { steps.push({ op: 'check', label: `sw:redraw:${entry}:b=${b}:${dir}` }); extra.push(`redraw:${entry}:c0=${b % g.P}:${dir}`); };
  const streamCheck = (b, dir) => { steps.push({ op: 'check', label: `sw:stream:${entry}:b=${b}:${dir}` }); extra.push(`stream:${entry}:c0=${b % g.P}:${dir}`); };
  const world = { n, talkers: 'none' };
  let start = startFor(ring, g.center);

  if (entry === 'guard') {
    // forward pass over the even c0, backward pass over the odd c0: each target is walked to for real, the lag injected there
    const inject = (b, i) => {
      let dc = (i % 2 === 0 ? 1 : -1) * 6;
      if (b + dc < 0 || b + dc > bmax) dc = -dc;
      steps.push({ op: 'lag', axis: g.axis, dc, target: dc > 0 ? `+${dc}` : `${dc}` });
    };
    evens.forEach((b, i) => {
      if (planned(Wf(b)) !== b) throw new Error(`guard: forward target ${b} gives window ${planned(Wf(b))}`);
      hold('fwd', Wf(b)); inject(b, i); redrawCheck(b, 'fwd');
      hold('fwd', Wf(b) + 20); streamCheck(b, 'fwd');
    });
    odds.slice().reverse().forEach((b, i) => {
      if (planned(Wb(b)) !== b) throw new Error(`guard: backward target ${b} gives window ${planned(Wb(b))}`);
      hold('back', Wb(b)); inject(b, i); redrawCheck(b, 'back');
      hold('back', Wb(b) - 20); streamCheck(b, 'back');
    });
  } else if (entry === 'warp') {
    // The start is a throwaway landing at the world's origin; a door there warps to the first real landing, every landing has a door to the next.
    // Landings are ordered so consecutive ones are far apart (the jump is unmistakable); half land on the first pixel of their block, half on the
    // last (fine residue 0 / 15).
    // c0 -> b = c0 + P*m with m cycling 0,1,2 (m >= 1 for c0 = 0: nonzero origin): the doors spread over the screens (<= 8 entities each)
    const order = [];
    for (let i = 0; i < g.P / 2; i++) order.push(i, i + g.P / 2);
    // a landing's position along the axis must be standable (local 0..span-16: the engine clamps a warp's x/y to the screen's playable range), so
    // a block whose preferred pixel is outside it lands on its nearest standable pixel; the window is unchanged (every pixel of a block shares it)
    const lim = g.span - 16;
    const standable = (w) => w % g.span <= lim;
    const land = order.map((c0, i) => {
      const m = c0 === 0 ? 1 : i % 3;
      const b = c0 + g.P * m;
      const prefer = i % 2 === 0 ? 0 : 15;
      let f = prefer;
      if (!standable(Wf(b) + f)) f = [...Array(16).keys()].find((k) => standable(Wf(b) + k)) ?? -1;
      if (f < 0) throw new Error(`warp: block ${b} has no standable pixel`);
      return { b, w: Wf(b) + f };
    });
    // lanes: landings sorted by position take lanes round-robin (same-lane landings are >= 6 blocks apart), so no door or landing is within
    // touching distance of another landing's lane
    const lanes = [32, 68, 104, 140, 176, 212];
    [...land].sort((p, q) => p.b - q.b).forEach((l, rank) => { l.lane = lanes[rank % lanes.length]; });
    for (const l of land) {
      if (planned(l.w) !== l.b) throw new Error(`warp: landing ${l.b} gives window ${planned(l.w)}`);
      l.dir = (l.w % g.span) + 56 <= lim - 4 ? 'fwd' : 'back';
      l.doorW = l.dir === 'fwd' ? l.w + 56 : l.w - 56;
    }
    const doors = [{ w: g.center + 56, lane: 120, to: land[0] }, ...land.slice(0, -1).map((l, i) => ({ w: l.doorW, lane: l.lane, to: land[i + 1] }))];
    const approach = [{ dir: 'fwd' }, ...land.slice(0, -1)];
    doors.forEach((d, i) => {
      steps.push({ op: 'jumpwait', btn: approach[i].dir === 'fwd' ? g.fwd : g.back, axis: g.axis, max: 400, target: `w${i}` });
      redrawCheck(d.to.b, d.to.dir);
      hold(d.to.dir, d.to.dir === 'fwd' ? d.to.w + 20 : d.to.w - 20);
      streamCheck(d.to.b, d.to.dir);
    });
    const placeOf = (w) => ({ screen: Math.floor(w / g.span), local: w % g.span });
    world.mutate = (project) => {
      const map = project.maps[0];
      project.sprites.actors.push({ name: 'Door', behavior: 'npc', hp: 1, damage: 0 });
      const actorId = project.sprites.actors.length - 1;
      for (const d of doors) {
        const at = placeOf(d.w), to = placeOf(d.to.w);
        const ent = ring === 1 ? { x: at.local, y: d.lane } : { x: d.lane, y: at.local };
        const dest = ring === 1 ? { x: to.local, y: d.to.lane } : { x: d.to.lane, y: to.local };
        map.screens[at.screen].entities.push({ actorId, ...ent, props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: to.screen, ...dest }] }] } } });
      }
      for (const [s, sc] of map.screens.entries()) if (sc.entities.length > 8) throw new Error(`warp scene: screen ${s} carries ${sc.entities.length} entities (limit 8)`);
    };
  } else if (entry === 'battle' || entry === 'continue') {
    // Monsters touched by the player (the real encounter), or Save NPCs. A battle scene carries at most BATTLE_SLOTS.length monsters per screen (each in its
    // own planned slot, decoys between); a continue scene at most 5 entities. The 16 / 15 targets of each pass are spread over four b ranges
    // [r + P*m] (m = 0..3), a few per range. Forward lane = the player's own; the back lane is 64 px away on the dead axis.
    // Every target r (c0 = r mod P) is planted at the window origin b = r + P*m for a chosen m; a depth-first search over m (smallest first) finds the
    // first assignment with at most `limit` targets on any screen and every b below the last window (a forward target at the clamped last window
    // b = (N-2)*S cannot stream any further, so its stream:<entry> witness would be unobservable).
    // Continue at local y > MAX_Y (224) is legal since 5138c1f (a streamed screen's player_y up to 239), so every origin is reachable by a real walk-and-Save,
    // c0 = 0 and c0 = 15 of a Y-scrolling ring included (their windows lie wholly at y >= 224); landScene below plants the same Saves by a start position.
    const limit = entry === 'battle' ? BATTLE_SLOTS.length : 5;
    const maxB = (REDRAW_N.battle - 2) * g.S;
    const targets = [...evens.map((r) => ({ r, lane: 0, dir: 'fwd' })), ...odds.map((r) => ({ r, lane: 1, dir: 'back' }))];
    const screenOf = (t, m) => Math.floor((t.dir === 'fwd' ? Wf(t.r + g.P * m) + TOUCH : Wb(t.r + g.P * m) - TOUCH) / g.span);
    const count = new Map();
    const choice = [];
    const dfs = (i) => {
      if (i === targets.length) return true;
      const t = targets[i];
      for (let m = 0; t.r + g.P * m < maxB; m++) {
        const sc = screenOf(t, m);
        if ((count.get(sc) ?? 0) >= limit) continue;
        count.set(sc, (count.get(sc) ?? 0) + 1); choice[i] = m;
        if (dfs(i + 1)) return true;
        count.set(sc, count.get(sc) - 1);
      }
      return false;
    };
    if (!dfs(0)) throw new Error(`${entry} scene: no assignment keeps every screen within its monster/entity limit`);
    const placed = targets.map((t, i) => ({ lane: t.lane, b: t.r + g.P * choice[i], dir: t.dir }));
    for (const t of placed) t.w = t.dir === 'fwd' ? Wf(t.b) + TOUCH : Wb(t.b) - TOUCH;
    const plan = { fwdT: placed.filter((t) => t.dir === 'fwd').sort((p, q) => p.b - q.b), backT: placed.filter((t) => t.dir === 'back').sort((p, q) => q.b - p.b) };
    // planned entity slots: per screen the monsters (in walking order along the axis) take BATTLE_SLOTS rotated by the screen number, so every slot is used
    const perScreen = new Map();
    for (const t of [...plan.fwdT, ...plan.backT]) { const sc = Math.floor(t.w / g.span); if (!perScreen.has(sc)) perScreen.set(sc, []); perScreen.get(sc).push(t); }
    if (entry === 'battle') for (const [sc, ts] of perScreen) {
      const rot = [...BATTLE_SLOTS.slice(sc % BATTLE_SLOTS.length), ...BATTLE_SLOTS.slice(0, sc % BATTLE_SLOTS.length)].slice(0, ts.length).sort((p, q) => p - q);
      ts.sort((p, q) => p.w - q.w).forEach((t, i) => { t.slot = rot[i]; });
    }
    const dead = g.deadAxis;
    // battle: walk into the monster and fight. continue: walk into a Save NPC, save, power-cycle (battery RAM kept on MMC1/MMC3, the flash sector
    // kept on UNROM 512) and Continue from the title -- the saved position is where the player stood in contact with the NPC
    const engage = (btn, target, slot) => {
      if (entry === 'battle') steps.push({ op: 'battle', btn, axis: g.axis, max: 3000, target, slot });
      else steps.push({ op: 'save', btn, axis: g.axis, max: 3000, target, battery }, { op: 'cycle', axis: g.axis, target, battery });
    };
    const laneDeadPos = (lane) => (lane === 0 ? 120 : 184);
    for (const t of plan.fwdT) {
      if (planned(Wf(t.b)) !== t.b) throw new Error(`battle: forward target ${t.b} gives window ${planned(Wf(t.b))}`);
      engage(g.fwd, `f${t.b}`, t.slot);
      redrawCheck(t.b, 'fwd');
      hold('fwd', Wf(t.b) + 20); streamCheck(t.b, 'fwd');
    }
    // walk to the top of the back lane's range, then change lane (the dead axis) and come back
    hold('fwd', Wb(plan.backT[0].b) + 24);
    steps.push({ op: 'hold', btn: g.deadFwd, axis: dead, gte: laneDeadPos(1), max: 400 });
    steps.push({ op: 'check', label: 'sw:lane' });
    for (const t of plan.backT) {
      if (planned(Wb(t.b)) !== t.b) throw new Error(`battle: backward target ${t.b} gives window ${planned(Wb(t.b))}`);
      engage(g.back, `b${t.b}`, t.slot);
      redrawCheck(t.b, 'back');
      hold('back', Wb(t.b) - 20); streamCheck(t.b, 'back');
    }
    world.mutate = (project) => {
      const map = project.maps[0];
      let actorId;
      if (entry === 'battle') {
        project.sprites.actors.push({ name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } });
        actorId = project.sprites.actors.length - 1;
      } else {
        // Continue needs a title screen, and a title is an ordinary map's screen: a second, one-screen map
        project.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
        actorId = project.sprites.actors.length - 1;
        project.maps.push(createMap(project.maps.length, 'Title'));
        project.project.titleMap = project.maps.length - 1;
        project.project.titleScreen = 0;
      }
      let decoy = null;
      if (entry === 'battle') { project.sprites.actors.push({ name: 'Decoy', behavior: 'npc', hp: 1, damage: 0 }); decoy = project.sprites.actors.length - 1; }
      const put = (sc, local, dp, id, props) => map.screens[sc].entities.push({ actorId: id, ...(ring === 1 ? { x: local, y: dp } : { x: dp, y: local }), props });
      for (const t of [...plan.fwdT, ...plan.backT]) {
        const sc = Math.floor(t.w / g.span), local = t.w % g.span;
        const dp = laneDeadPos(t.lane);
        const props = entry === 'battle' ? {} : { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } };
        t.entry = { sc, local, dp, props };
      }
      if (entry === 'battle') {
        // each screen's entity list is laid out so every monster sits at its planned slot (list index == entity slot): inert decoys fill the gaps, on the dead-axis
        // lane 40, which neither the forward lane (120) nor the back lane (184) passes within touching distance of
        for (const [sc, ts] of perScreen) {
          const bySlot = new Map(ts.map((t) => [t.slot, t]));
          const top = Math.max(...bySlot.keys());
          for (let slot = 0; slot <= top; slot++) {
            const t = bySlot.get(slot);
            if (t) put(t.entry.sc, t.entry.local, t.entry.dp, actorId, t.entry.props);
            else put(sc, 24 + 20 * slot, 40, decoy, {});
          }
        }
      } else for (const t of [...plan.fwdT, ...plan.backT]) put(t.entry.sc, t.entry.local, t.entry.dp, actorId, t.entry.props);
      for (const [i, sc] of map.screens.entries()) if (sc.entities.length > (entry === 'battle' ? 8 : 5)) throw new Error(`${entry} scene: screen ${i} carries ${sc.entities.length} entities (limit ${entry === 'battle' ? 8 : 5})`);
    };
  } else throw new Error(`unknown redraw entry ${entry}`);

  const sequence = [];
  for (const st of steps) {
    if (st.op === 'check') sequence.push({ t: 'check', label: st.label });
    else if (st.op === 'hold') sequence.push({ t: 'hold', label: `hold:${st.btn}:${st.gte ?? st.lte}` });
    else if (st.op === 'lag') sequence.push({ t: 'hold', label: `hold:lag:${st.target}` });
    else if (st.op === 'jumpwait') sequence.push({ t: 'hold', label: `hold:jump:${st.target}` });
    else if (st.op === 'battle') sequence.push({ t: 'hold', label: `hold:battle:${st.target}` });
    else if (st.op === 'save') sequence.push({ t: 'hold', label: `hold:save:${st.target}` });
    else if (st.op === 'cycle') sequence.push({ t: 'hold', label: `hold:cycle:${st.target}` });
  }
  void arrivals;
  if (entry === 'battle') for (const sl of BATTLE_SLOTS) extra.push(`battle-slot:${sl}`);
  return {
    steps, start, world,
    expect: {
      kind: 'redraw', ring, n, entry, holds: steps.filter((s) => ['hold', 'lag', 'jumpwait', 'battle', 'save', 'cycle'].includes(s.op)).length, walls: [], dialogues: 0, boxLiveNts: [], boxSeam: false,
      typing: TYPING, sequence, witnesses: requiredWitnesses({ ring, n, extra })
    }
  };
}

/**
 * The Continue landing scenes (review 3 task 1). The player STARTS at (screen, local y) of a 4-screen world and an `enter` Save NPC on that screen saves
 * on the landing -- an authored Save event at a legal start position, so a Save at local y 224, 225 and 239 (y > MAX_Y = 224 is continuable since 5138c1f)
 * and at the Y-scrolling ring's wholly-y>=224 windows (c0 = 15 at row 1, c0 = 0 at row 2) is planted exactly, not by a walk that can never reach it. Then:
 * check (before the cycle) -> power cycle and Continue -> check (the landing, judged against the live-NT oracle and compared with the saved place by the
 * judge) -> a walk of 20 px (forward unless the window is already the last one) -> check (ordinary streaming resumed).
 * Vertical ring: x is the scrolling axis (start x = 120, screens 1 and 2 = both NT parities), y the dead axis; horizontal ring: y scrolls, x = 120.
 */
export const LAND_N = 4;
export const LAND_CASES = { 1: [{ screen: 1, y: 225 }, { screen: 2, y: 225 }, { screen: 1, y: 239 }, { screen: 2, y: 239 }],
  2: [{ screen: 1, y: 224 }, { screen: 2, y: 224 }, { screen: 1, y: 225 }, { screen: 2, y: 225 }, { screen: 1, y: 239 }, { screen: 2, y: 239 }] };
export const landId = (ring, c) => `land-s${c.screen}-y${c.y}`;

export function landScene({ ring, screen, y, battery = false }) {
  const g = GEOM[ring];
  const n = LAND_N;
  const bmax = bmaxOf(ring, n);
  const world = ring === 1 ? screen * g.span + 120 : screen * g.span + y; // position on the scrolling axis
  const pos = ring === 1 ? { col: screen, row: 0, px: 120, py: y } : { col: 0, row: screen, px: 120, py: y };
  const b = windowBlock({ ring, n, ...pos });
  const dir = b < bmax ? 'fwd' : 'back';
  const target = `s${screen}y${y}`;
  const steps = [{ op: 'title' }, { op: 'boot' }, { op: 'check', label: 'sw:land' }, { op: 'cycle', axis: g.axis, target, battery }];
  const label = (kind, bb, d) => `sw:${kind}:continue:b=${bb}:${d}`;
  steps.push({ op: 'check', label: label('redraw', b, dir) });
  // On a vertical ring the landing's local y (225 / 239) lies below the playable row, where the lower body edge is off the 240-px screen (solid): at y 225 the
  // player can still step UP, and the walk that shows ordinary streaming resumed is up to y 200 and then 20 px forward; at y 239 it cannot move at all
  // (measured in both emulators), so that case declares the up-hold a WALL -- the recorded proof that the post-landing streaming walk is impossible there,
  // asserted on every run -- and carries no stream witness.
  const walled = ring === 1 && y === 239;
  if (ring === 1) steps.push({ op: 'hold', btn: 'up', axis: 'y', lte: 200, max: 600 });
  const w1 = dir === 'fwd' ? world + 20 : world - 20;
  let b1 = null;
  if (!walled) {
    steps.push(dir === 'fwd' ? { op: 'hold', btn: g.fwd, axis: g.axis, gte: w1, max: 600 } : { op: 'hold', btn: g.back, axis: g.axis, lte: w1, max: 600 });
    b1 = windowBlock({ ring, n, ...(ring === 1 ? { col: Math.floor(w1 / g.span), row: 0, px: w1 % g.span, py: 200 } : { col: 0, row: Math.floor(w1 / g.span), px: 120, py: w1 % g.span }) });
    if (dir === 'fwd' ? !(b1 > b) : !(b1 < b)) throw new Error(`land s${screen} y${y}: a 20 px walk ${dir} does not move the window (${b} -> ${b1})`);
    steps.push({ op: 'check', label: label('stream', b1, dir) });
  }
  const extra = [`redraw:continue:c0=${b % g.P}:${dir}`, `continue-land:s=${screen}:y=${y}`, ...(walled ? ['dead-axis:wall:up'] : [`stream:continue:c0=${b % g.P}:${dir}`])];
  const sequence = steps.map((st) => (st.op === 'check' ? { t: 'check', label: st.label } : st.op === 'cycle' ? { t: 'hold', label: `hold:cycle:${st.target}` } : st.op === 'hold' ? { t: 'hold', label: `hold:${st.btn}:${st.gte ?? st.lte}` } : null)).filter(Boolean);
  return {
    steps,
    start: ring === 1 ? { screen, x: 120, y } : { screen, x: 120, y },
    world: {
      n, talkers: 'none',
      mutate: (project) => {
        // the title screen Continue needs, and the Saver: an `enter` event on the start screen (it fires on the landing, with the player where the start put them)
        project.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
        const actorId = project.sprites.actors.length - 1;
        project.maps.push(createMap(project.maps.length, 'Title'));
        project.project.titleMap = project.maps.length - 1;
        project.project.titleScreen = 0;
        project.maps[0].screens[screen].entities.push({ actorId, x: ring === 1 ? 40 : 200, y: 40, props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } } });
      }
    },
    expect: {
      kind: 'redraw', ring, n, entry: 'continue', holds: steps.filter((st) => st.op === 'hold' || st.op === 'cycle').length, walls: walled ? ['hold:up:200'] : [], dialogues: 0, boxLiveNts: [], boxSeam: false, typing: TYPING,
      sequence, witnesses: requiredWitnesses({ ring, n, landing: b, extra })
    }
  };
}
