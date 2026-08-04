// The Code Forge's build overlay: per-project copies of engine files, and the
// user's own sources.
//
// The two things worth guarding are opposites. A project that uses none of this
// must assemble to exactly the ROM it did before the feature existed — the
// include slot in engine/main.asm is unconditional, so "exactly" is testable.
// And a project that does use it must actually reach the engine: a label the
// user wrote has to end up in the symbol file, at a real address.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { checkCapacity, engineFileNames } from '../../main/build/generate.js';
import { normalizeProject, createProject, CODE_FILE_RE } from '../../shared/project.js';
import { parseNesasmErrors } from '../../main/build/nesasm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasSample = fs.existsSync(path.join(SAMPLE, 'project.json'));
const needsSample = !hasSample && 'run `npm run sample` first';

/** A build of the sample with `mutate` applied, in a temp dir the test owns. */
async function buildVariant(t, name, mutate) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `forge-${name}-`));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { dir, built };
}

// --- the schema -------------------------------------------------------------

test('a code file name cannot escape its folder', () => {
  for (const bad of ['../evil.asm', 'a/b.asm', '.hidden.asm', 'no-extension', 'x.inc', '', 'a b.asm']) {
    assert.ok(!CODE_FILE_RE.test(bad), `${bad} should be rejected`);
  }
  for (const good of ['player.asm', 'my_hooks.asm', 'a-b.asm', 'X9.asm']) {
    assert.ok(CODE_FILE_RE.test(good), `${good} should be accepted`);
  }
});

test('normalising code sorts, dedupes and fixes line endings', () => {
  const project = normalizeProject({
    ...createProject('T'),
    code: {
      overrides: [
        { name: 'zzz.asm', text: 'a' },
        { name: 'aaa.asm', text: 'b\r\nc' },
        { name: 'aaa.asm', text: 'duplicate' },
        { name: '../hack.asm', text: 'x' }
      ],
      files: [{ name: 'mine.asm', text: 'ok\n' }]
    }
  });
  assert.deepEqual(
    project.code.overrides.map((file) => file.name),
    ['aaa.asm', 'zzz.asm']
  );
  assert.equal(project.code.overrides[0].text, 'b\nc\n', 'CRLF becomes LF, and a file ends in a newline');
  assert.equal(project.code.files.length, 1);
});

test('a user file may not shadow an override', () => {
  const project = normalizeProject({
    ...createProject('T'),
    code: {
      overrides: [{ name: 'player.asm', text: 'a\n' }],
      files: [{ name: 'player.asm', text: 'b\n' }]
    }
  });
  assert.equal(project.code.files.length, 0, 'the user file is dropped; both would fight over one path');
});

test('a project with no code slice at all still normalises', () => {
  const project = normalizeProject({ project: { name: 'Old' } });
  assert.deepEqual(project.code, { overrides: [], files: [] });
});

// --- capacity checks --------------------------------------------------------

test('a user file named after an engine file is refused', () => {
  const project = createProject('Collide');
  project.code.files.push({ name: 'player.asm', text: 'nop\n' });
  const { problems } = checkCapacity(project);
  const problem = problems.find((entry) => entry.where === 'Code Forge' && entry.severity === 'error');
  assert.ok(problem, 'expected a Code Forge error');
  assert.match(problem.message, /player\.asm/);
});

test('an override of a file this version does not ship is a warning, not an error', () => {
  const project = createProject('Future');
  project.code.overrides.push({ name: 'from_the_future.asm', text: 'nop\n' });
  const { problems } = checkCapacity(project);
  const codeProblems = problems.filter((entry) => entry.where === 'Code Forge');
  assert.ok(codeProblems.length);
  assert.ok(!codeProblems.some((entry) => entry.severity === 'error'), 'a later version must still build');
});

test('the engine file list is the single source of what a stock file is', () => {
  const names = engineFileNames();
  assert.ok(names.includes('player.asm') && names.includes('main.asm'));
  assert.ok(
    names.every((name) => name.endsWith('.asm')),
    'only .asm files are engine sources'
  );
});

// --- the build ---------------------------------------------------------------

