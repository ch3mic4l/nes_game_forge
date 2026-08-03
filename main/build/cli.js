#!/usr/bin/env node
// Headless build, so the pipeline can be exercised from tests and CI:
//   node main/build/cli.js <projectDir>

import process from 'node:process';
import { loadProject } from '../project-io.js';
import { buildProject } from './pipeline.js';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node main/build/cli.js <projectDir>');
  process.exit(2);
}

try {
  const project = await loadProject(dir);
  const result = await buildProject({ dir, project, log: (line) => console.log(line) });
  console.log(result.romPath);
} catch (error) {
  console.error(error.message);
  if (error.output) console.error(error.output);
  process.exit(1);
}
