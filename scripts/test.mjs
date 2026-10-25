import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiler = spawnSync(
  process.execPath,
  [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.test.json'],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
if (compiler.status !== 0) process.exit(compiler.status ?? 1);
async function discover(path) {
  const results = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    const location = join(path, item.name);
    if (item.isDirectory()) results.push(...(await discover(location)));
    else if (item.name.endsWith('.test.js')) results.push(location);
  }
  return results;
}
const files = await discover(join(root, '.test-dist/test'));
if (!files.length) throw new Error('No test files found.');
const test = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
process.exit(test.status ?? 1);
