#!/usr/bin/env node
// The certificate matrix runner (replaces run_r2_matrix.sh, whose `echo exit=$?` after each job never failed the matrix). Every job DECLARES its
// expected exit status and a pattern its log must contain; the matrix compares each job's actual status and log against that declaration -- a
// positive that fails, a control that is not caught, and a deliberate selection error that stops erroring are all UNEXPECTED -- and exits
// nonzero on any unexpected status. Afterwards the provenance audit (ringprovindex.mjs) runs over the stamps the jobs wrote.
//   node test/lua/ring_gate/run_matrix.mjs <prov-dir> <log-dir> [--only=<regex>] [--jobs=<n>] [--list]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditProvenance } from './ringprovindex.mjs';
import { jobs } from './ringjobs.mjs';
export { jobs };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
/** Runs one job; resolves { name, status, log }. The child's output goes to <log-dir>/<name>.log with the exit status appended. */
export function runJob(job, L) {
  return new Promise((resolve) => {
    const logPath = path.join(L, `${job.name}.log`);
    const fd = fs.openSync(logPath, 'w');
    const child = spawn('node', job.argv, { cwd: ROOT, stdio: ['ignore', fd, fd], env: { ...process.env, RING_PROV_UNIQUE: '1' } });
    child.on('error', (e) => { fs.writeSync(fd, `spawn error: ${e.message}\n`); });
    child.on('close', (status, signal) => {
      fs.writeSync(fd, `exit=${status ?? signal}\n`);
      fs.closeSync(fd);
      resolve({ name: job.name, status: status ?? 128, signal, log: fs.readFileSync(logPath, 'utf8') });
    });
  });
}

/** The verdict of one finished job against its declaration: { ok, why }. */
export function judgeJob(job, res) {
  if (res.status !== job.expect.exit) return { ok: false, why: `exit ${res.status}, declared ${job.expect.exit}` };
  if (!job.expect.log.test(res.log)) return { ok: false, why: `log lacks the declared pattern ${job.expect.log}` };
  return { ok: true, why: '' };
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { for (;;) { const i = next++; if (i >= items.length) return; results[i] = await fn(items[i]); } }));
  return results;
}

/** Runs and judges `list`; returns { rows, unexpected }. */
export async function runMatrix(list, L, concurrency = 6) {
  const rows = [];
  for (const g of [...new Set(list.map((j) => j.group))].sort()) {
    const batch = list.filter((j) => j.group === g);
    const res = await pool(batch, concurrency, (j) => runJob(j, L));
    batch.forEach((j, i) => rows.push({ job: j, res: res[i], verdict: judgeJob(j, res[i]) }));
  }
  return { rows, unexpected: rows.filter((r) => !r.verdict.ok) };
}

/**
 * What the matrix prints and exits with once its jobs have run. The provenance audit certifies the STAMPS the jobs wrote, so it runs only when the
 * selection contains a job that writes one (`job.stamps`); an all-raw selection (the repro guards, the harness unit tests, the selection-error
 * probes -- e.g. `--only=^repro-`) reports the job verdicts and says the audit was skipped. A selection with a stamping job audits as ever, and
 * the audit's own refusal of an empty directory ("no stamps at all") is untouched, so the full certificate cannot pass with no stamps.
 * Returns { code, lines, audit }.
 */
export function matrixReport(list, rows, unexpected, P, L) {
  const lines = [];
  for (const r of rows) {
    const summary = (r.res.log.split('\n').filter((l) => /^(sabotage|all pass|all identity|# (pass|fail)|\d+ (FAILING|ERRORS|BUILD))/.test(l)).join(' | ') || r.res.log.trim().split('\n').slice(-2).join(' | ')).slice(0, 150);
    lines.push(`${r.verdict.ok ? 'OK        ' : 'UNEXPECTED'} ${r.job.name.padEnd(34)} declared exit ${r.job.expect.exit}, actual ${r.res.status}  ${summary}${r.verdict.ok ? '' : `  <-- ${r.verdict.why}`}`);
  }
  if (!list.some((j) => j.stamps)) {
    lines.push(`matrix: ${rows.length} jobs, ${unexpected.length} unexpected; provenance audit SKIPPED: all ${rows.length} selected jobs are stamp-free (raw), so there is no stamp to audit (a selection with any stamping job audits)`);
    return { code: unexpected.length ? 1 : 0, lines, audit: null };
  }
  const audit = auditProvenance(P, L, { construct: true });
  fs.writeFileSync(path.join(P, 'INDEX.json'), JSON.stringify(audit.index, null, 1));
  for (const p of audit.problems.slice(0, 40)) lines.push(`PROVENANCE PROBLEM ${p}`);
  lines.push(`matrix: ${rows.length} jobs, ${unexpected.length} unexpected; provenance: ${audit.index.counts.stamps} stamps, ${audit.problems.length} problems`);
  return { code: unexpected.length || audit.problems.length ? 1 : 0, lines, audit };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const pos = args.filter((a) => !a.startsWith('--'));
  const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  if (pos.length !== 2) { console.error('usage: run_matrix.mjs <prov-dir> <log-dir> [--only=<regex>] [--jobs=<n>] [--list]'); process.exit(2); }
  const [P, L] = pos.map((p) => path.resolve(p));
  let list = jobs(P, L);
  if (flag('only')) list = list.filter((j) => new RegExp(flag('only')).test(j.name));
  if (!list.length) { console.error('run_matrix: --only matches no job'); process.exit(2); }
  if (args.includes('--list')) { for (const j of list) console.log(`${j.group} ${j.name} exit=${j.expect.exit} ${j.expect.log}`); process.exit(0); }
  fs.rmSync(P, { recursive: true, force: true }); fs.rmSync(L, { recursive: true, force: true });
  fs.mkdirSync(P, { recursive: true }); fs.mkdirSync(L, { recursive: true });
  const { rows, unexpected } = await runMatrix(list, L, Number(flag('jobs') ?? 6));
  const report = matrixReport(list, rows, unexpected, P, L);
  for (const l of report.lines) console.log(l);
  process.exit(report.code);
}
