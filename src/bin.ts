/**
 * The executable entry point. Kept apart from cli.ts so the dispatcher stays a pure
 * function of its inputs and the tests never have to spawn a process.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from './cli.js';

// dist/src/bin.js -> the package root is two levels up.
const installRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { text, code } = await run(process.argv.slice(2), {
  env: process.env,
  platform: process.platform,
  cwd: process.cwd(),
  installRoot,
});
process.stdout.write(text + '\n');
process.exit(code);
