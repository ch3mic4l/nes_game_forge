// A small code editor: line-number gutter, a highlighted layer, and a transparent
// textarea on top of it.
//
// Why hand-rolled rather than a library: the app ships no runtime dependencies
// and no bundler, which rules out the usual editors. The trade is deliberate —
// this handles the cases a 6502 source file actually presents (no wrapping, no
// folding, no autocomplete) and nothing else.
//
// The three layers must agree on metrics *exactly* or the caret drifts from the
// text under it: same font, size, line height, padding and tab size, set in one
// place in app.css. The textarea is the only scroller; the other two follow it.

import { el, fill } from '../../ui.js';
import { highlightLine } from './highlight.js';

/**
 * `onChange` fires on every keystroke — debouncing is the caller's business,
 * because how often an edit becomes an undo entry is a project-model decision,
 * not an editor one.
 */
export function createEditor({ value = '', readOnly = false, onChange = () => {} } = {}) {
  const gutter = el('div.code-gutter');
  const highlighted = el('pre.code-hl', { 'aria-hidden': 'true' });
  const input = el('textarea.code-input', {
    value,
    readOnly,
    spellcheck: false,
    autocapitalize: 'off',
    autocomplete: 'off',
    autocorrect: 'off',
    wrap: 'off'
  });
  const marker = el('div.code-errline', { hidden: true });
  const node = el('div.code-editor', null, gutter, el('div.code-scroll', null, marker, highlighted, input));

  // The lines the highlight layer currently shows, so a keystroke only re-renders
  // what it changed. Typing in a 2500-line file touches one line; only opening a
  // file pays for the whole thing.
  let shown = [];
  let markedLine = 0;

  function render() {
    const lines = input.value.split('\n');

    if (lines.length !== shown.length) {
      // A line was added or removed, so every line below it shifted: rebuild.
      // (Splicing rows instead would be faster in theory and is not worth the
      // bookkeeping — Enter is rare next to ordinary typing.)
      fill(
        highlighted,
        lines.map((line) => el('div.hl-line', { innerHTML: highlightLine(line) || '&nbsp;' }))
      );
      fill(
        gutter,
        lines.map((_, index) => el('div.gutter-line', null, String(index + 1)))
      );
    } else {
      for (const [index, line] of lines.entries()) {
        if (line === shown[index]) continue;
        const row = highlighted.children[index];
        if (row) row.innerHTML = highlightLine(line) || '&nbsp;';
      }
    }
    shown = lines;
    positionMarker();
  }

  function positionMarker() {
    if (!markedLine || markedLine > shown.length) {
      marker.hidden = true;
      return;
    }
    const row = highlighted.children[markedLine - 1];
    if (!row) {
      marker.hidden = true;
      return;
    }
    marker.hidden = false;
    marker.style.top = `${row.offsetTop}px`;
  }

  const syncScroll = () => {
    highlighted.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    marker.style.transform = `translateY(${-input.scrollTop}px)`;
    gutter.scrollTop = input.scrollTop;
  };

  input.addEventListener('input', () => {
    render();
    onChange(input.value);
  });
  input.addEventListener('scroll', syncScroll);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    // execCommand is deprecated but is the only insertion the browser records in
    // the textarea's own undo stack, which is what makes Ctrl+Z inside a file
    // behave the way a typist expects between store commits.
    document.execCommand('insertText', false, '  ');
  });

  render();

  return {
    el: node,
    focus: () => input.focus(),
    getValue: () => input.value,
    setValue(text) {
      if (text === input.value) return;
      const { selectionStart, selectionEnd } = input;
      input.value = text;
      // Keep the caret where it was if it still exists — this path runs when an
      // undo or another Forge changes the file under an open tab.
      const end = text.length;
      input.setSelectionRange(Math.min(selectionStart, end), Math.min(selectionEnd, end));
      render();
    },
    /** Scroll `line` (1-based) into the middle of the view and put the caret on it. */
    gotoLine(line) {
      const lines = input.value.split('\n');
      const target = Math.max(1, Math.min(lines.length, Math.round(line) || 1));
      const offset = lines.slice(0, target - 1).reduce((total, text) => total + text.length + 1, 0);
      // Selection first, scroll second: focusing a textarea and moving its caret
      // scrolls it on the browser's terms, so anything set before that is thrown
      // away. Centring the line is the last word here.
      if (!readOnly) {
        input.focus();
        input.setSelectionRange(offset, offset + (lines[target - 1]?.length ?? 0));
      }
      const row = highlighted.children[target - 1];
      if (row) input.scrollTop = Math.max(0, row.offsetTop - input.clientHeight / 2);
      syncScroll();
    },
    /** Stripe a line — where the assembler reported an error. 0 clears it. */
    markLine(line) {
      markedLine = Math.max(0, Math.round(line) || 0);
      positionMarker();
    },
    destroy() {
      node.remove();
    }
  };
}