test('a project with no code of its own builds byte-identically', { skip: needsSample }, async (t) => {
  const plain = await buildVariant(t, 'code-none-a', () => {});
  const empty = await buildVariant(t, 'code-none-b', (project) => {
    project.code = { overrides: [], files: [] };
  });
  const a = await fs.promises.readFile(plain.built.romPath);
  const b = await fs.promises.readFile(empty.built.romPath);
  assert.deepEqual(a, b, 'the unconditional usercode.inc include must cost nothing');

  const inc = await fs.promises.readFile(path.join(plain.dir, 'build/assets/usercode.inc'), 'utf8');
  assert.match(inc, /no Code Forge files/, 'the slot is still generated, just empty');
});

test('a user file reaches the ROM as a real symbol', { skip: needsSample }, async (t) => {
  const { dir, built } = await buildVariant(t, 'code-user', (project) => {
    project.code.files.push({
      name: 'user_hook.asm',
      text: 'forge_user_hook:\n  lda #$01\n  rts\n'
    });
  });
  assert.ok(built.romPath);

  const inc = await fs.promises.readFile(path.join(dir, 'build/assets/usercode.inc'), 'utf8');
  assert.match(inc, /\.include "user_hook\.asm"/);
  // The file is copied beside the engine sources, which is what makes the
  // assembler's error line numbers match what the editor shows.
  assert.ok(fs.existsSync(path.join(dir, 'build/user_hook.asm')));

  const symbols = await fs.promises.readFile(path.join(dir, 'build/game.fns'), 'utf8');
  const match = /forge_user_hook\s*=\s*\$([0-9A-Fa-f]{4})/.exec(symbols);
  assert.ok(match, 'the user label is missing from the symbol file');
  const address = parseInt(match[1], 16);
  // The fixed kernel, so it is callable no matter which bank is switched in.
  assert.ok(address >= 0xc000 && address < 0xe000, `expected $C000-$DFFF, got $${match[1]}`);
});

test('an override replaces the engine file and can call user code', { skip: needsSample }, async (t) => {
  const stock = await fs.promises.readFile(path.join(ROOT, 'engine/player.asm'), 'utf8');
  const { dir, built } = await buildVariant(t, 'code-override', (project) => {
    project.code.files.push({ name: 'user_hook.asm', text: 'forge_user_hook:\n  rts\n' });
    project.code.overrides.push({
      name: 'player.asm',
      // A no-op call, but a real one: it only assembles if user code is in scope
      // from an engine file, which is the whole point of the include slot.
      text: stock.replace('update_player:\n', 'update_player:\n  jsr forge_user_hook\n')
    });
  });
  assert.ok(built.romPath);

  const copied = await fs.promises.readFile(path.join(dir, 'build/player.asm'), 'utf8');
  assert.match(copied, /jsr forge_user_hook/, 'the override must overlay the stock copy');
  // The app's own engine is never written to.
  const onDisk = await fs.promises.readFile(path.join(ROOT, 'engine/player.asm'), 'utf8');
  assert.equal(onDisk, stock, 'the stock engine source was modified');

  const plain = await buildVariant(t, 'code-override-base', () => {});
  const a = await fs.promises.readFile(built.romPath);
  const b = await fs.promises.readFile(plain.built.romPath);
  assert.notDeepEqual(a, b, 'the override changed nothing in the ROM');
});

test('a syntax error names the file and line the editor shows', { skip: needsSample }, async (t) => {
  const stock = await fs.promises.readFile(path.join(ROOT, 'engine/player.asm'), 'utf8');
  const broken = stock.replace('update_player:\n', 'update_player:\n  this is not an opcode\n');
  const brokenLine = broken.split('\n').findIndex((line) => line.includes('this is not an opcode')) + 1;

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-code-broken-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.code.overrides.push({ name: 'player.asm', text: broken });
  await saveProject(dir, project);

  const error = await buildProject({ dir, project, log: () => {} }).then(
    () => null,
    (failure) => failure
  );
  assert.ok(error, 'a broken override must fail the build');
  assert.ok(Array.isArray(error.errors) && error.errors.length, 'the structured errors are what the UI links');
  const located = error.errors.find((entry) => entry.file === 'player.asm');
  assert.ok(located, `expected an error in player.asm, got ${JSON.stringify(error.errors)}`);
  assert.equal(located.line, brokenLine, 'the reported line must match the editor’s line numbering');
});

