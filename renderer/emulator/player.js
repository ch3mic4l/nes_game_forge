// The in-app NES: screen, controller input, and the debugger around it.

import { el, clear, fill, toast, fitZoom, observeSize } from '../ui.js';
import { Emulator, BUTTON } from './runcontrol.js';
import { applyStartOverride } from './testplay.js';
import { applyBattleTest } from './battletest.js';
import { AudioOut } from './audio.js';
import { cpuPanel, disassemblyPanel, memoryPanel, ppuPanel, switchesPanel, togglesPanel, TOGGLE_COPY } from './panels.js';
import { applyDesiredToggles } from '../../shared/testoverrides.js';

const SCREEN_W = 256;
const SCREEN_H = 240;

// The gap between the screen and the key hint below it; the fit calculation has
// to subtract exactly what the stylesheet lays out.
const HINT_GAP = 10;

const DEFAULT_BINDINGS = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  a: 'KeyX',
  b: 'KeyZ',
  select: 'ShiftRight',
  start: 'Enter'
};

const SLOT_TO_BUTTON = {
  up: BUTTON.UP,
  down: BUTTON.DOWN,
  left: BUTTON.LEFT,
  right: BUTTON.RIGHT,
  a: BUTTON.A,
  b: BUTTON.B,
  select: BUTTON.SELECT,
  start: BUTTON.START
};

/** key code -> NES button, from the bindings the Controller Forge stores. */
function keyMap(bindings) {
  const map = {};
  for (const [slot, code] of Object.entries({ ...DEFAULT_BINDINGS, ...bindings })) {
    if (SLOT_TO_BUTTON[slot] !== undefined && code) map[code] = SLOT_TO_BUTTON[slot];
  }
  return map;
}

/**
 * @param {object} options
 * @param {Uint8Array} options.rom
 * @param {object} [options.symbols] label -> address, from the build's .fns
 * @param {object} [options.ram] engine constants, from the build's constants.asm
 * @param {number} [options.numVariables] NUM_VARIABLES, from the build's config.inc
 * @param {string[]} [options.switchNames] project.switches — authoring names, for the debugger
 * @param {string[]} [options.variableNames] project.variables, likewise
 * @param {boolean} [options.battleEnabled] generated BATTLE_ENABLED out of the build's
 *   config.inc — whether this is an RPG-battle build, for the invincibility/encounters-off
 *   toggles' own wording. Kept separate from symbol presence: see shared/testoverrides.js.
 * @param {{screen: number, x: number, y: number, label?: string}} [options.startAt]
 *   where to start the player instead of the project's own start — a test-play
 *   override poked into RAM after boot, never compiled into the ROM
 * @param {{formation: number[], label?: string}} [options.battleTest]
 *   fire this formation as a battle immediately after `startAt` lands
 *   (renderer/emulator/battletest.js) — ROADMAP item 3's "battle-test a
 *   selected encounter without walking into it"
 * @param {object} [options.desiredToggles] the scenario's own invincibility/
 *   collision/encounters booleans (ROADMAP item 3's "Reload the ROM" bullet),
 *   re-armed against *this* build right after `configureOverrides()` below —
 *   only ever passed on a scenario-bound session (see `scenarioBound`)
 * @param {boolean} [options.scenarioBound] whether this session was launched
 *   from a remembered test scenario rather than the project's own start —
 *   gates whether the in-player "Reload Test" control renders at all and
 *   whether toggle checkboxes echo into it, so an ordinary session (no
 *   scenario at all) can never overwrite one left over from an earlier test
 * @param {(options: {isLive: () => boolean}) => Promise<{ok: boolean}>} [options.onReload]
 *   rebuild and relaunch this same scenario (build.js's own coordinator);
 *   only meaningful, and only wired to a visible control, when scenarioBound
 * @param {(name: string, checked: boolean) => void} [options.onToggleChange]
 *   echoes a toggle checkbox into the session's remembered scenario
 */
