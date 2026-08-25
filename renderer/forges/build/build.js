// Build & Play — runs the pipeline, shows what it did, and boots the result.

import { store } from '../../store.js';
// main/build/battletables.js is pure -- it imports only from shared/ -- which
// is what lets the renderer share the exact expression checkCapacity refuses
// on rather than keep a second copy of it. Same precedent as
// renderer/forges/sound/sound.js importing compileSong from
// main/build/songcompile.js. See that file's own header before adding an
// import to it.
import {
  battleCodeOverridden,
  battleRegionBytes,
  battleRegionCeiling,
  battleRegionPlacementOverridden
} from '../../../main/build/battletables.js';
import { el, clear, fill, toast } from '../../ui.js';
import {
  validateProject,
  LIMITS,
  RPG_LIMITS,
  reconcileCartridge,
  projectUsesSave,
  projectScreenCeiling
} from '../../../shared/project.js';
import {
  MAPPERS,
  mapperById,
  mirroringById,
  mirroringOptions,
  resolveMapper,
  rpgCapable,
  rpgUnsupportedReason,
  saveCapable,
  saveUnsupportedReason,
  tilesetLimit
} from '../../../shared/cartridge.js';
import { BLANK_TILE } from '../../../shared/chr.js';
import { describePlayScenario, resolveStartAt, resolveFormation } from '../../../shared/playscenario.js';
import { runReloadTest } from '../../../shared/reloadcoordinator.js';
import { preparePlaySession } from '../../../shared/playsession.js';
import { TOGGLE_NAMES } from '../../../shared/testoverrides.js';
import { mountPlayer } from '../../emulator/player.js';

/**
 * How a party grows, and which graphics bank a battle is fought in.
 *
 * The experience curve is turned into a table at build time — the 6502 has no
 * multiply — so the numbers here are the ones the ROM will use, not a
 * description of them.
 */
function rpgProgression(project) {
  const { rpg } = project;
  const set = (key, value) => {
    store.commit('Change RPG progression', (draft) => {
      draft.rpg[key] = value;
    });
  };
  const number = (label, key, min, max, hint) =>
    el(
      'label.field-row',
      { style: { marginBottom: '6px', gap: '6px' }, title: hint },
      el('span.field-label', { style: { flex: '1' } }, label),
      el('input', {
        type: 'number',
        min,
        max,
        value: rpg[key],
        style: { width: '80px' },
        onchange: (event) => set(key, Math.max(min, Math.min(max, Number(event.target.value))))
      })
    );

  return el(
    'div',
    { style: { marginTop: '14px' } },
    el('div.panel-head', { style: { paddingLeft: '0' } }, 'RPG progression'),
    number('Experience for level 2', 'xpBase', 1, 255, 'The first threshold'),
    number('...and more each level', 'xpGrow', 0, 255, 'Added to the step every level'),
    number('Highest level', 'maxLevel', 1, RPG_LIMITS.maxLevel, 'Costs a table entry per member'),
    el(
      'label.field-row',
      { style: { marginBottom: '6px', gap: '6px' }, title: 'The CHR bank a battle switches to' },
      el('span.field-label', { style: { flex: '1' } }, 'Battle tileset'),
      el(
        'select',
        { onchange: (event) => set('battleTilesetId', Number(event.target.value)) },
        project.tilesets.map((tileset, index) =>
          el('option', { value: index, selected: index === rpg.battleTilesetId }, tileset.name)
        )
      )
    ),
    el(
      'p.hint',
      null,
      `Reaching level ${rpg.maxLevel} takes ` +
        `${xpTotalFor(rpg)} experience in all. Monster artwork is drawn from the battle tileset, so ` +
        'that is where it has to live.'
    )
  );
}

/** The running total the last level costs, which is what a player actually feels. */
function xpTotalFor({ xpBase, xpGrow, maxLevel }) {
  let running = 0;
  for (let level = 1; level < maxLevel; level++) running += xpBase + (level - 1) * xpGrow;
  return running;
}

