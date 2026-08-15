// Sound Forge — a tracker for the NES audio hardware.
//
// Patterns hold rows of notes per channel; the order list arranges patterns
// into a song. Preview runs the same replayer the ROM's driver agrees with, so
// pitch, rhythm and volume in here are what the cartridge will play.

import { store } from '../../store.js';
import { el, clear, fill, field, toast, confirmModal } from '../../ui.js';
import { CHANNELS, NUM_NOTES, noteName, createSong, createPattern, createInstrument, MAX_INSTRUMENTS } from '../../../shared/audio.js';
import { compileSong } from '../../../main/build/songcompile.js';
import { renumberSongDeletion } from '../../../shared/project.js';
import { Replayer } from './replayer.js';
import { Synth } from './synth.js';

// FamiTracker-style two-octave keyboard.
const KEYS = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
  KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17,
  Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23
};

export function mount(container, app) {
  const state = {
    song: 0,
    pattern: 0,
    channel: 0,
    row: 0,
    octave: 4,
    instrument: 0,
    playing: false,
    playRow: -1
  };

  const synth = new Synth();
  let replayer = null;
  let timer = null;
  let frameInPlayback = 0;

  const songs = () => store.project.songs;
  const song = () => songs()[state.song] ?? null;
  const pattern = () => song()?.patterns[state.pattern] ?? null;

  // ---------------------------------------------------------------- edits

  function editSong(label, mutate) {
    const index = state.song;
    store.commit(label, (project) => mutate(project.songs[index], project));
    render();
  }

  function setCell(row, channelId, value) {
    const patternIndex = state.pattern;
    editSong('Edit pattern', (entry) => {
      entry.patterns[patternIndex].channels[channelId][row] = value;
    });
  }

  // ------------------------------------------------------------- playback

  function stop() {
    state.playing = false;
    state.playRow = -1;
    if (timer) clearInterval(timer);
    timer = null;
    synth.silence();
    render();
  }

  async function play() {
    if (!song()) return;
    if (!(await synth.start())) {
      toast(`Sound unavailable: ${synth.failed}`, 'error');
      return;
    }
    synth.resume();

    const compiled = compileSong(song());
    replayer = new Replayer(compiled);
    frameInPlayback = 0;
    state.playing = true;

    // The engine ticks the driver once per video frame; match that here.
    timer = setInterval(() => {
      if (!state.playing) return;
      synth.apply(replayer.tick());
      frameInPlayback++;
      const framesPerRow = song().tempo.framesPerRow;
      const nextRow = Math.floor(frameInPlayback / framesPerRow);
      if (nextRow !== state.playRow) {
        state.playRow = nextRow;
        highlightPlayRow();
      }
    }, 1000 / 60);
    render();
  }

  /**
   * Work out which pattern and row the playhead is on, and light that row only
   * when the pattern being shown is the one playing.
   */
  function playPosition() {
    const current = song();
    if (!current || !current.order.length) return { pattern: -1, row: -1 };
    const lengths = current.order.map((id) => current.patterns[id]?.rows ?? 0);
    const total = lengths.reduce((sum, value) => sum + value, 0);
    if (!total) return { pattern: -1, row: -1 };

    let remaining = state.playRow % total;
    for (let slot = 0; slot < current.order.length; slot++) {
      if (remaining < lengths[slot]) return { pattern: current.order[slot], row: remaining };
      remaining -= lengths[slot];
    }
    return { pattern: -1, row: -1 };
  }

  function highlightPlayRow() {
    const position = playPosition();
    const within = position.pattern === state.pattern ? position.row : -1;
    grid.querySelectorAll('[data-row]').forEach((node) => {
      const row = Number(node.dataset.row);
      if (row === within) node.style.background = 'rgba(87,211,140,0.16)';
      else if (row !== state.row) node.style.background = '';
    });
  }

  // ------------------------------------------------------------- keyboard

  function onKeyDown(event) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '')) return;
    if (!pattern()) return;
    const channelId = CHANNELS[state.channel].id;

    if (event.code === 'ArrowDown') {
      event.preventDefault();
      state.row = Math.min(pattern().rows - 1, state.row + 1);
      return render();
    }
    if (event.code === 'ArrowUp') {
      event.preventDefault();
      state.row = Math.max(0, state.row - 1);
      return render();
    }
    if (event.code === 'ArrowRight') {
      event.preventDefault();
      state.channel = Math.min(CHANNELS.length - 1, state.channel + 1);
      return render();
    }
    if (event.code === 'ArrowLeft') {
      event.preventDefault();
      state.channel = Math.max(0, state.channel - 1);
      return render();
    }
    if (event.code === 'Delete' || event.code === 'Backspace') {
      event.preventDefault();
      setCell(state.row, channelId, null);
      state.row = Math.min(pattern().rows - 1, state.row + 1);
      return render();
    }
    if (event.code === 'Space') {
      event.preventDefault();
      return state.playing ? stop() : play();
    }

    const offset = KEYS[event.code];
    if (offset === undefined) return;
    event.preventDefault();
    const note = (state.octave + 1) * 12 + offset;
    if (note < 0 || note >= NUM_NOTES) return;
    setCell(state.row, channelId, { note, inst: state.instrument });
    state.row = Math.min(pattern().rows - 1, state.row + 1);
    render();
  }
  window.addEventListener('keydown', onKeyDown);

  // ---------------------------------------------------------------- views

  const grid = el('div', {
    style: { fontFamily: 'var(--mono)', fontSize: '12px', userSelect: 'none' }
  });
  const sidebar = el('div');
  const orderHost = el('div');

  function renderGrid() {
    clear(grid);
    const current = pattern();
    if (!current) {
      grid.append(el('p.hint', null, 'Create a song to start writing music.'));
      return;
    }

    grid.append(
      el(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: `44px repeat(${CHANNELS.length}, 1fr)`,
            gap: '1px',
            position: 'sticky',
            top: '0',
            background: 'var(--bg-1)',
            paddingBottom: '4px'
          }
        },
        el('span'),
        ...CHANNELS.map((channel, index) =>
          el(
            'button.btn.btn-sm',
            {
              class: index === state.channel ? 'active' : '',
              onclick: () => {
                state.channel = index;
                render();
              }
            },
            channel.label
          )
        )
      )
    );

    for (let row = 0; row < current.rows; row++) {
      const beat = row % 4 === 0;
      const rowNode = el(
        'div',
        {
          dataset: { row },
          style: {
            display: 'grid',
            gridTemplateColumns: `44px repeat(${CHANNELS.length}, 1fr)`,
            gap: '1px',
            background: row === state.row ? 'var(--accent-soft)' : '',
            borderTop: beat ? '1px solid var(--line-soft)' : '1px solid transparent'
          }
        },
        el(
          'span',
          { style: { color: beat ? 'var(--text-dim)' : 'var(--text-faint)', paddingLeft: '6px' } },
          row.toString().padStart(2, '0')
        ),
        ...CHANNELS.map((channel, index) => {
          const cell = current.channels[channel.id][row];
          const selected = index === state.channel && row === state.row;
          return el(
            'span',
            {
              style: {
                padding: '1px 6px',
                borderRadius: '3px',
                cursor: 'pointer',
                color: cell ? 'var(--text)' : 'var(--text-faint)',
                background: selected ? 'var(--bg-3)' : '',
                boxShadow: selected ? 'inset 0 0 0 1px var(--accent-line)' : ''
              },
              onclick: () => {
                state.row = row;
                state.channel = index;
                render();
              }
            },
            cell ? `${noteName(cell.note)} ${cell.inst}` : '--- -'
          );
        })
      );
      grid.append(rowNode);
    }
  }

  function renderSidebar() {
    const current = song();
    fill(sidebar,
      el(
        'div.field-row',
        { style: { marginBottom: '8px' } },
        el(
          'select',
          {
            onchange: (event) => {
              stop();
              state.song = Number(event.target.value);
              state.pattern = 0;
              state.row = 0;
              render();
            }
          },
          songs().length
            ? songs().map((entry, index) => el('option', { value: index, selected: index === state.song }, entry.name))
            : [el('option', null, 'No songs yet')]
        ),
        el(
          'button.btn.btn-sm',
          {
            title: 'Add a song',
            onclick: () => {
              store.commit('Add song', (project) => {
                project.songs.push(createSong(`Song ${project.songs.length}`));
              });
              state.song = songs().length - 1;
              state.pattern = 0;
              render();
            }
          },
          '+'
        ),
        el(
          'button.btn.btn-sm',
          {
            disabled: !current,
            onclick: async () => {
              if (!(await confirmModal('Delete song', `Delete "${current.name}"?`, 'Delete'))) return;
              stop();
              const index = state.song;
              store.commit('Delete song', (project) => {
                project.songs.splice(index, 1);
                renumberSongDeletion(project, index);
              });
              state.song = Math.max(0, state.song - 1);
              render();
            }
          },
          '✕'
        )
      ),
      current
        ? el(
            'div',
            null,
            field(
              'Name',
              el('input', {
                type: 'text',
                value: current.name,
                onchange: (event) =>
                  editSong('Rename song', (entry) => (entry.name = event.target.value.trim() || 'Song'))
              })
            ),
            field(
              'Frames per row',
              el('input', {
                type: 'number',
                min: 1,
                max: 31,
                value: current.tempo.framesPerRow,
                title: 'Lower is faster. 6 frames is a tenth of a second.',
                onchange: (event) => {
                  const value = Math.max(1, Math.min(31, Number(event.target.value)));
                  editSong('Change tempo', (entry) => (entry.tempo.framesPerRow = value));
                }
              })
            ),
            el(
              'div.field-row',
              null,
              field(
                'Octave',
                el('input', {
                  type: 'number',
                  min: 1,
                  max: 6,
                  value: state.octave,
                  onchange: (event) => {
                    state.octave = Math.max(1, Math.min(6, Number(event.target.value)));
                    render();
                  }
                })
              ),
              field(
                'Instrument',
                el(
                  'select',
                  { onchange: (event) => (state.instrument = Number(event.target.value)) },
                  current.instruments.map((entry, index) =>
                    el('option', { value: index, selected: index === state.instrument }, `${index} ${entry.name}`)
                  )
                )
              )
            ),
            renderInstrumentEditor(current),
            orderHost
          )
        : el('p.hint', null, 'A song is a list of patterns played in order.')
    );
    renderOrder();
  }

  function renderInstrumentEditor(current) {
    const instrument = current.instruments[state.instrument];
    if (!instrument) return el('p.hint', null, 'No instruments.');
    return el(
      'div',
      { style: { marginTop: '10px' } },
      el('div.panel-head', { style: { paddingLeft: '0' } }, 'Instrument'),
      field(
        'Name',
        el('input', {
          type: 'text',
          value: instrument.name,
          onchange: (event) =>
            editSong('Rename instrument', (entry) => {
              entry.instruments[state.instrument].name = event.target.value.trim() || 'Instrument';
            })
        })
      ),
      field(
        'Duty cycle',
        el(
          'select',
          {
            onchange: (event) => {
              const value = Number(event.target.value);
              editSong('Change duty', (entry) => (entry.instruments[state.instrument].duty = value));
            }
          },
          ['12.5% (thin)', '25%', '50% (square)', '75%'].map((label, index) =>
            el('option', { value: index, selected: index === instrument.duty }, label)
          )
        )
      ),
      field(
        `Volume envelope (${instrument.volEnv.join(' ')})`,
        el('input', {
          type: 'text',
          value: instrument.volEnv.join(' '),
          title: 'Volumes 0-15, one per frame. The last value holds.',
          onchange: (event) => {
            const values = event.target.value
              .split(/[\s,]+/)
              .map((token) => Number(token))
              .filter((value) => Number.isFinite(value))
              .slice(0, 16)
              .map((value) => Math.max(0, Math.min(15, Math.round(value))));
            if (!values.length) return render();
            editSong('Change envelope', (entry) => {
              entry.instruments[state.instrument].volEnv = values;
              entry.instruments[state.instrument].sustain = values.length - 1;
            });
          }
        })
      ),
      el(
        'button.btn.btn-sm',
        {
          disabled: current.instruments.length >= MAX_INSTRUMENTS,
          onclick: () =>
            editSong('Add instrument', (entry) => {
              entry.instruments.push(createInstrument(entry.instruments.length));
            })
        },
        '+ Add instrument'
      ),
      el(
        'p.hint',
        { style: { marginTop: '8px' } },
        'The triangle channel ignores duty and volume — the NES gives it neither.'
      )
    );
  }

  function renderOrder() {
    const current = song();
    clear(orderHost);
    if (!current) return;
    orderHost.append(
      el('div.panel-head', { style: { paddingLeft: '0', marginTop: '12px' } }, 'Order'),
      el(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' } },
        current.order.map((patternId, index) =>
          el(
            'button.btn.btn-sm',
            {
              class: patternId === state.pattern ? 'active' : '',
              title: `Position ${index} — pattern ${patternId}${index === current.loop ? ', loops from here' : ''}`,
              style: index === current.loop ? { borderColor: 'var(--green)' } : null,
              onclick: () => {
                state.pattern = patternId;
                state.row = 0;
                render();
              }
            },
            String(patternId)
          )
        )
      ),
      el(
        'div.button-row',
        null,
        el(
          'button.btn.btn-sm',
          {
            onclick: () =>
              editSong('Add pattern', (entry) => {
                entry.patterns.push(createPattern(entry.patterns.length));
                entry.order.push(entry.patterns.length - 1);
              })
          },
          '+ Pattern'
        ),
        el(
          'button.btn.btn-sm',
          {
            disabled: current.order.length <= 1,
            onclick: () => editSong('Remove from order', (entry) => entry.order.pop())
          },
          '− Order slot'
        )
      ),
      field(
        'Loop from position',
        el('input', {
          type: 'number',
          min: 0,
          max: Math.max(0, current.order.length - 1),
          value: current.loop,
          onchange: (event) => {
            const value = Math.max(0, Math.min(current.order.length - 1, Number(event.target.value)));
            editSong('Change loop point', (entry) => (entry.loop = value));
          }
        })
      )
    );
  }

  function render() {
    renderGrid();
    renderSidebar();
    transport.textContent = state.playing ? '⏸ Stop' : '▶ Play';
  }

  const transport = el('span', null, '▶ Play');
  const playButton = el(
    'button.btn.btn-accent',
    { onclick: () => (state.playing ? stop() : play()) },
    transport
  );

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '1fr 320px' } },
    el(
      'div.panel',
      { style: { borderRight: 'none' } },
      el(
        'div.toolbar',
        null,
        playButton,
        el('span.sep'),
        el(
          'p.hint',
          { style: { margin: '0' } },
          'Z–M and Q–U play notes · arrows move · Delete clears · Space plays'
        )
      ),
      el('div.panel-body', { style: { background: 'var(--bg-0)' } }, grid)
    ),
    el('div.panel', null, el('div.panel-head', null, 'Song'), el('div.panel-body', null, sidebar))
  );

  container.append(root);
  render();
  app.setMeta('Sound Forge');

  return {
    destroy() {
      stop();
      synth.destroy();
      window.removeEventListener('keydown', onKeyDown);
      app.setMeta('');
    },
    onProjectChange() {
      if (state.song >= songs().length) state.song = Math.max(0, songs().length - 1);
      const current = song();
      if (current && state.pattern >= current.patterns.length) state.pattern = 0;
      render();
    }
  };
}
