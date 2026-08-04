// Runs nesasm and turns its output into structured errors.

import { spawn } from 'node:child_process';
import path from 'node:path';

// nesasm v3.1 reports a problem across three lines, and the file, the line and
// the message are one to a line:
//
//   #[2]   player.asm
//       4  02:C4C2              jsr no_such_label
//          Undefined symbol in operand field!
//
// So parsing is a small state machine rather than one regex. This matters more
// than it looks: nesasm exits 0 even after an error, so a missed message means
// the pipeline believes the build worked and then fails renaming a ROM that was
// never written — which is what the user would see instead of their own typo.
const FILE_LINE = /^#\[\d+\]\s+(\S+)$/;
const SOURCE_LINE = /^\s*(\d+)\s+[0-9A-Fa-f]{2}:[0-9A-Fa-f]{4}\s/;
const TOTAL_LINE = /^#\s*\d+\s+error/i;
// Older/other nesasm builds use a one-line "file:line: message" form.
const COMPACT_LINE = /^(?:#\s*)?([\w./-]+\.(?:asm|inc)):(\d+):\s*(.+)$/;

/** Pull `{ file, line, message }` out of nesasm's output. */
export function parseNesasmErrors(output) {
  const errors = [];
  let file = null;
  let line = null;

  for (const raw of output.split('\n')) {
    const text = raw.trimEnd();
    if (!text.trim()) continue;

    const compact = COMPACT_LINE.exec(text.trim());
    if (compact && /error|expected|undefined|overflow|too many/i.test(compact[3])) {
      errors.push({ file: compact[1], line: Number(compact[2]), message: compact[3].trim() });
      continue;
    }

    const fileMatch = FILE_LINE.exec(text.trim());
    if (fileMatch) {
      file = fileMatch[1];
      line = null;
      continue;
    }
    const sourceMatch = SOURCE_LINE.exec(text);
    if (sourceMatch) {
      line = Number(sourceMatch[1]);
      continue;
    }
    if (TOTAL_LINE.test(text.trim())) {
      file = null;
      line = null;
      continue;
    }
    // An indented sentence following a located source line is the message for it.
    if (file && line !== null && /^\s/.test(text) && text.trim().endsWith('!')) {
      errors.push({ file, line, message: text.trim() });
      line = null;
    }
  }
  return errors;
}

export function runNesasm({ cwd, source = 'main.asm', binary = 'nesasm', log = () => {} }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binary, ['-s', source], { cwd });
    } catch (error) {
      resolve({ ok: false, errors: [{ message: `Could not run ${binary}: ${error.message}` }], output: '' });
      return;
    }

    let output = '';
    const collect = (chunk) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split('\n')) if (line.trim()) log(line.trimEnd());
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    child.on('error', (error) => {
      resolve({
        ok: false,
        errors: [
          {
            message:
              error.code === 'ENOENT'
                ? `'${binary}' was not found. Install nesasm or set its path in Settings.`
                : `Could not run ${binary}: ${error.message}`
          }
        ],
        output
      });
    });

    child.on('close', (code) => {
      const errors = parseNesasmErrors(output);
      // nesasm does not always exit non-zero, so any parsed error is fatal — and
      // so is its own error count, which is the backstop for a message shape this
      // parser does not recognise. Without that, an unrecognised error reads as a
      // successful build right up until the ROM it never wrote fails to rename.
      const counted = /^#\s*([1-9]\d*)\s+error/im.exec(output);
      const ok = code === 0 && errors.length === 0 && !counted;
      if (!ok && !errors.length) {
        errors.push({
          message: counted
            ? `nesasm reported ${counted[1]} error(s). See the log above for the file and line.`
            : `nesasm exited with code ${code}.`
        });
      }
      resolve({ ok, errors, output, romPath: path.join(cwd, source.replace(/\.asm$/, '.nes')) });
    });
  });
}
