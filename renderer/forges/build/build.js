// Build & Play — runs the pipeline, shows what it did, and boots the result.

import { store } from '../../store.js';
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
import { parseEquates } from '../../../shared/enginesyms.js';
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

    const result = await window.forge.build.run(store.dir, store.project);
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

    lastBuild = result.value;
    buttons.mesen.disabled = false;
    buttons.reveal.disabled = false;
    write('');
    write(`Ready: ${result.value.romPath}`, 'good');
    app.setStatus(`Built ${(result.value.size / 1024).toFixed(0)} KB ROM`, 'ready');
    renderSummary();
    return result.value;
  }

  /**
   * @param {{startAt?: {screen: number, x: number, y: number, label?: string}}} [options]
   *   `startAt` is the Map Forge's "play from here": where to put the player
   *   once the ROM is running. It changes nothing about the ROM being built.
   */
  async function buildAndPlay(options = {}) {
    const result = (await build({ silent: true })) ?? lastBuild;
    if (!result) return;
    await play(result, options);
  }

  async function play(result, { startAt = null } = {}) {
    const rom = await window.forge.build.readRom(result.romPath);
    if (!rom.ok) return toast(rom.error, 'error');

    let symbols = {};
    if (result.symbolPath) {
      const loaded = await window.forge.build.readSymbols(result.symbolPath);
      if (loaded.ok) symbols = loaded.value;
    }

    // Where the engine keeps the bytes a test-play override pokes. Read out of
    // the build rather than remembered here, so it is the constants.asm that
    // assembled *this* ROM — the Code Forge can have overridden it.
    let ram = null;
    if (startAt) {
      const source = await window.forge.code.readGenerated(store.dir, 'constants.asm');
      if (source.ok) ram = parseEquates(source.value);
      else write(`Could not read the engine constants: ${source.error}`, 'warn');
    }

    logStage.style.display = 'none';
    playHost.style.display = 'block';
    clear(playHost);
    emulator?.destroy?.();
    emulator = mountPlayer(playHost, {
      rom: new Uint8Array(rom.value),
      symbols,
      ram,
      startAt,
      app,
      onExit: () => {
        emulator?.destroy?.();
        emulator = null;
        playHost.style.display = 'none';
        logStage.style.display = 'block';
      }
    });
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
            // same kind of thing rpgBlocked already checks. UNROM 512 has a
            // real medium (flash) even though this version cannot drive it
            // yet, so it stays selectable here and validateProject names the
            // temporary reason in the panel's own problem list instead of a
            // disabled option pretending the board simply cannot save.
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
  buttons.play = el('button.btn.btn-accent', { onclick: buildAndPlay }, '▶ Build & Play');
  buttons.mesen = el('button.btn', { disabled: true, onclick: openInMesen }, 'Open in Mesen');
  buttons.reveal = el(
    'button.btn',
    { disabled: true, onclick: () => lastBuild && window.forge.build.revealRom(lastBuild.romPath) },
    'Show file'
  );

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '1fr 300px' } },
    el(
      'div.panel',
      { style: { borderRight: 'none' } },
      el('div.toolbar', null, buttons.build, buttons.play, el('span.sep'), buttons.mesen, buttons.reveal),
      logStage,
      playHost
    ),
    el('div.panel', null, el('div.panel-head', null, 'Project'), el('div.panel-body', null, summary))
  );

  container.append(root);
  write('Press Build to assemble the project into a .nes ROM.');
  renderSummary();
  app.setMeta('Build');

  return {
    destroy() {
      unsubscribe?.();
      emulator?.destroy?.();
      app.setMeta('');
    },
    onProjectChange: renderSummary,
    build,
    buildAndPlay,
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
