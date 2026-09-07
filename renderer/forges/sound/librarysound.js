// Starter-library import for the Sound Forge (design-starter-library.md
// §10): a picker with no palette step at all -- neither sfx nor song
// touches a tileset or a palette -- each row's own ▶ Preview button plays
// the entry's OWN raw `sfx`/`song` object through the Forge's existing
// synth/replayer (sound.js's own `play`/`playSfx`, refactored to take an
// optional raw entry rather than a second player).

import { el } from '../../ui.js';
import { runLibraryImport } from '../../widgets/librarypicker.js';
import { SFX_ENTRIES } from '../../../shared/library/sfx/index.js';
import { SONG_ENTRIES } from '../../../shared/library/song/index.js';

function previewRow(onPreview) {
  return { node: el('button.btn.btn-sm', { onclick: onPreview }, '▶ Preview') };
}

export async function openLibrarySongImport(state, render, play, stop) {
  // Two different reasons to stop, not one: on dismissal (plan null), only
  // what THIS picker itself started -- a song the author already had
  // playing before opening the picker must survive a plain Cancel/Escape,
  // so previewed gates that path. On a SUCCESSFUL import, though, stop is
  // unconditional even if Preview was never clicked: state.song is about to
  // point at the newly imported song, and the OLD selection's own timer
  // (play()'s own ownSelection captured at start) would otherwise keep
  // calling highlightPlayRow against a pattern grid state.song no longer
  // names, and the transport would keep reading "⏸ Stop" for a song that,
  // from the author's own view, was just replaced by the import.
  let previewed = false;
  const plan = await runLibraryImport({
    title: 'Import a song from the library',
    entries: SONG_ENTRIES,
    tileTable: null,
    renderListPreview: (entry) =>
      previewRow(() => {
        previewed = true;
        play(entry.song);
      })
  });
  if (plan || previewed) stop();
  if (!plan) return;
  state.song = plan.report.id;
  render();
}

export async function openLibraryEffectImport(state, render, playSfx, stopSfx) {
  // See openLibrarySongImport's own comment above -- identical reasoning.
  let previewed = false;
  const plan = await runLibraryImport({
    title: 'Import a sound effect from the library',
    entries: SFX_ENTRIES,
    tileTable: null,
    renderListPreview: (entry) =>
      previewRow(() => {
        previewed = true;
        playSfx(entry.sfx);
      })
  });
  if (plan || previewed) stopSfx();
  if (!plan) return;
  state.effect = plan.report.id;
  render();
}
