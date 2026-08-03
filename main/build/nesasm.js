// Runs nesasm and turns its output into structured errors.

import { spawn } from 'node:child_process';
import path from 'node:path';

// nesasm reports problems as e.g. "boot.asm:42: Syntax error!" or with a leading
// "#" marker depending on the message; both carry file:line.
const ERROR_LINE = /^(?:#\s*)?([\w./-]+\.(?:asm|inc)):(\d+):\s*(.+)$/;

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
      const errors = [];
      for (const line of output.split('\n')) {
        const match = ERROR_LINE.exec(line.trim());
        if (match && /error|expected|undefined|overflow|too many/i.test(match[3])) {
          errors.push({ file: match[1], line: Number(match[2]), message: match[3].trim() });
        }
      }
      // nesasm does not always exit non-zero, so treat any parsed error as fatal.
      const ok = code === 0 && errors.length === 0;
      if (!ok && !errors.length) {
        errors.push({ message: `nesasm exited with code ${code}.` });
      }
      resolve({ ok, errors, output, romPath: path.join(cwd, source.replace(/\.asm$/, '.nes')) });
    });
  });
}
