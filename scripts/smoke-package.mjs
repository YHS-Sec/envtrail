import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this smoke check with npm run smoke:package.');
const directory = await mkdtemp(join(tmpdir(), 'envtrail-package-'));
function run(args, cwd = root) {
  const result = spawnSync(process.execPath, [npm, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  if (result.status !== 0)
    throw new Error(`Package smoke check failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
try {
  const [packed] = JSON.parse(run(['pack', '--json', '--ignore-scripts']));
  const contents = packed.files.map((item) => item.path);
  assert.ok(contents.includes('dist/cli.js'));
  assert.ok(contents.includes('LICENSE'));
  assert.ok(
    contents.every((name) => !name.startsWith('test/') && !name.startsWith('node_modules/')),
  );
  run([
    'install',
    '--prefix',
    directory,
    join(root, packed.filename),
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ]);
  const result = run(
    ['exec', '--offline', '--prefix', directory, '--', 'envtrail', '--version'],
    directory,
  );
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(result.trim(), manifest.version);
  const help = run(
    ['exec', '--offline', '--prefix', directory, '--', 'envtrail', '--help'],
    directory,
  );
  assert.match(help, /Privacy: local only/);
  const compare = run(
    [
      'exec',
      '--offline',
      '--prefix',
      directory,
      '--',
      'envtrail',
      'compare',
      join(root, 'examples/baseline.json'),
      join(root, 'examples/current.json'),
      '--json',
    ],
    directory,
  );
  assert.ok(JSON.parse(compare).findings.length > 0);
  console.log('Packed package installs and its real npm bin runs successfully.');
} finally {
  const location = relative(tmpdir(), directory);
  if (!location.startsWith('envtrail-package-') || isAbsolute(location) || location.includes('..'))
    throw new Error('Unsafe temporary cleanup target.');
  await rm(directory, { recursive: true, force: true });
}