// --- disk round-trip --------------------------------------------------------

test('code survives a save/load round trip byte for byte', { skip: needsSample }, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-code-io-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = await loadProject(SAMPLE);
  project.code.files.push({ name: 'zebra.asm', text: '; last alphabetically\n' });
  project.code.files.push({ name: 'alpha.asm', text: 'alpha_label:\n  rts\n' });
  project.code.overrides.push({ name: 'player.asm', text: '; not really player.asm\n' });
  const saved = await saveProject(dir, project);

  // Raw .asm on disk, not wrapped in JSON, so it stays diffable and any editor
  // can open it.
  assert.equal(
    await fs.promises.readFile(path.join(dir, 'code/user/alpha.asm'), 'utf8'),
    'alpha_label:\n  rts\n'
  );
  assert.ok(fs.existsSync(path.join(dir, 'code/engine/player.asm')));

  const reloaded = await loadProject(dir);
  assert.deepEqual(reloaded.code, saved.code);
  assert.equal(JSON.stringify(reloaded), JSON.stringify(saved), 'the whole project must round-trip');
});

test('deleting the last code file removes it from disk', { skip: needsSample }, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-code-rm-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = await loadProject(SAMPLE);
  project.code.files.push({ name: 'temporary.asm', text: '; here\n' });
  await saveProject(dir, project);
  assert.ok(fs.existsSync(path.join(dir, 'code/user/temporary.asm')));

  project.code.files = [];
  await saveProject(dir, project);
  assert.ok(!fs.existsSync(path.join(dir, 'code/user/temporary.asm')), 'a deleted file must not linger');
  assert.deepEqual((await loadProject(dir)).code.files, []);
});

test('a project that never used the Code Forge grows no code folder', { skip: needsSample }, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-code-clean-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, await loadProject(SAMPLE));
  assert.ok(!fs.existsSync(path.join(dir, 'code')), 'existing projects should look untouched');
});

// --- the assembler's error format -------------------------------------------
//
// nesasm v3.1 exits 0 even when it has refused to assemble, so this parser is
// the only thing standing between a user's typo and a build that reports
// "ENOENT: rename main.nes" — which is what happened before it understood the
// three-line form below.

test('nesasm’s three-line error form is parsed into file, line and message', () => {
  const output = [
    'NES Assembler (v3.1)',
    'pass 1',
    '#[2]   player.asm',
    '    4  02:C4C2              jsr no_such_label',
    '       Undefined symbol in operand field!',
    '# 1 error(s)',
    'segment usage:'
  ].join('\n');
  assert.deepEqual(parseNesasmErrors(output), [
    { file: 'player.asm', line: 4, message: 'Undefined symbol in operand field!' }
  ]);
});

test('several errors in several files each keep their own location', () => {
  const output = [
    '#[2]   player.asm',
    '   12  02:C500              lda',
    '       Syntax error in expression!',
    '#[3]   my_code.asm',
    '    7  02:C600              .db $100',
    '       Operand out of range!',
    '# 2 error(s)'
  ].join('\n');
  assert.deepEqual(parseNesasmErrors(output), [
    { file: 'player.asm', line: 12, message: 'Syntax error in expression!' },
    { file: 'my_code.asm', line: 7, message: 'Operand out of range!' }
  ]);
});

test('a clean build parses as no errors at all', () => {
  const output = ['NES Assembler (v3.1)', 'pass 1', 'pass 2', 'segment usage:', 'BANK   0   1597/6595'].join('\n');
  assert.deepEqual(parseNesasmErrors(output), []);
});

test('the older one-line form is still understood', () => {
  assert.deepEqual(parseNesasmErrors('boot.asm:42: Syntax error!'), [
    { file: 'boot.asm', line: 42, message: 'Syntax error!' }
  ]);
});