export function mount(container, app) {
  let building = false;
  let lastBuild = null;
  let emulator = null;
  // Flipped by this mount's own destroy(), below -- the reload coordinator's
  // "did the world I started in survive" check (ROADMAP item 3's "Reload the
  // ROM" bullet), combined there with whatever liveness the caller (an
  // in-player Reload) supplies of its own. Not a lock: nothing here refuses
  // navigation, it only refuses to act, afterward, as though navigation
  // hadn't happened.
  let destroyed = false;

  const log = el('div', {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: '11.5px',
      lineHeight: '1.65',
      whiteSpace: 'pre-wrap',
      userSelect: 'text',
      color: 'var(--text-dim)'
    }
  });
  const logStage = el('div.panel-body', { style: { background: 'var(--bg-0)' } }, log);
  const summary = el('div');
  // flex + min-height:0 rather than height:100%: as a flex item, `height: 100%`
  // still refuses to shrink below its content, so a tall emulator screen pushed
  // its own key hint out through the panel's `overflow: hidden`.
  const playHost = el('div', { style: { display: 'none', flex: '1', minHeight: '0' } });

  const buttons = {};

  function write(line, kind = '') {
    const color =
      kind === 'error' ? 'var(--red)' : kind === 'good' ? 'var(--green)' : kind === 'warn' ? 'var(--accent)' : null;
    log.append(el('div', { style: color ? { color } : null }, line));
    logStage.scrollTop = logStage.scrollHeight;
  }

  /** An error line that names a file the Code Forge can open, at the line it names. */
  function writeLink(line, { file, line: lineNumber }) {
    log.append(
      el(
        'div',
        {
          style: {
            color: 'var(--red)',
            cursor: 'pointer',
            textDecoration: 'underline',
            textDecorationStyle: 'dotted'
          },
          title: `Open ${file} in the Code Forge`,
          onclick: async () => {
            await app.goTo('code');
            app.current?.openFile?.(file, lineNumber);
          }
        },
        line
      )
    );
    logStage.scrollTop = logStage.scrollHeight;
  }

  const unsubscribe = window.forge.on('build:log', (line) => write(line));

  function setBusy(busy) {
    building = busy;
    buttons.build.disabled = busy;
    buttons.play.disabled = busy;
    buttons.mesen.disabled = busy || !lastBuild;
    buttons.reveal.disabled = busy || !lastBuild;
    buttons.reloadTest.disabled = busy;
  }

  async function build({ silent = false } = {}) {
    if (building) return null;
    clear(log);
    setBusy(true);
    app.setStatus('Building…');

    // The pipeline reads the project from disk, so save first.
    if (store.dirty) {
      write('Saving project…');
      if (!(await app.saveProject())) {
        write('Could not save the project.', 'error');
        setBusy(false);
        return null;
      }
    }

    // Cloned here, at the exact point this dispatches, not read again later:
    // store.commit mutates the live project in place, so a reader that came
    // back to store.project after this await could see edits made *during*
    // assembly (an earlier actor deleted, say, which renumbers every later
    // one) that the ROM about to come back never reflected. Carrying this
    // clone forward on the result is what lets the reload coordinator
    // resolve a scenario against what was actually built, not against
    // whatever the project has since become.
    const project = structuredClone(store.project);
    const result = await window.forge.build.run(store.dir, project);
    setBusy(false);

    if (!result.ok) {
      write('');
      // The assembler reports `file:line: message`, and the Code Forge can open
      // exactly that — so those lines are rendered as links rather than text.
      // Everything else (a capacity problem, a missing nesasm) is plain.
      const located = new Map(
        (result.errors ?? [])
          .filter((entry) => entry.file)
          .map((entry) => [`${entry.file}:${entry.line}: ${entry.message}`, entry])
      );
      for (const line of String(result.error).split('\n')) {
        const entry = located.get(line);
        if (entry) writeLink(line, entry);
        else write(line, 'error');
      }
      app.setStatus('Build failed', 'error');
      if (!silent) toast('Build failed — see the log.', 'error');
      lastBuild = null;
      buttons.mesen.disabled = true;
      buttons.reveal.disabled = true;
      return null;
    }

    lastBuild = { ...result.value, project };
    buttons.mesen.disabled = false;
    buttons.reveal.disabled = false;
    write('');
    write(`Ready: ${result.value.romPath}`, 'good');
    app.setStatus(`Built ${(result.value.size / 1024).toFixed(0)} KB ROM`, 'ready');
    renderSummary();
    return lastBuild;
  }

  /** The ordinary toolbar/menu path: always plays from the project's own
   * authored start. Never reads or writes app.playScenario -- a control
   * named "Build & Play" has to keep meaning exactly that, not "resume
   * whatever was last remembered," or its own label would be lying about
   * what it does depending on session history nothing on the button shows. */
  async function buildAndPlay() {
    // Falling back to the last good build on a failed rebuild is defensible
    // here and nowhere else in this file: ordinary Play carries no numeric
    // identity resolved against a particular build's own payload, so the
    // worst case is playing a ROM that is one edit behind -- exactly what
    // this button already did before this feature existed. A scenario-bound
    // play has no such fallback (see buildAndPlayScenario below) because it
    // does carry one.
    const result = (await build({ silent: true })) ?? lastBuild;
    if (!result) return;
    await play(result, {});
  }

  /**
   * Map Forge's own entry point: "play from here" and "battle-test this
   * formation now" (ROADMAP item 3's last two bullets). Deliberately a
   * separate function from buildAndPlay() above, not one function with an
   * optional argument -- a stray value reaching the ordinary path (the
   * historical shape of this bug: `onclick: buildAndPlay` forwards the click
   * event itself as `options`) can then never be mistaken for a real
   * scenario, because the ordinary path no longer has any scenario-writing
   * code in it to reach at all.
   *
   * @param {{startAt?: {screen: number, x: number, y: number},
   *   battleTest?: {formation: number[], label?: string}}} options raw,
   *   numeric Map Forge choices -- converted once, here, into the name/
   *   position description the remembered scenario actually stores
   *   (shared/playscenario.js's describePlayScenario), against the project
   *   as it stands *now*. This first play is given the original numeric
   *   options unchanged, not round-tripped through resolution: resolving
   *   "did this description hold" is only a real question once time and
   *   edits could have passed, which is true of a reload, never of the
   *   instant the description was created from this same project.
   */
  async function buildAndPlayScenario(options) {
    // Described eagerly (pure, no side effect, against the project as it
    // stands right now) but not *recorded* yet -- see below for why
    // recording has to wait.
    const described = describePlayScenario(options, store.project);
    // No `?? lastBuild` fallback: this scenario's numeric ids were just
    // described against the *current* project, and playing them against an
    // older, already-built ROM that never assembled that project is exactly
    // the "resolves to different content" failure the whole identity design
    // (shared/playscenario.js) exists to prevent -- a stale ROM is not a
    // degraded version of the right answer here, it is a wrong one.
    const result = await build({ silent: true });
    if (!result) return;
    // Recorded only now, once build() has actually accepted and produced
    // this ROM -- not before it ran. Recording it up front looks harmless
    // ("it's only a setter, nothing reads it until later") but is exactly
    // the reasoning that let a *refused* reentrant call win: build()'s own
    // per-mount "building" guard rejects a second, overlapping call with no
    // other side effect at all, so if that call had already recorded its
    // own scenario before reaching build(), it would still overwrite
    // whatever the call that's actually about to mount had just recorded,
    // moments earlier -- the next Reload Test would then resume a scenario
    // the user never got to see start. A scenario whose build was refused
    // or otherwise failed is not a degraded version of the right answer
    // either, for the identical reason the ROM fallback above isn't.
    app.rememberPlayScenario({
      startAt: described.startAt,
      battleTest: described.battleTest,
      toggles: Object.fromEntries(TOGGLE_NAMES.map((name) => [name, false]))
    });
    await play(result, { ...options, scenarioBound: true });
  }

  /**
   * Rebuild the project and relaunch the remembered test scenario (ROADMAP
   * item 3's "Reload the ROM" bullet), reusing play()'s own startup path
   * rather than a second copy of it. `isLive` is folded together here with
   * this mount's own `destroyed` flag before being handed to the shared,
   * dependency-injected coordinator (shared/reloadcoordinator.js) and, from
   * there, into play() itself for its own second check after its
   * asynchronous reads -- one predicate, checked at both places a visible
   * effect could otherwise land on a world that has moved on.
   */
  async function reloadTest({ isLive: callerIsLive = () => true } = {}) {
    const isLive = () => !destroyed && callerIsLive();
    return runReloadTest({
      isLive,
      hasPlayer: () => Boolean(emulator),
      build: () => build({ silent: true }),
      resolveScenario: (project) => ({
        startAt: resolveStartAt(app.playScenario?.startAt ?? null, project),
        battleTest: resolveFormation(app.playScenario?.battleTest ?? null, project)
      }),
      play: (result, options) => play(result, options),
      toast,
      // A thunk, not a captured value: read at the point play() actually
      // needs it, not before the build -- a toggle flipped on the
      // still-visible, paused player while its own rebuild is in flight
      // (the build can easily be the longest part of this whole operation)
      // must reach the session that build produces.
      desiredToggles: () => app.playScenario?.toggles
    });
  }

  /**
   * @returns {Promise<{ok: boolean, reason?: string}>} a real outcome, not
   *   assumed -- the reload coordinator (runReloadTest) has to know whether
   *   this actually mounted a player before it can tell its own caller
   *   whether to restore a paused session's run state (round 7 review's
   *   findings 2/3: this used to return undefined on every path, which
   *   read as success even when readRom itself had just failed).
   */
  async function play(
    result,
    { startAt = null, battleTest = null, desiredToggles = null, scenarioBound = false, isLive = () => true } = {}
  ) {
    // preparePlaySession (shared/playsession.js) owns the isLive() check
    // after each of its own reads -- Close or a Forge navigation can land
    // during any one of them, not only during the build that preceded this
    // call, so a single check before mounting was never enough.
    const prepared = await preparePlaySession({
      readRom: () => window.forge.build.readRom(result.romPath),
      readSymbols: () =>
        result.symbolPath ? window.forge.build.readSymbols(result.symbolPath) : Promise.resolve({ ok: true, value: {} }),
      // Where the engine keeps the bytes a test-play override pokes, and what
      // the debugger's switch/variable inspector reads and pokes. Read out of
      // the build rather than remembered here, so it is the constants.asm
      // that assembled *this* ROM — the Code Forge can have overridden it.
      readConstants: () => window.forge.code.readGenerated(store.dir, 'constants.asm'),
      readConfig: () => window.forge.code.readGenerated(store.dir, 'assets/config.inc'),
      isLive
    });

    if (!prepared.ok) {
      // A `reason` means a genuine failure (readRom itself failed) worth
      // telling someone about; its absence means isLive() caught this
      // first -- nobody is left to hear a toast either way.
      if (prepared.reason) toast(prepared.reason, 'error');
      return { ok: false, reason: prepared.reason };
    }
    if (prepared.constantsWarning) write(`Could not read the engine constants: ${prepared.constantsWarning}`, 'warn');

    logStage.style.display = 'none';
    playHost.style.display = 'block';
    refreshReloadVisibility();
    clear(playHost);
    emulator?.destroy?.();
    emulator = mountPlayer(playHost, {
      rom: new Uint8Array(prepared.rom),
      symbols: prepared.symbols,
      ram: prepared.ram,
      numVariables: prepared.numVariables,
      battleEnabled: prepared.battleEnabled,
      switchNames: store.project.switches,
      variableNames: store.project.variables,
      startAt,
      battleTest,
      desiredToggles,
      scenarioBound,
      onReload: scenarioBound ? reloadTest : undefined,
      onToggleChange: scenarioBound ? (name, checked) => app.rememberPlayScenario({ toggles: { [name]: checked } }) : undefined,
      app,
      onExit: () => {
        emulator?.destroy?.();
        emulator = null;
        playHost.style.display = 'none';
        logStage.style.display = 'block';
        refreshReloadVisibility();
      }
    });
    // mountPlayer's own outcome, not assumed -- a ROM that failed to load
    // (emulator.loadROM throwing) already toasted from inside mountPlayer,
    // but still has to be reported back up through here and, from here,
    // through runReloadTest, or a failed mount reads as a successful reload
    // to whoever is deciding whether to restore a paused session.
    if (!emulator.ok) return { ok: false, reason: emulator.reason };
    return { ok: true };
  }

  async function openInMesen() {
    if (!lastBuild) return;
    const result = await window.forge.build.openInMesen(lastBuild.romPath);
    if (!result.ok) return toast(result.error, 'error');
    toast('Opened in Mesen', 'success');
  }

  function renderSummary() {
    const project = store.project;
    const problems = validateProject(project);
    const screens = project.maps.reduce((total, map) => total + map.screens.length, 0);
    // Summed across tilesets: the meters describe what the cartridge carries,
    // not what one editor tab happens to be showing.
    const countUsed = (table) =>
      project.tilesets.reduce(
        (total, tileset) => total + tileset[table].tiles.filter((tile) => tile !== BLANK_TILE).length,
        0
      );
    const bgUsed = countUsed('background');
    const spriteUsed = countUsed('sprites');
    const tableTotal = LIMITS.tilesPerTable * project.tilesets.length;
    const metatilesUsed = new Set(project.maps.flatMap((map) => map.screens.flatMap((s) => s.metatiles))).size;

    const meter = (label, used, total) =>
      el(
        'div',
        { style: { marginBottom: '10px' } },
        el('div.kv', null, el('span', null, label), el('span', null, `${used} / ${total}`)),
        el(
          'div.meter',
          null,
          el('div.meter-fill', {
            class: used >= total ? 'full' : '',
            style: { width: `${Math.min(100, (used / total) * 100)}%` }
          })
        )
      );

    const mapper = resolveMapper(project.cartridge.mapper);
    const isRpg = project.project.gameType === 'rpg';
    const usesSave = projectUsesSave(project);

    const parts = [
      el('div.panel-head', { style: { paddingLeft: '0' } }, 'Cartridge'),
      el(
        'label.field-row',
        { style: { marginBottom: '8px', gap: '6px' } },
        el('span.field-label', null, 'Mapper'),
        el(
          'select.input',
          {
            onchange: (event) => {
              const id = Number(event.target.value);
              store.commit('Change mapper', (draft) => {
                draft.cartridge.mapper = id;
                // A smaller cartridge may not hold the mirroring mode or the
                // tilesets the old one did.
                reconcileCartridge(draft);
              });
            }
          },
          // Unsupported mappers are listed but disabled with the reason, rather
          // than hidden — the roadmap is more useful than a short menu. A
          // turn-based RPG disables more of them for a different reason: its
          // battle system lives in a switchable program bank and its monsters in
          // a switchable graphics bank, so a board without both cannot hold it.
          MAPPERS.map((entry) => {
            const board = mapperById(entry.id);
            const rpgBlocked = isRpg && board && !rpgCapable(board);
            // saveCapable, not saveMediaImplemented: this option-disable is
            // for boards with no save medium at all (a structural fact), the
            // same kind of thing rpgBlocked already checks -- not "does the
            // engine drive this board's medium today," which is what would
            // matter if a future medium were ever declared before it works.
            // Every registered board's medium is implemented today, so the
            // two predicates currently agree everywhere and this distinction
            // has nothing live to catch yet; it stays saveCapable because
            // that is still the semantically correct question to ask here.
            const saveBlocked = usesSave && board && !saveCapable(board);
            const reason = !entry.supported
              ? entry.unsupportedReason
              : rpgBlocked
                ? rpgUnsupportedReason(board)
                : saveBlocked
                  ? saveUnsupportedReason(board)
                  : entry.hint;
            return el(
              'option',
              {
                value: entry.id,
                selected: entry.id === mapper.id,
                disabled: !entry.supported || rpgBlocked || saveBlocked,
                title: reason
              },
              entry.supported
                ? rpgBlocked
                  ? `${entry.label} — no battle system`
                  : saveBlocked
                    ? `${entry.label} — no save storage`
                    : entry.label
                : `${entry.label} — not yet supported`
            );
          })
        )
      ),
      // Only worth showing when the board offers a choice beyond the usual two.
      mirroringOptions(mapper).length > 2
        ? el(
            'label.field-row',
            { style: { marginBottom: '8px', gap: '6px' } },
            el('span.field-label', null, 'Mirroring'),
            el(
              'select.input',
              {
                onchange: (event) => {
                  const id = event.target.value;
                  store.commit('Change mirroring', (draft) => {
                    draft.cartridge.mirroring = id;
                    // Four-screen spends a CHR-RAM page, so a tileset may have to go.
                    reconcileCartridge(draft);
                  });
                }
              },
              mirroringOptions(mapper).map((entry) =>
                el(
                  'option',
                  {
                    value: entry.id,
                    selected: entry.id === project.cartridge.mirroring,
                    title: entry.hint
                  },
                  entry.label
                )
              )
            )
          )
        : null,
      el('p.hint', null, `${mapper.name}: ${mapper.summary}`),
      // Four-screen is real hardware the engine does not yet exploit, so say so
      // rather than letting a tileset quietly disappear.
      mirroringById(project.cartridge.mirroring).fourScreen
        ? el(
            'p.hint',
            { style: { color: 'var(--accent)' } },
            `Four-screen mirroring spends one CHR-RAM page on nametables, so this cartridge holds ` +
              `${tilesetLimit(mapper, project.cartridge)} tilesets instead of ${mapper.maxChrBanks}. ` +
              'The engine only draws nametable 0, so the extra nametables are unused for now.'
          )
        : null,
      meter('Background tiles', bgUsed, tableTotal),
      meter('Sprite tiles', spriteUsed, tableTotal),
      meter('Metatiles used', metatilesUsed, LIMITS.metatiles),
      // projectScreenCeiling (shared/project.js) is the single expression
      // for this meter, shared with the test that asserts it agrees with
      // checkCapacity's own screen ceiling -- nothing here decides isRpg,
      // bankedCode or reserveFlashSave on its own.
      meter('Screens', screens, projectScreenCeiling(project, mapper)),
      // The battle system's own 8 KB program bank: engine/battle.asm plus the
      // tables battletables.js generates for it. RPG-only, because a project
      // that is not one reserves no such region at all (codeRegionCount).
      //
      // battleRegionBytes/battleRegionCeiling (main/build/battletables.js) are
      // the single expression for this meter, shared with checkCapacity's own
      // refusal and with the test that asserts the two agree -- exactly the
      // projectScreenCeiling arrangement above, for exactly the same reason.
      // Nothing here computes a ceiling of its own, so this meter cannot come
      // to promise room the build then denies.
      //
      // Unlike the Screens meter this one is exact rather than nominal: the
      // region has only two occupants and battleTableBytes counts the second
      // off its real emitted output, so what this shows is what nesasm will
      // report. It reads about half full on an untouched RPG, which is honest
      // -- the engine's own battle code is most of it before an author adds a
      // single monster.
      //
      // Exact for the *stock* battle code, that is. A Code Forge override of
      // battle.asm (or of battleui.asm/battleturn.asm, which it includes) is
      // hand-written 6502, whose size cannot be known from its text, so the
      // base term becomes a measurement of a file that is no longer being
      // assembled. The meter still shows -- the tables half is as real as
      // ever, and hiding it would leave an RPG author with nothing at all --
      // but it says which it is, the same way this panel labels anything else
      // that is not quite what it appears to be.
      isRpg ? meter('Battle system', battleRegionBytes(project, mapper), battleRegionCeiling(mapper)) : null,
      isRpg && (battleCodeOverridden(project) || battleRegionPlacementOverridden(project))
        ? el(
            'p.hint',
            { style: { marginTop: '-6px', color: 'var(--accent)' } },
            battleRegionPlacementOverridden(project)
              ? 'This project overrides main.asm, which is what puts the battle system in that bank at all — ' +
                'so where it ends up is yours to decide and this figure may not describe it. The assembler ' +
                'is the only check.'
              : 'This project overrides the battle system’s own source, so that figure counts the stock code ' +
                'rather than yours. The assembler is the real check for it.'
          )
        : null,
      isRpg ? rpgProgression(project) : null,
      lastBuild
        ? el(
            'div',
            null,
            el('div.panel-head', { style: { paddingLeft: '0' } }, 'Last build'),
            el('div.kv', null, el('span', null, 'Size'), el('span', null, `${lastBuild.size} bytes`)),
            el('div.kv', null, el('span', null, 'Mapper'), el('span', null, String(lastBuild.mapper))),
            el('div.kv', null, el('span', null, 'Time'), el('span', null, `${lastBuild.elapsed} ms`))
          )
        : null,
      problems.length
        ? el(
            'div',
            { style: { marginTop: '14px' } },
            el('div.panel-head', { style: { paddingLeft: '0' } }, 'Problems'),
            problems.map((problem) =>
              el(
                'p.hint',
                { style: { color: problem.severity === 'error' ? 'var(--red)' : 'var(--accent)' } },
                `${problem.where}: ${problem.message}`
              )
            )
          )
        : el('p.hint', { style: { marginTop: '14px', color: 'var(--green)' } }, 'No problems found.')
    ];
    fill(summary, parts);
  }

  buttons.build = el('button.btn', { onclick: () => build() }, '⚙ Build ROM');
  // Wrapped rather than `onclick: buildAndPlay` -- a bare function reference
  // as a DOM handler receives the click event as its first argument, and
  // buildAndPlay() now takes none at all, so nothing here has anywhere left
  // for a stray event object to land.
  buttons.play = el('button.btn.btn-accent', { onclick: () => buildAndPlay() }, '▶ Build & Play');
  buttons.mesen = el('button.btn', { disabled: true, onclick: openInMesen }, 'Open in Mesen');
  buttons.reveal = el(
    'button.btn',
    { disabled: true, onclick: () => lastBuild && window.forge.build.revealRom(lastBuild.romPath) },
    'Show file'
  );
  // Hidden whenever a player is showing -- this toolbar sits above
  // logStage/playHost both and is always rendered regardless of which one
  // is visible, so nothing about layout does this for free; refreshReload
  // Visibility() is called at both places playHost's own display toggles --
  // and whenever there is no scenario to resume. Its own title carries the
  // same two disclosures the in-player sibling's does (shared/
  // playscenario.js's naming rule; that Reload clears breakpoints/
  // watchpoints), because the two are one action reachable from two places,
  // not two different promises.
  buttons.reloadTest = el(
    'button.btn.btn-sm',
    {
      title:
        'Rebuilds and restarts the ROM with the same test scenario. Breakpoints and watchpoints are cleared. ' +
        'The test scenario is remembered by name, and resuming follows the name.',
      onclick: () => reloadTest()
    },
    '↻ Reload Test'
  );

  function refreshReloadVisibility() {
    const scenario = app.playScenario;
    const hasScenario = Boolean(scenario && (scenario.startAt || scenario.battleTest));
    buttons.reloadTest.style.display = playHost.style.display === 'block' || !hasScenario ? 'none' : '';
  }

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '1fr 300px' } },
    el(
      'div.panel',
      { style: { borderRight: 'none' } },
      el(
        'div.toolbar',
        null,
        buttons.build,
        buttons.play,
        buttons.reloadTest,
        el('span.sep'),
        buttons.mesen,
        buttons.reveal
      ),
      logStage,
      playHost
    ),
    el('div.panel', null, el('div.panel-head', null, 'Project'), el('div.panel-body', null, summary))
  );

  container.append(root);
  write('Press Build to assemble the project into a .nes ROM.');
  renderSummary();
  refreshReloadVisibility();
  app.setMeta('Build');

  return {
    destroy() {
      destroyed = true;
      unsubscribe?.();
      emulator?.destroy?.();
      app.setMeta('');
    },
    onProjectChange: renderSummary,
    build,
    buildAndPlay,
    buildAndPlayScenario,
    reloadTest,
    openInMesen,
    /**
     * The mounted emulator, for the smoke test: whether "play from here" put
     * the player where it was asked to is a fact about engine RAM, and nothing
     * on the screen shows it.
     */
    get player() {
      return emulator;
    }
  };
}
