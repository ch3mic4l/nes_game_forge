// Parses nesasm's .fns symbol dump so the debugger can show label names.
//
// Format is one "label: value" pair per line, values in nesasm's own hex form.

export function parseSymbolFile(text) {
  const symbols = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const match = /^([A-Za-z_.][\w.]*)\s*[:=]?\s*\$?([0-9A-Fa-f]{2,6})\b/.exec(line);
    if (!match) continue;
    const value = parseInt(match[2], 16);
    if (Number.isFinite(value)) symbols[match[1]] = value;
  }
  return symbols;
}

/** Invert a symbol table into address -> label, keeping the first name seen. */
export function addressIndex(symbols) {
  const byAddress = new Map();
  for (const [name, address] of Object.entries(symbols)) {
    if (!byAddress.has(address)) byAddress.set(address, name);
  }
  return byAddress;
}