export function mountPlayer(
  container,
  {
    rom,
    symbols = {},
    ram = null,
    numVariables = null,
    switchNames = [],
    variableNames = [],
    battleEnabled = false,
    startAt = null,
    battleTest = null,
    desiredToggles = null,
    scenarioBound = false,
    onReload,
    onToggleChange,
    app,
    onExit
  }
) {
  const labelsByAddress = new Map();
  for (const [name, address] of Object.entries(symbols)) {
    if (!labelsByAddress.has(address)) labelsByAddress.set(address, name);
  }

  const audio = new AudioOut(44100);
  const canvas = el('canvas.pixels', { width: SCREEN_W, height: SCREEN_H });
  const context = canvas.getContext('2d');
  const image = context.createImageData(SCREEN_W, SCREEN_H);
  const pixels = new Uint32Array(image.data.buffer);

  const emulator = new Emulator({
    sampleRate: 44100,
    onFrame: (buffer) => {
      // jsnes stores 0xRRGGBB; canvas wants little-endian ABGR.
      for (let i = 0; i < buffer.length; i++) {
        const value = buffer[i];
        pixels[i] = 0xff000000 | ((value & 0xff) << 16) | (value & 0xff00) | ((value >> 16) & 0xff);
      }
      context.putImageData(image, 0, 0);
    },
    onAudioSample: (left, right) => audio.push(left, right)
  });

  let running = false;
  // Flipped by this mount's own destroy(), below -- checked by the in-player
  // Reload button's onclick after its own await, because by the time that
  // continuation resumes, either "✕ Close" or a Forge navigation (which tears
  // this player down the same way) can have already made restoring run state
  // here meaningless: nothing showing it survived to be paused or resumed.
  // Also handed to the reload coordinator as this session's own liveness
  // predicate (renderer/forges/build/build.js), combined there with the
  // Build Forge mount's own equivalent flag.
  let torndown = false;
  let animationHandle = null;
  let debuggerOpen = false;
  // 'fit' scales the screen to whatever room the stage has; 1-3 pin it.
  let zoom = 'fit';
  let panelTimer = 0;
  const panels = {};
  let activeTab = 'code';

  // ------------------------------------------------------------- run loop

  // requestAnimationFrame follows the display — 120 Hz monitors are common —
  // while the NES runs at its own 60.0988 frames a second. Running one frame
  // per callback therefore plays the game (and produces audio) at whatever
  // speed the monitor dictates, so the loop owes frames to wall-clock time
  // instead, nudged by the audio buffer's fill level so the sample producer
  // and the sound card's consumer cannot drift apart.
  const NES_FPS = 60.0988;
  let lastTick = null;
  let owedFrames = 0;

  function setRunning(next) {
    running = next;
    lastTick = null;
    owedFrames = 0;
    buttons.play.textContent = running ? '⏸ Pause' : '▶ Run';
    buttons.play.classList.toggle('btn-accent', !running);
    audio.setMuted(!running || muted);
    if (running) {
      audio.resume();
      if (!animationHandle) animationHandle = requestAnimationFrame(tick);
    } else if (animationHandle) {
      cancelAnimationFrame(animationHandle);
      animationHandle = null;
      refreshPanels();
    }
    status.textContent = running ? 'Running' : 'Paused';
  }

  function tick(now) {
    animationHandle = null;
    if (!running) return;
    owedFrames += lastTick === null ? 1 : ((now - lastTick) / 1000) * NES_FPS * audio.driftRatio();
    lastTick = now;
    if (owedFrames > 4) owedFrames = 4; // a stall or a hidden window never fast-forwards
    try {
      let hit = null;
      while (owedFrames >= 1 && !hit) {
        owedFrames -= 1;
        const result = emulator.runFrame();
        // A trap that redirects to itself (a malformed symbol table -- see
        // shared/testoverrides.js) never advances the PPU, so runFrame() never
        // sees a frame end and gives up instead of hanging. That is a real
        // failure, not a quiet no-op: treated as one here, through the same
        // path an actual thrown crash already takes, rather than silently
        // looping forever with "Running" on screen and nothing moving.
        if (result.exhausted) {
          throw new Error('the emulator did not complete a frame (a stuck intercept or runaway loop)');
        }
        hit = result.hit;
      }
      audio.flush();
      if (hit) {
        setRunning(false);
        const where = labelsByAddress.get(hit.address);
        status.textContent =
          hit.kind === 'pc'
            ? `Breakpoint at $${hit.address.toString(16).padStart(4, '0').toUpperCase()}${where ? ` (${where})` : ''}`
            : `Watchpoint: ${hit.kind} of $${hit.address.toString(16).padStart(4, '0').toUpperCase()}`;
        refreshPanels();
        return;
      }
    } catch (error) {
      setRunning(false);
      status.textContent = `Crashed: ${error.message}`;
      return;
    }
    if (debuggerOpen && ++panelTimer >= 30) {
      panelTimer = 0;
      refreshPanels();
    }
    animationHandle = requestAnimationFrame(tick);
  }

  function stepAnd(action, label) {
    if (running) setRunning(false);
    try {
      action();
    } catch (error) {
      status.textContent = `Crashed: ${error.message}`;
      return;
    }
    // Push whatever the PPU has produced so far so single-stepping is visible.
    emulator.nes.ui.writeFrame(emulator.nes.ppu.buffer);
    status.textContent = label;
    refreshPanels();
  }

  function refreshPanels() {
    if (!debuggerOpen) return;
    for (const panel of Object.values(panels)) panel?.refresh?.();
  }

  // --------------------------------------------------------------- input

  const heldKeys = new Set();
  let keys = keyMap({});
  window.forge.settings.get().then((result) => {
    if (result.ok) {
      keys = keyMap(result.value.playBindings ?? {});
      hint.textContent = describeKeys(keys);
    }
  });

  function onKeyDown(event) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '')) return;
    const button = keys[event.code];
    if (button === undefined) return;
    event.preventDefault();
    if (!heldKeys.has(event.code)) {
      heldKeys.add(event.code);
      emulator.setButton(button, true);
    }
  }
  function onKeyUp(event) {
    const button = keys[event.code];
    if (button === undefined) return;
    event.preventDefault();
    heldKeys.delete(event.code);
    emulator.setButton(button, false);
  }

  function describeKeys(map) {
    const names = {};
    for (const [code, button] of Object.entries(map)) {
      const pretty = code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '');
      names[button] ??= pretty;
    }
    return (
      `${names[BUTTON.UP] ?? '?'}/${names[BUTTON.DOWN] ?? '?'}/${names[BUTTON.LEFT] ?? '?'}/` +
      `${names[BUTTON.RIGHT] ?? '?'} move · ${names[BUTTON.B] ?? '?'} = B · ${names[BUTTON.A] ?? '?'} = A · ` +
      `${names[BUTTON.START] ?? '?'} = Start · ${names[BUTTON.SELECT] ?? '?'} = Select`
    );
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // ----------------------------------------------------------------- DOM

  const status = el('span.status-meta', null, 'Loading…');
  const hint = el('p.hint', null, 'Arrow keys move · Z = B · X = A · Enter = Start · Right Shift = Select');
  const playStage = el('div.canvas-stage', { style: { flexDirection: 'column', gap: `${HINT_GAP}px` } }, canvas, hint);
  let muted = false;

  const buttons = {
    play: el('button.btn.btn-accent', { onclick: () => setRunning(!running) }, '▶ Run'),
    step: el(
      'button.btn.btn-sm',
      { title: 'Step one instruction (F11)', onclick: () => stepAnd(() => emulator.stepInstruction(), 'Stepped one instruction') },
      '⤼ Step'
    ),
    over: el(
      'button.btn.btn-sm',
      { title: 'Step over a JSR', onclick: () => stepAnd(() => emulator.stepOver(), 'Stepped over') },
      '⤻ Over'
    ),
    out: el(
      'button.btn.btn-sm',
      { title: 'Run until this subroutine returns', onclick: () => stepAnd(() => emulator.stepOut(), 'Stepped out') },
      '⤴ Out'
    ),
    scanline: el(
      'button.btn.btn-sm',
      { onclick: () => stepAnd(() => emulator.stepScanline(), 'Stepped one scanline') },
      'Scanline'
    ),
    frame: el(
      'button.btn.btn-sm',
      {
        onclick: () =>
          stepAnd(() => {
            const result = emulator.runFrame();
            if (result.exhausted) throw new Error('the emulator did not complete a frame (a stuck intercept or runaway loop)');
            audio.flush();
          }, 'Stepped one frame')
      },
      'Frame'
    ),
    reset: el(
      'button.btn.btn-sm',
      {
        onclick: () => {
          emulator.reset();
          status.textContent = 'Reset';
          refreshPanels();
        }
      },
      '⟳ Reset'
    ),
    // Only rendered on a scenario-bound session (see mountPlayer's own doc
    // comment) -- an ordinary session has no scenario to reload into, and
    // showing the control anyway would either do nothing or, worse, invent
    // one. onclick owns wasRunning/pause/restore itself rather than the
    // coordinator, because by the time its own `await` resolves this exact
    // player instance may already be gone (Close, or a Forge navigation
    // that tears it down the same way) -- `torndown` is what notices that.
    reload: scenarioBound
      ? el(
          'button.btn.btn-sm',
          {
            title:
              'Rebuilds and restarts the ROM with the same test scenario. Breakpoints and watchpoints are ' +
              'cleared. The test scenario is remembered by name, and resuming follows the name.',
            onclick: async () => {
              buttons.reload.disabled = true;
              const wasRunning = running;
              setRunning(false);
              try {
                const outcome = await onReload({ isLive: () => !torndown });
                if (torndown) return; // this exact session is already gone; nothing left to restore
                if (!outcome.ok && wasRunning) setRunning(true);
              } finally {
                if (!torndown) buttons.reload.disabled = false;
              }
            }
          },
          '↻ Reload Test'
        )
      : null,
    mute: el(
      'button.btn.btn-sm',
      {
        onclick: () => {
          muted = !muted;
          audio.setMuted(muted || !running);
          buttons.mute.textContent = muted ? '🔇 Muted' : '🔊 Sound';
        }
      },
      '🔊 Sound'
    ),
    debug: el('button.btn.btn-sm', { onclick: () => toggleDebugger() }, '🐞 Debugger'),
    exit: el('button.btn.btn-sm', { onclick: () => onExit?.() }, '✕ Close')
  };

  const debugTabs = el('div.tabs');
  const debugBody = el('div.panel-body', { style: { display: 'none' } });
  const debugPanel = el(
    'div.panel',
    { style: { display: 'none', width: '440px', flex: 'none' } },
    debugTabs,
    debugBody
  );

  function selectTab(id) {
    activeTab = id;
    debugTabs.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === id));
    clear(debugBody);
    if (id === 'code') {
      debugBody.append(panels.cpu.node, el('div', { style: { height: '10px' } }), panels.disassembly.node);
    } else if (id === 'memory') {
      debugBody.append(panels.memory.node);
    } else if (id === 'switches') {
      debugBody.append(panels.switches.node);
    } else if (id === 'toggles') {
      debugBody.append(panels.toggles.node);
    } else {
      debugBody.append(panels.ppu.node);
    }
    refreshPanels();
  }

  function toggleDebugger() {
    debuggerOpen = !debuggerOpen;
    buttons.debug.classList.toggle('active', debuggerOpen);
    debugPanel.style.display = debuggerOpen ? 'flex' : 'none';
    debugBody.style.display = debuggerOpen ? 'block' : 'none';
    if (debuggerOpen && !panels.cpu) {
      panels.cpu = cpuPanel(emulator);
      panels.disassembly = disassemblyPanel(emulator, labelsByAddress);
      panels.memory = memoryPanel(emulator);
      panels.ppu = ppuPanel(emulator);
      panels.switches = switchesPanel(emulator, { ram, numVariables, switchNames, variableNames });
      panels.toggles = togglesPanel(emulator, {
        ram,
        symbols,
        battleEnabled,
        onChange: scenarioBound ? onToggleChange : undefined
      });
      fill(debugTabs,
        ...[
          ['code', 'Code'],
          ['memory', 'Memory'],
          ['switches', 'Switches'],
          ['toggles', 'Toggles'],
          ['ppu', 'PPU']
        ].map(([id, label]) =>
          el('button.tab', { dataset: { tab: id }, onclick: () => selectTab(id) }, label)
        )
      );
    }
    if (debuggerOpen) selectTab(activeTab);
  }

  // The key hint shares the stage with the screen, so its height is not room the
  // screen can grow into.
  function applyZoom() {
    const scale =
      zoom === 'fit'
        ? fitZoom(playStage, SCREEN_W, SCREEN_H, { min: 2, max: 8, reserve: hint.offsetHeight + HINT_GAP })
        : zoom;
    canvas.style.width = `${SCREEN_W * scale}px`;
    canvas.style.height = `${SCREEN_H * scale}px`;
  }

  const root = el(
    'div',
    { style: { display: 'flex', height: '100%', minHeight: '0' } },
    el(
      'div',
      { style: { flex: '1', display: 'flex', flexDirection: 'column', minWidth: '0' } },
      el(
        'div.toolbar',
        null,
        buttons.play,
        el('span.sep'),
        buttons.step,
        buttons.over,
        buttons.out,
        buttons.scanline,
        buttons.frame,
        el('span.sep'),
        buttons.reset,
        buttons.reload,
        buttons.mute,
        buttons.debug,
        el('span.sep'),
        ...['fit', 1, 2, 3].map((value) =>
          el(
            'button.btn.btn-sm',
            {
              class: value === zoom ? 'active' : '',
              dataset: { zoom: value },
              title: value === 'fit' ? 'Scale the screen to the window' : `${value} screen pixels per NES pixel`,
              onclick: () => {
                zoom = value;
                applyZoom();
                root.querySelectorAll('[data-zoom]').forEach((button) => {
                  button.classList.toggle('active', button.dataset.zoom === String(value));
                });
              }
            },
            value === 'fit' ? 'Fit' : `${value}×`
          )
        ),
        el('span.spacer'),
        status,
        el('span.sep'),
        buttons.exit
      ),
      playStage
    ),
    debugPanel
  );

  container.append(root);
  applyZoom();
  // Opening the debugger narrows the stage just as resizing the window does.
  const stopWatchingStage = observeSize(playStage, applyZoom);

  // -------------------------------------------------------------- startup

  // Resolved test-override targets are only valid for the ROM they were
  // resolved against (shared/testoverrides.js), so every loadROM() below is
  // paired with this — including the start-override fallback, which reloads
  // the same bytes fresh rather than playing on from a part-way boot.
  function configureOverrides() {
    emulator.configureTestOverrides({ ram, symbols });
  }

  try {
    emulator.loadROM(rom);
    configureOverrides();
  } catch (error) {
    status.textContent = `Could not load the ROM: ${error.message}`;
    toast(`Could not load the ROM: ${error.message}`, 'error');
    // ok: false, not just a bare {destroy} -- play() (renderer/forges/build/
    // build.js) has to be able to tell this apart from a real mount, or a
    // ROM that failed to load reads as a session that succeeded, the same
    // "failure with a success wrapped around it" shape round 7 review's
    // finding 2 already fixed one layer up, in play() itself.
    return { destroy, ok: false, reason: error.message };
  }

  // Re-arm whichever of the scenario's toggles this build can still support,
  // right after configureOverrides() -- which is what just resolved whether
  // each one even has a target to arm against *this* build. Only ever
  // non-null on a scenario-bound session; an ordinary one has nothing to
  // re-arm and nothing to report having lost.
  if (desiredToggles) {
    const { armed, unavailable } = applyDesiredToggles(desiredToggles, { ram, symbols, battleEnabled });
    for (const name of armed) emulator.setTestOverrides({ [name]: true });
    // Cleared from the remembered scenario, not merely left un-armed here:
    // otherwise the next reload retries the exact same toggle against a
    // build it still cannot support and reports the identical loss again,
    // and a *later* build that happens to support it again would silently
    // re-enable a toggle whose own checkbox has been showing unchecked and
    // disabled this whole time -- a toggle the tester never re-armed on
    // purpose coming back on its own.
    for (const { name } of unavailable) onToggleChange?.(name, false);
    if (unavailable.length) {
      toast(
        unavailable
          .map(({ name, reason }) => `${TOGGLE_COPY[name]?.label ?? name} could not be re-armed: ${reason}.`)
          .join(' '),
        'error'
      );
    }
  }

  // The cartridge still starts where the project says; this moves the player
  // once it is already running. Failing is not fatal — the ROM is fine, it is
  // only the shortcut into it that is not — but it gives up part-way through a
  // start it never completed, so the ROM is loaded again rather than played on
  // from wherever that left the machine. "Playing from the start" then means it.
  let startedFrom = null;
  if (startAt) {
    try {
      applyStartOverride(emulator, startAt, { ram, symbols });
      startedFrom = startAt.label ?? `screen ${startAt.screen}`;
      toast(`Playing from ${startedFrom}`, 'success');
    } catch (error) {
      emulator.loadROM(rom);
      configureOverrides();
      toast(`Could not start from there: ${error.message}. Playing from the start.`, 'error');
    }
  }

  // Fired immediately after startAt lands, on the same "gives up rather than
  // continue from a mutated middle" philosophy: applyBattleTest can throw
  // after already poking some RAM (a formation overwritten mid-frame, say),
  // and there is no sensible "continue playing" from that half state.
  if (battleTest) {
    try {
      applyBattleTest(emulator, battleTest.formation, { ram, symbols });
      toast(`Battle-test: ${battleTest.label ?? 'started'}`, 'success');
    } catch (error) {
      emulator.loadROM(rom);
      configureOverrides();
      // startedFrom was set above when startAt landed, but this fallback just
      // discarded that landing along with everything else -- reloading fresh
      // from the authored start, same as the startAt catch block already
      // does. Leaving startedFrom set would have the status line beneath
      // claim "Playing from <startAt's label>" for a session that is
      // actually sitting at the project's own start.
      startedFrom = null;
      toast(`Could not start the battle-test: ${error.message}. Playing from the start.`, 'error');
    }
  }

  audio.start().then((ready) => {
    if (!ready && audio.failed) status.textContent = `Sound unavailable (${audio.failed})`;
  });
  setRunning(true);
  app?.setStatus?.(startedFrom ? `Playing from ${startedFrom}` : 'Playing');

  function destroy() {
    torndown = true;
    running = false;
    stopWatchingStage();
    if (animationHandle) cancelAnimationFrame(animationHandle);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    audio.destroy();
  }

  return {
    destroy,
    emulator,
    ok: true,
    // The exact refresh `tick()` drives periodically while the debugger is
    // open, exposed so the smoke test can force one deterministically instead
    // of waiting on however many requestAnimationFrame callbacks a throttled
    // or unfocused window actually delivers — the same reasoning sprite.js
    // exposes stepPreview() for.
    refreshPanels
  };
}
