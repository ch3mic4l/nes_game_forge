// Stand-in used by Forges that are still being built out, so the shell always
// has something honest to show instead of an empty pane.

import { el } from '../ui.js';

export function placeholder({ glyph, title, summary, planned }) {
  return {
    mount(container, app) {
      container.append(
        el(
          'div.placeholder',
          null,
          el('div.placeholder-glyph', null, glyph),
          el('h2', null, title),
          el('p', null, summary),
          planned?.length ? el('ul', null, planned.map((item) => el('li', null, item))) : null
        )
      );
      app.setStatus(`${title} — not implemented yet`, 'warn');
      return {};
    }
  };
}
