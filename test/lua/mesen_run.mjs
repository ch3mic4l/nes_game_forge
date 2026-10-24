#!/usr/bin/env node
// Runs one headless Mesen script under a hard time limit and prints exactly ONE result record on stdout, so a runner can tell
// how the run ended:
//
//   node test/lua/mesen_run.mjs <timeout-seconds> <mesen> <script.lua> <rom> [logfile]
//
//   MESEN_RESULT kind=exit code=<n>      Mesen exited by itself; <n> is what the Lua script passed to emu.stop()
//   MESEN_RESULT kind=timeout            the limit expired and Mesen was killed
//   MESEN_RESULT kind=signal signal=<s>  Mesen was killed by a signal it did not get from this supervisor
//   MESEN_RESULT kind=error              Mesen could not be started
//
// `timeout N mesen ...; echo $?` cannot say this: a timeout is exit 124 and a signal is 128+n, and both are also exit codes a Lua
// script may legitimately pass (the measurement runners encode a cycle bucket as 100 + cycles/scale). The sandboxed Lua cannot write a
// file (test/lua/save_sram.lua's header), so the exit code stays the only channel out of the script; what this adds is the one fact
// the code cannot carry. test/lua/mesen_lib.sh is the shell side; a runner never calls this directly.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [timeoutArg, mesen, lua, rom, logPath] = process.argv.slice(2);
const limitMs = Number(timeoutArg) * 1000;
if (!(limitMs > 0) || !mesen || !lua || !rom) {
  console.error('usage: mesen_run.mjs <timeout-seconds> <mesen> <script.lua> <rom> [logfile]');
  process.exit(2);
}

const logFd = logPath ? fs.openSync(logPath, 'w') : null;
const child = spawn(mesen, ['--testRunner', lua, rom], { stdio: ['ignore', logFd ?? 'ignore', logFd ?? 'ignore'] });
let timedOut = false;
let settled = false;
const finish = (record) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  if (logFd !== null) fs.closeSync(logFd);
  console.log(`MESEN_RESULT ${record}`);
};
const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, limitMs);
child.on('error', () => finish('kind=error'));
child.on('close', (code, signal) => {
  if (timedOut) finish('kind=timeout');
  else if (signal) finish(`kind=signal signal=${signal}`);
  else finish(`kind=exit code=${code}`);
});
