// Small DOM helpers shared by every Forge. Deliberately tiny — no framework.

/**
 * el('div.panel', {onclick}, child, ...) — tag may carry .class and #id shorthand.
 */
export function el(spec, props = null, ...children) {
  const [tag, ...rest] = spec.split(/(?=[.#])/);
  const node = document.createElement(tag || 'div');
  for (const token of rest) {
    if (token[0] === '.') node.classList.add(token.slice(1));
    else if (token[0] === '#') node.id = token.slice(1);
  }
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className += ` ${value}`;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in node) node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Replace a node's children, taking the same children `el()` does: arrays are
 * flattened and null/undefined/false are skipped.
 *
 * Always this rather than `clear(node).append(...)`. The DOM's own `append`
 * stringifies whatever it is given, so a list of rows renders as the literal
 * text "[object HTMLDivElement]" and a `cond ? node : null` renders as "null" —
 * both of which look like a data bug rather than the wrong append.
 */
export function fill(node, ...children) {
  return append(clear(node), children);
}

export function field(label, ...children) {
  return el('div.field', null, el('span.field-label', null, label), ...children);
}

export function toast(message, kind = 'info', ms = 3200) {
  const host = document.querySelector('#toastHost');
  const node = el('div.toast', { class: kind }, message);
  host.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

/**
 * Show a modal. `body` may be a node or a function receiving a `close` callback.
 * Returns a promise resolving to whatever an action's handler returns, or null.
 */
export function showModal({ title, body, actions = [], width }) {
  const host = document.querySelector('#modalHost');
  return new Promise((resolve) => {
    let settled = false;
    const close = (value = null) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      host.hidden = true;
      clear(host);
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      }
    };

    const content = typeof body === 'function' ? body(close) : body;
    const modal = el(
      'div.modal',
      { style: width ? { minWidth: `${width}px` } : null },
      el('div.modal-head', null, title),
      el('div.modal-body', null, content),
      actions.length
        ? el(
            'div.modal-foot',
            null,
            actions.map((action) =>
              el(
                'button.btn',
                {
                  class: action.primary ? 'btn-accent' : '',
                  onclick: async () => close(action.onClick ? await action.onClick() : action.value ?? null)
                },
                action.label
              )
            )
          )
        : null
    );

    clear(host);
    host.append(modal);
    host.hidden = false;
    host.onclick = (event) => {
      if (event.target === host) close(null);
    };
    document.addEventListener('keydown', onKey, true);
    modal.querySelector('input,select,button')?.focus();
  });
}

export function confirmModal(title, message, confirmLabel = 'Confirm') {
  return showModal({
    title,
    body: el('p.hint', null, message),
    actions: [
      { label: 'Cancel', value: false },
      { label: confirmLabel, primary: true, value: true }
    ]
  });
}

/**
 * Ask for a single line of text. Resolves to the trimmed string, or null if the
 * user cancelled — an empty string would otherwise be indistinguishable from a
 * dismissal, and callers use null to mean "leave it alone".
 */
export function promptModal(title, label, value = '', confirmLabel = 'Save') {
  const input = el('input.input', { value, style: { width: '100%' } });
  return showModal({
    title,
    body: el('div', null, el('span.field-label', null, label), input),
    actions: [
      { label: 'Cancel', value: null },
      { label: confirmLabel, primary: true, onClick: () => input.value.trim() || null }
    ]
  });
}

/** A canvas that renders 1:1 pixel art scaled by an integer zoom. */
export function pixelCanvas(width, height, zoom) {
  const canvas = el('canvas.pixels', { width, height });
  canvas.style.width = `${width * zoom}px`;
  canvas.style.height = `${height * zoom}px`;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  return { canvas, context };
}

/**
 * The largest integer zoom at which `width`×`height` pixels still fit inside
 * `stage`. A `.canvas-stage` pads itself, and that padding is frame rather than
 * room to draw in, so it comes off the measurement. `reserve` takes off further
 * vertical space for anything sharing the stage with the scaled canvas — it must
 * be a height the zoom cannot itself change, or the two chase each other.
 * Because the result always fits, fitted content never raises the stage's
 * scrollbars, so this cannot oscillate with them either. `max` is for callers
 * whose backing canvas grows with the zoom, where an unbounded fit is unbounded
 * memory; callers that only scale a fixed-size canvas in CSS need no cap.
 */
export function fitZoom(stage, width, height, { min = 1, max = Infinity, reserve = 0 } = {}) {
  const style = getComputedStyle(stage);
  const across = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const down =
    stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - reserve;
  const zoom = Math.floor(Math.min(across / width, down / height));
  // Before the first layout the stage measures zero, and `min` is the honest
  // answer; the observer below re-runs this as soon as it has a real box.
  return Number.isFinite(zoom) ? Math.max(min, Math.min(max, zoom)) : min;
}

/**
 * Call `handler` whenever `node`'s box changes, including once for its current
 * size. The returned stop function must be called from the owner's `destroy()`,
 * or the observer keeps an unmounted Forge's render closure alive.
 */
export function observeSize(node, handler) {
  const observer = new ResizeObserver(() => handler());
  // border-box, and that is what makes redrawing straight from the callback
  // safe: the handler resizes content *inside* `node`, which can raise or drop a
  // scrollbar and so change its content box, but never its border box. Watching
  // the content box instead is what produces "ResizeObserver loop completed" —
  // and deferring the redraw a frame to dodge that would only trade the loop for
  // a redraw that never arrives in a window whose frames are being throttled.
  observer.observe(node, { box: 'border-box' });
  return () => observer.disconnect();
}

/** Map a pointer event to integer pixel coordinates inside a scaled canvas. */
export function canvasPoint(event, canvas, width, height) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor(((event.clientX - rect.left) * width) / rect.width))),
    y: Math.max(0, Math.min(height - 1, Math.floor(((event.clientY - rect.top) * height) / rect.height)))
  };
}

/** Bresenham line, calling `plot(x, y)` for each cell. */
export function line(from, to, plot) {
  let { x, y } = from;
  const dx = Math.abs(to.x - x);
  const sx = x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - y);
  const sy = y < to.y ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    plot(x, y);
    if (x === to.x && y === to.y) return;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}
