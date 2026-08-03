// Sprite Forge — assemble metasprites from sprite tiles, animate them, and
// bind those animations to the actors the Map Forge places.

import { store } from '../../store.js';
import { el, fill, field, toast, confirmModal, fitZoom, observeSize } from '../../ui.js';
import { tileFromString, flipTile } from '../../../shared/chr.js';
import { NES_PALETTE, cssColor } from '../../../shared/nespalette.js';
import {
  LIMITS,
  BEHAVIORS,
  ANIM_SLOTS,
  ELEMENTS,
  RPG_LIMITS,
  tilesetAt
} from '../../../shared/project.js';
import { battleSection, partyPanel } from './battle.js';
import { drawSheet, sheetIndexFromEvent } from '../../widgets/sheet.js';

// The canvas shows a 64x64 window with the actor's origin inset, so tiles placed
// at negative offsets are still visible.
const VIEW = 64;
const ORIGIN = 16;

export function mount(container, app) {
  const state = {
    tab: 'metasprites',
    metasprite: 0,
    tile: 0,
    animation: 0,
    frame: 0,
    actor: 0,
    sheetTile: 0,
    previewTime: 0,
    previewFrame: 0,
    playing: true,
    // Which tileset's sprite table is on screen. Metasprites store tile indices,
    // so the same metasprite reads against whichever CHR bank a map banks in.
    tilesetId: 0
  };
  let decoded = [];
  let raf = null;

  const sprites = () => store.project.sprites;
  const palettes = () => store.project.palettes.sprite;

  const spriteTable = () => tilesetAt(store.project, state.tilesetId).sprites.tiles;

  function syncTiles() {
    if (state.tilesetId >= store.project.tilesets.length) state.tilesetId = 0;
    decoded = spriteTable().map(tileFromString);
  }

  // ------------------------------------------------------------ rendering

  /** Paint a metasprite into an ImageData at a given origin. */
  function paintMetasprite(data, width, metasprite, originX, originY) {
    if (!metasprite) return;
    for (const entry of metasprite.tiles) {
      let pixels = decoded[entry.tile] ?? decoded[0];
      if (entry.hflip || entry.vflip) pixels = flipTile(pixels, entry.hflip, entry.vflip);
      const colors = palettes()[entry.palette].map((index) => NES_PALETTE[index & 0x3f]);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const slot = pixels[y * 8 + x];
          if (slot === 0) continue; // sprite slot 0 is transparent
          const px = originX + entry.x + x;
          const py = originY + entry.y + y;
          if (px < 0 || py < 0 || px >= width || py >= width) continue;
          const color = colors[slot];
          const offset = (py * width + px) * 4;
          data[offset] = color[0];
          data[offset + 1] = color[1];
          data[offset + 2] = color[2];
          data[offset + 3] = 255;
        }
      }
    }
  }

  // No zoom control: the editor is always as large as its stage allows, so a
  // bigger window is a bigger drawing area.
  function drawPreview(canvas, metasprite, { showGuides = false } = {}) {
    const zoom = fitZoom(editStage, VIEW, VIEW, { min: 2 });
    canvas.width = VIEW;
    canvas.height = VIEW;
    canvas.style.width = `${VIEW * zoom}px`;
    canvas.style.height = `${VIEW * zoom}px`;
    const context = canvas.getContext('2d');
    const image = context.createImageData(VIEW, VIEW);
    paintMetasprite(image.data, VIEW, metasprite, ORIGIN, ORIGIN);
    context.putImageData(image, 0, 0);
    if (!showGuides) return;

    const overlayContext = overlay.getContext('2d');
    overlay.width = VIEW * zoom;
    overlay.height = VIEW * zoom;
    overlay.style.width = `${VIEW * zoom}px`;
    overlay.style.height = `${VIEW * zoom}px`;
    overlayContext.clearRect(0, 0, overlay.width, overlay.height);
    overlayContext.strokeStyle = 'rgba(255,255,255,0.07)';
    overlayContext.lineWidth = 1;
    overlayContext.beginPath();
    for (let i = 8; i < VIEW; i += 8) {
      overlayContext.moveTo(i * zoom + 0.5, 0);
      overlayContext.lineTo(i * zoom + 0.5, overlay.height);
      overlayContext.moveTo(0, i * zoom + 0.5);
      overlayContext.lineTo(overlay.width, i * zoom + 0.5);
    }
    overlayContext.stroke();

    // The 16x16 box the engine treats as the actor's footprint.
    overlayContext.strokeStyle = 'rgba(77,163,255,0.6)';
    overlayContext.lineWidth = 2;
    overlayContext.strokeRect(ORIGIN * zoom, ORIGIN * zoom, 16 * zoom, 16 * zoom);

    const metaspriteTiles = metasprite?.tiles ?? [];
    metaspriteTiles.forEach((entry, index) => {
      overlayContext.strokeStyle = index === state.tile ? '#ff9d3c' : 'rgba(255,255,255,0.28)';
      overlayContext.lineWidth = index === state.tile ? 2 : 1;
      overlayContext.strokeRect(
        (ORIGIN + entry.x) * zoom + 1,
        (ORIGIN + entry.y) * zoom + 1,
        8 * zoom - 2,
        8 * zoom - 2
      );
    });
  }

  // -------------------------------------------------------------- editing

  const currentMetasprite = () => sprites().metasprites[state.metasprite] ?? null;
  const currentAnimation = () => sprites().animations[state.animation] ?? null;
  const currentActor = () => sprites().actors[state.actor] ?? null;

  function editMetasprite(label, mutate) {
    const index = state.metasprite;
    store.commit(label, (project) => mutate(project.sprites.metasprites[index], project));
    render();
  }

  function addMetasprite() {
    store.commit('Add metasprite', (project) => {
      const id = project.sprites.metasprites.length;
      project.sprites.metasprites.push({
        id,
        name: `Metasprite ${id}`,
        tiles: [
          { x: 0, y: 0, tile: state.sheetTile, palette: 0, hflip: false, vflip: false },
          { x: 8, y: 0, tile: state.sheetTile + 1, palette: 0, hflip: false, vflip: false },
          { x: 0, y: 8, tile: state.sheetTile + 2, palette: 0, hflip: false, vflip: false },
          { x: 8, y: 8, tile: state.sheetTile + 3, palette: 0, hflip: false, vflip: false }
        ]
      });
    });
    state.metasprite = sprites().metasprites.length - 1;
    state.tile = 0;
    render();
  }

  // ------------------------------------------------------------- controls

  const sheetCanvas = el('canvas.sheet', { style: { cursor: 'crosshair' } });
  const editCanvas = el('canvas.pixels');
  const overlay = el('canvas', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
  const editStage = el(
    'div.canvas-stage',
    null,
    el('div', { style: { position: 'relative', lineHeight: '0' } }, editCanvas, overlay)
  );
  const previewCanvas = el('canvas.pixels');
  const listHost = el('div');
  const detailHost = el('div');
  const tabsHost = el('div.tabs');
  // The Party tab's editor. It swaps in for the canvas stage: party cards are
  // forms, and forms belong in the wide pane, not squeezed into the right rail.
  const partyHost = el('div.panel-body', { style: { overflow: 'auto', display: 'none' } });

  sheetCanvas.addEventListener('pointerdown', (event) => {
    state.sheetTile = sheetIndexFromEvent(event, sheetCanvas);
    if (state.tab === 'metasprites' && currentMetasprite()?.tiles[state.tile]) {
      const tileIndex = state.tile;
      const chosen = state.sheetTile;
      editMetasprite('Change sprite tile', (metasprite) => {
        metasprite.tiles[tileIndex].tile = chosen;
      });
    } else {
      render();
    }
  });

  // Click to select a tile in the metasprite, drag to move it.
  let dragging = null;
  editCanvas.addEventListener('pointerdown', (event) => {
    const metasprite = currentMetasprite();
    if (!metasprite) return;
    const rect = editCanvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * VIEW) - ORIGIN;
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * VIEW) - ORIGIN;
    const hit = metasprite.tiles.findIndex(
      (entry) => x >= entry.x && x < entry.x + 8 && y >= entry.y && y < entry.y + 8
    );
    if (hit < 0) return;
    state.tile = hit;
    dragging = { grabX: x - metasprite.tiles[hit].x, grabY: y - metasprite.tiles[hit].y, moved: false };
    editCanvas.setPointerCapture(event.pointerId);
    render();
  });

  editCanvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = editCanvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * VIEW) - ORIGIN;
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * VIEW) - ORIGIN;
    // Free positioning with Alt; otherwise snap to the 8-pixel sprite grid.
    const snap = event.altKey ? 1 : 8;
    const nextX = Math.round((x - dragging.grabX) / snap) * snap;
    const nextY = Math.round((y - dragging.grabY) / snap) * snap;
    const metasprite = currentMetasprite();
    const entry = metasprite.tiles[state.tile];
    if (entry.x === nextX && entry.y === nextY) return;
    if (!dragging.moved) {
      store.beginStroke('Move sprite tile');
      dragging.moved = true;
    }
    entry.x = Math.max(-64, Math.min(64, nextX));
    entry.y = Math.max(-64, Math.min(64, nextY));
    render();
  });

  const endDrag = () => {
    if (dragging?.moved) store.endStroke();
    dragging = null;
  };
  editCanvas.addEventListener('pointerup', endDrag);
  editCanvas.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- panes

  function renderMetaspritePane() {
    const metasprite = currentMetasprite();
    fill(listHost,
      el(
        'div.field-row',
        { style: { marginBottom: '8px' } },
        el(
          'select',
          {
            onchange: (event) => {
              state.metasprite = Number(event.target.value);
              state.tile = 0;
              render();
            }
          },
          sprites().metasprites.length
            ? sprites().metasprites.map((entry, index) =>
                el('option', { value: index, selected: index === state.metasprite }, entry.name)
              )
            : [el('option', null, 'No metasprites yet')]
        ),
        el('button.btn.btn-sm', { title: 'Add a 16x16 metasprite', onclick: addMetasprite }, '+'),
        el(
          'button.btn.btn-sm',
          {
            title: 'Delete',
            disabled: !metasprite,
            onclick: async () => {
              if (!(await confirmModal('Delete metasprite', `Delete "${metasprite.name}"?`, 'Delete'))) return;
              const index = state.metasprite;
              store.commit('Delete metasprite', (project) => {
                project.sprites.metasprites.splice(index, 1);
                project.sprites.metasprites.forEach((entry, position) => (entry.id = position));
              });
              state.metasprite = Math.max(0, state.metasprite - 1);
              render();
            }
          },
          '✕'
        )
      ),
      metasprite
        ? el(
            'div',
            null,
            field(
              'Name',
              el('input', {
                type: 'text',
                value: metasprite.name,
                onchange: (event) => {
                  const value = event.target.value.trim() || `Metasprite ${state.metasprite}`;
                  editMetasprite('Rename metasprite', (entry) => (entry.name = value));
                }
              })
            ),
            el('div.field-label', null, `Tiles (${metasprite.tiles.length} / ${LIMITS.metaspriteTiles})`),
            el(
              'div',
              { style: { maxHeight: '190px', overflowY: 'auto', margin: '4px 0 8px' } },
              metasprite.tiles.map((entry, index) =>
                el(
                  'div.field-row',
                  {
                    style: {
                      padding: '2px 4px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background: index === state.tile ? 'var(--accent-soft)' : null
                    },
                    onclick: () => {
                      state.tile = index;
                      render();
                    }
                  },
                  el('span', { style: { fontFamily: 'var(--mono)', fontSize: '11px', flex: '1' } },
                    `$${entry.tile.toString(16).padStart(2, '0').toUpperCase()} @ ${entry.x},${entry.y}`),
                  el('span', {
                    style: {
                      width: '14px',
                      height: '14px',
                      borderRadius: '3px',
                      background: cssColor(palettes()[entry.palette][1]),
                      border: '1px solid var(--line)'
                    }
                  }),
                  el(
                    'button.btn.btn-sm',
                    {
                      title: 'Remove this tile',
                      onclick: (event) => {
                        event.stopPropagation();
                        editMetasprite('Remove sprite tile', (ms) => ms.tiles.splice(index, 1));
                        state.tile = 0;
                      }
                    },
                    '✕'
                  )
                )
              )
            ),
            el(
              'button.btn.btn-sm',
              {
                disabled: metasprite.tiles.length >= LIMITS.metaspriteTiles,
                onclick: () =>
                  editMetasprite('Add sprite tile', (ms) => {
                    ms.tiles.push({ x: 0, y: 0, tile: state.sheetTile, palette: 0, hflip: false, vflip: false });
                  })
              },
              '+ Add tile from the sheet'
            )
          )
        : el('p.hint', null, 'Create a metasprite to start placing tiles.')
    );

    const entry = metasprite?.tiles[state.tile];
    fill(detailHost,
      entry
        ? el(
            'div',
            null,
            el('div.panel-head', { style: { paddingLeft: '0' } }, 'Selected tile'),
            field(
              'Palette',
              el(
                'select',
                {
                  onchange: (event) => {
                    const value = Number(event.target.value);
                    const index = state.tile;
                    editMetasprite('Change sprite palette', (ms) => (ms.tiles[index].palette = value));
                  }
                },
                [0, 1, 2, 3].map((index) =>
                  el('option', { value: index, selected: index === entry.palette }, `Sprite palette ${index}`)
                )
              )
            ),
            el(
              'div.field-row',
              null,
              el(
                'label.check',
                null,
                el('input', {
                  type: 'checkbox',
                  checked: entry.hflip,
                  onchange: (event) => {
                    const value = event.target.checked;
                    const index = state.tile;
                    editMetasprite('Flip sprite tile', (ms) => (ms.tiles[index].hflip = value));
                  }
                }),
                'Flip ↔'
              ),
              el(
                'label.check',
                null,
                el('input', {
                  type: 'checkbox',
                  checked: entry.vflip,
                  onchange: (event) => {
                    const value = event.target.checked;
                    const index = state.tile;
                    editMetasprite('Flip sprite tile', (ms) => (ms.tiles[index].vflip = value));
                  }
                }),
                'Flip ↕'
              )
            ),
            el('p.hint', null, 'Drag a tile on the canvas to move it. Hold Alt for single-pixel steps.')
          )
        : el('p.hint', null, 'Select a tile to change its palette or flip it.')
    );

    drawPreview(editCanvas, metasprite, { showGuides: true });
  }

  function renderAnimationPane() {
    const animation = currentAnimation();
    fill(listHost,
      el(
        'div.field-row',
        { style: { marginBottom: '8px' } },
        el(
          'select',
          {
            onchange: (event) => {
              state.animation = Number(event.target.value);
              state.frame = 0;
              render();
            }
          },
          sprites().animations.length
            ? sprites().animations.map((entry, index) =>
                el('option', { value: index, selected: index === state.animation }, entry.name)
              )
            : [el('option', null, 'No animations yet')]
        ),
        el(
          'button.btn.btn-sm',
          {
            onclick: () => {
              store.commit('Add animation', (project) => {
                const id = project.sprites.animations.length;
                project.sprites.animations.push({
                  id,
                  name: `Animation ${id}`,
                  loop: true,
                  frames: project.sprites.metasprites.length ? [{ metaspriteId: 0, duration: 12 }] : []
                });
              });
              state.animation = sprites().animations.length - 1;
              render();
            }
          },
          '+'
        ),
        el(
          'button.btn.btn-sm',
          {
            disabled: !animation,
            onclick: async () => {
              if (!(await confirmModal('Delete animation', `Delete "${animation.name}"?`, 'Delete'))) return;
              const index = state.animation;
              store.commit('Delete animation', (project) => {
                project.sprites.animations.splice(index, 1);
                project.sprites.animations.forEach((entry, position) => (entry.id = position));
              });
              state.animation = Math.max(0, state.animation - 1);
              render();
            }
          },
          '✕'
        )
      ),
      animation
        ? el(
            'div',
            null,
            field(
              'Name',
              el('input', {
                type: 'text',
                value: animation.name,
                onchange: (event) => {
                  const value = event.target.value.trim() || `Animation ${state.animation}`;
                  const index = state.animation;
                  store.commit('Rename animation', (project) => (project.sprites.animations[index].name = value));
                  render();
                }
              })
            ),
            el('div.field-label', null, `Frames (${animation.frames.length})`),
            el(
              'div',
              { style: { maxHeight: '200px', overflowY: 'auto', margin: '4px 0 8px' } },
              animation.frames.map((frame, index) =>
                el(
                  'div.field-row',
                  { style: { marginBottom: '3px' } },
                  el(
                    'select',
                    {
                      style: { flex: '1' },
                      onchange: (event) => {
                        const value = Number(event.target.value);
                        const animIndex = state.animation;
                        store.commit('Change frame', (project) => {
                          project.sprites.animations[animIndex].frames[index].metaspriteId = value;
                        });
                        render();
                      }
                    },
                    sprites().metasprites.map((entry, msIndex) =>
                      el('option', { value: msIndex, selected: msIndex === frame.metaspriteId }, entry.name)
                    )
                  ),
                  el('input', {
                    type: 'number',
                    min: 1,
                    max: 255,
                    value: frame.duration,
                    style: { width: '64px' },
                    title: 'How many frames this lasts',
                    onchange: (event) => {
                      const value = Math.max(1, Math.min(255, Number(event.target.value)));
                      const animIndex = state.animation;
                      store.commit('Change frame length', (project) => {
                        project.sprites.animations[animIndex].frames[index].duration = value;
                      });
                      render();
                    }
                  }),
                  el(
                    'button.btn.btn-sm',
                    {
                      onclick: () => {
                        const animIndex = state.animation;
                        store.commit('Remove frame', (project) => {
                          project.sprites.animations[animIndex].frames.splice(index, 1);
                        });
                        render();
                      }
                    },
                    '✕'
                  )
                )
              )
            ),
            el(
              'button.btn.btn-sm',
              {
                disabled: !sprites().metasprites.length || animation.frames.length >= LIMITS.animationFrames,
                onclick: () => {
                  const index = state.animation;
                  store.commit('Add frame', (project) => {
                    project.sprites.animations[index].frames.push({ metaspriteId: 0, duration: 12 });
                  });
                  render();
                }
              },
              '+ Add frame'
            )
          )
        : el('p.hint', null, 'Animations play a list of metasprites, each for a number of frames.')
    );

    fill(detailHost,
      el('div.panel-head', { style: { paddingLeft: '0' } }, 'Preview'),
      el('div', { style: { display: 'flex', justifyContent: 'center', padding: '8px 0' } }, previewCanvas),
      el(
        'label.check',
        null,
        el('input', {
          type: 'checkbox',
          checked: state.playing,
          onchange: (event) => (state.playing = event.target.checked)
        }),
        'Play'
      ),
      el('p.hint', null, 'The engine advances an actor’s animation exactly like this preview.')
    );

    const metasprite = animation?.frames.length
      ? sprites().metasprites[animation.frames[state.previewFrame % animation.frames.length]?.metaspriteId]
      : null;
    drawPreview(editCanvas, metasprite, { showGuides: true });
    drawPreviewOnly(previewCanvas, metasprite);
  }

  function drawPreviewOnly(canvas, metasprite) {
    const zoom = 4;
    canvas.width = VIEW;
    canvas.height = VIEW;
    canvas.style.width = `${VIEW * zoom}px`;
    canvas.style.height = `${VIEW * zoom}px`;
    const context = canvas.getContext('2d');
    const image = context.createImageData(VIEW, VIEW);
    paintMetasprite(image.data, VIEW, metasprite, ORIGIN, ORIGIN);
    context.putImageData(image, 0, 0);
  }

  function renderActorPane() {
    const actor = currentActor();
    fill(listHost,
      el(
        'div.field-row',
        { style: { marginBottom: '8px' } },
        el(
          'select',
          {
            onchange: (event) => {
              state.actor = Number(event.target.value);
              render();
            }
          },
          sprites().actors.length
            ? sprites().actors.map((entry, index) =>
                el('option', { value: index, selected: index === state.actor }, entry.name)
              )
            : [el('option', null, 'No actors yet')]
        ),
        el(
          'button.btn.btn-sm',
          {
            onclick: () => {
              store.commit('Add actor', (project) => {
                const id = project.sprites.actors.length;
                const anims = {};
                for (const { id } of ANIM_SLOTS) anims[id] = null;
                if (project.sprites.animations.length) anims.idle = 0;
                project.sprites.actors.push({
                  id,
                  name: `Actor ${id}`,
                  behavior: 'patroller',
                  speed: 1,
                  hp: 1,
                  anims
                });
              });
              state.actor = sprites().actors.length - 1;
              render();
            }
          },
          '+'
        ),
        el(
          'button.btn.btn-sm',
          {
            disabled: !actor,
            onclick: async () => {
              if (
                !(await confirmModal(
                  'Delete actor',
                  `Delete "${actor.name}"? Anywhere it was placed on a map will be cleared too.`,
                  'Delete'
                ))
              ) {
                return;
              }
              const index = state.actor;
              store.commit('Delete actor', (project) => {
                project.sprites.actors.splice(index, 1);
                project.sprites.actors.forEach((entry, position) => (entry.id = position));
                // Placed copies would otherwise point past the end of the table.
                for (const map of project.maps) {
                  for (const screen of map.screens) {
                    screen.entities = screen.entities
                      .filter((entity) => entity.actorId !== index)
                      .map((entity) => ({
                        ...entity,
                        actorId: entity.actorId > index ? entity.actorId - 1 : entity.actorId
                      }));
                  }
                }
              });
              state.actor = Math.max(0, state.actor - 1);
              render();
            }
          },
          '✕'
        )
      ),
      actor
        ? el(
            'div',
            null,
            field(
              'Name',
              el('input', {
                type: 'text',
                value: actor.name,
                onchange: (event) => updateActor('Rename actor', 'name', event.target.value.trim() || `Actor ${state.actor}`)
              })
            ),
            field(
              'Behaviour',
              el(
                'select',
                { onchange: (event) => updateActor('Change behaviour', 'behavior', event.target.value) },
                BEHAVIORS.map((entry) =>
                  el('option', { value: entry.id, selected: entry.id === actor.behavior }, entry.label)
                )
              )
            ),
            el(
              'div.field-row',
              null,
              field(
                'Speed',
                el('input', {
                  type: 'number',
                  min: 1,
                  max: 8,
                  value: actor.speed,
                  onchange: (event) => updateActor('Change speed', 'speed', Number(event.target.value))
                })
              ),
              field(
                'Hit points',
                el('input', {
                  type: 'number',
                  min: 1,
                  max: 255,
                  value: actor.hp,
                  onchange: (event) => updateActor('Change hit points', 'hp', Number(event.target.value))
                })
              ),
              field(
                'Contact damage',
                el('input', {
                  type: 'number',
                  min: 0,
                  max: 6,
                  value: actor.damage ?? 0,
                  onchange: (event) => updateActor('Change contact damage', 'damage', Number(event.target.value))
                })
              )
            ),
            el(
              'p.hint',
              { style: { marginBottom: '10px' } },
              (actor.damage ?? 0) > 0
                ? `Touching this costs the player ${actor.damage} heart${actor.damage === 1 ? '' : 's'}, ` +
                  'and turns the health bar on for the whole game.'
                : 'Harmless. A game where nothing does damage shows no health bar and spends no tiles on one.'
            ),
            ...ANIM_SLOTS.map(({ id: slot, label }) =>
              field(
                label,
                el(
                  'select',
                  {
                    onchange: (event) => {
                      const raw = event.target.value;
                      const value = raw === '' ? null : Number(raw);
                      const index = state.actor;
                      store.commit('Change actor animation', (project) => {
                        project.sprites.actors[index].anims[slot] = value;
                      });
                      render();
                    }
                  },
                  el(
                    'option',
                    { value: '', selected: (actor.anims[slot] ?? null) === null },
                    slot === 'idle' ? 'None' : 'Fall back to idle'
                  ),
                  sprites().animations.map((entry, index) =>
                    el('option', { value: index, selected: index === actor.anims[slot] }, entry.name)
                  )
                )
              )
            ),
            el(
              'p.hint',
              null,
              'An actor draws the animation for whichever way it is facing, and a slot left empty ',
              'falls back to idle — so one animation is enough to get started. Left and right share ',
              'a slot; flip the metasprite to face the other way.'
            ),
            // Only an RPG has battles to carry stats into, so only an RPG is
            // offered the fields for them.
            store.project.project.gameType === 'rpg'
              ? battleSection(actor, state.actor, () => render())
              : null
          )
        : el('p.hint', null, 'Actors are what the Map Forge places on a screen.')
    );

    const animation = actor && actor.anims.idle !== null ? sprites().animations[actor.anims.idle] : null;
    const metasprite = animation?.frames.length
      ? sprites().metasprites[animation.frames[state.previewFrame % animation.frames.length]?.metaspriteId]
      : null;

    fill(detailHost,
      el('div.panel-head', { style: { paddingLeft: '0' } }, 'Behaviour'),
      el('p.hint', null, describeBehavior(actor?.behavior))
    );
    drawPreview(editCanvas, metasprite, { showGuides: true });
  }

  function updateActor(label, key, value) {
    const index = state.actor;
    store.commit(label, (project) => {
      project.sprites.actors[index][key] = value;
    });
    render();
  }

  function describeBehavior(id) {
    switch (id) {
      case 'player':
        return 'Marks this actor as the player. The player is spawned from the Map Forge start position rather than placed.';
      case 'patroller':
        return 'Walks in a straight line and reverses when it meets a wall or the edge of the screen.';
      case 'chaser':
        return 'Steps towards the player on each axis, so walls deflect it rather than stop it.';
      case 'pickup':
        return 'Disappears when the player touches it, counts towards the pickup total and goes into the bag.';
      case 'door':
        return 'Warps the player to the screen and position set on each placement in the Map Forge.';
      case 'npc':
        return 'Stays where it is placed and only animates. Use it for people to talk to, chests and scenery.';
      default:
        return 'Select an actor to see what its behaviour does.';
    }
  }

  function renderPartyPane() {
    fill(partyHost, partyPanel(() => render()));
    fill(listHost,
      el('div.panel-head', { style: { paddingLeft: '0' } }, 'Party'),
      el(
        'p.hint',
        null,
        'Members, growth and learned spells are edited in the middle pane. Only the first member walks ' +
          'the field — the rest join through an event’s “Party member joins” command.'
      )
    );
    fill(detailHost);
  }

  // ---------------------------------------------------------------- shell

  function renderTabs() {
    fill(tabsHost,
      // The Party tab only exists for a turn-based RPG, because that is the only
      // game type that has a party.
      ...[
        ['metasprites', 'Metasprites'],
        ['animations', 'Animations'],
        ['actors', 'Actors'],
        ...(store.project.project.gameType === 'rpg' ? [['party', 'Party']] : [])
      ].map(([id, label]) =>
        el(
          'button.tab',
          {
            class: state.tab === id ? 'active' : '',
            onclick: () => {
              state.tab = id;
              render();
            }
          },
          label
        )
      ),
      // Only worth the space once a cartridge can actually hold more than one.
      store.project.tilesets.length > 1
        ? el(
            'label.field-row',
            { style: { marginLeft: 'auto', gap: '6px' } },
            el('span.field-label', null, 'Tileset'),
            el(
              'select.input',
              {
                onchange: (event) => {
                  state.tilesetId = Number(event.target.value);
                  syncTiles();
                  render();
                }
              },
              store.project.tilesets.map((tileset, index) =>
                el('option', { value: index, selected: index === state.tilesetId }, tileset.name)
              )
            )
          )
        : null
    );
  }

  function render() {
    renderTabs();
    drawSheet(sheetCanvas, spriteTable(), palettes()[0], 2, {
      transparentZero: true,
      selected: state.sheetTile
    });
    const party = state.tab === 'party';
    editStage.style.display = party ? 'none' : '';
    partyHost.style.display = party ? '' : 'none';
    if (state.tab === 'metasprites') renderMetaspritePane();
    else if (state.tab === 'animations') renderAnimationPane();
    else if (party) renderPartyPane();
    else renderActorPane();
  }

  // Drive the animation preview off the same clock the engine uses: one step
  // per displayed frame, honouring each frame's duration.
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!state.playing) return;
    const animation = state.tab === 'actors'
      ? (currentActor()?.anims.idle ?? null) !== null
        ? sprites().animations[currentActor().anims.idle]
        : null
      : currentAnimation();
    if (!animation?.frames.length) return;
    state.previewTime++;
    const current = animation.frames[state.previewFrame % animation.frames.length];
    if (state.previewTime >= current.duration) {
      state.previewTime = 0;
      state.previewFrame = (state.previewFrame + 1) % animation.frames.length;
      if (state.tab !== 'metasprites') render();
    }
  }

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '292px 1fr 280px' } },
    el(
      'div.panel',
      null,
      el('div.panel-head', null, 'Sprite tiles'),
      el(
        'div.panel-body.tight',
        null,
        el('div.sheet-wrap', null, sheetCanvas),
        el(
          'p.hint',
          { style: { marginTop: '8px' } },
          'Draw these in the Tile Forge’s Sprites tab. Click one to use it for the selected metasprite tile.'
        )
      )
    ),
    el(
      'div.panel',
      { style: { borderRight: 'none' } },
      tabsHost,
      editStage,
      partyHost
    ),
    el('div.panel', null, el('div.panel-head', null, 'Sprite Forge'), el('div.panel-body', null, listHost, detailHost))
  );

  container.append(root);
  syncTiles();
  render();
  raf = requestAnimationFrame(loop);
  const stopWatchingStage = observeSize(editStage, render);
  app.setMeta('Sprite Forge');

  return {
    destroy() {
      stopWatchingStage();
      if (raf) cancelAnimationFrame(raf);
      app.setMeta('');
    },
    onProjectChange() {
      syncTiles();
      if (state.metasprite >= sprites().metasprites.length) state.metasprite = 0;
      if (state.animation >= sprites().animations.length) state.animation = 0;
      if (state.actor >= sprites().actors.length) state.actor = 0;
      render();
    }
  };
}
