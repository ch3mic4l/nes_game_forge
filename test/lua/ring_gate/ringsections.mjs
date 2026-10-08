// Section selection for the deadline Lua templates (phase 3b S1c). A template line that is exactly `--@legacy` / `--@endlegacy` / `--@ring` / `--@endring`
// delimits a section only one render keeps: `renderSections(text, 'legacy')` drops every ring section and every marker line, so the four-screen builders'
// output is byte-for-byte the text they rendered before the markers existed (ring_gate/s1c_noflag.mjs proves it from recorded hashes); 'ring' keeps the ring
// sections and drops the legacy ones. A marker that is unbalanced or nested is an error, never a silently kept section.
const MARKERS = { '--@legacy': ['open', 'legacy'], '--@endlegacy': ['close', 'legacy'], '--@ring': ['open', 'ring'], '--@endring': ['close', 'ring'] };

export function renderSections(text, mode) {
  if (mode !== 'legacy' && mode !== 'ring') throw new Error(`unknown section mode ${mode}`);
  const out = [];
  let open = null;
  for (const [i, line] of text.split('\n').entries()) {
    const m = MARKERS[line];
    if (m) {
      if (m[0] === 'open') { if (open) throw new Error(`line ${i + 1}: ${line} inside an open ${open} section`); open = m[1]; }
      else { if (open !== m[1]) throw new Error(`line ${i + 1}: ${line} closes ${open ?? 'nothing'}`); open = null; }
      continue;
    }
    if (open && open !== mode) continue;
    out.push(line);
  }
  if (open) throw new Error(`unterminated ${open} section`);
  return out.join('\n');
}
