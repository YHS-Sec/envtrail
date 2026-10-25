import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { captureSnapshot } from '../../src/core/capture.js';
import { parseEnvironmentKeys, readProject } from '../../src/core/project.js';

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'envtrail-core-'));
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ engines: { node: '>=22' } }),
  );
  return directory;
}

test('dotenv parsing extracts names without evaluating or returning values', () => {
  assert.deepEqual(
    parseEnvironmentKeys(
      '# COMMENT=none\nTOKEN=private\nexport DATABASE_URL = "secret"\nBAD-KEY=x\nTOKEN=second\n=bad\nEMPTY=',
    ),
    ['DATABASE_URL', 'EMPTY', 'TOKEN'],
  );
});

test('multiline quoted dotenv values cannot create fake variable declarations', () => {
  assert.deepEqual(
    parseEnvironmentKeys(
      [
        'CERT="-----BEGIN PRIVATE KEY-----',
        'FAKE_SECRET=private',
        'escaped \\" quote',
        '-----END PRIVATE KEY-----"',
        "SINGLE='first line",
        'FAKE_SINGLE=private',
        "last line'",
        'TEMPLATE=`first line',
        'FAKE_TEMPLATE=private',
        'last line`',
        'REAL="closed" # comment',
        'AFTER=yes',
      ].join('\n'),
    ),
    ['AFTER', 'CERT', 'REAL', 'SINGLE', 'TEMPLATE'],
  );
});

test('fake assignments in example values and local multiline values do not affect presence', async () => {
  const directory = await fixture();
  try {
    await writeFile(
      path.join(directory, '.env.example'),
      'CERT="first\nFAKE_EXAMPLE=secret\nlast"\nNEEDED=',
    );
    await writeFile(path.join(directory, '.env'), 'CERT="first\nNEEDED=secret-inside-value\nlast"');
    const result = await readProject(directory);
    assert.deepEqual(result.environment.required, [
      { key: 'CERT', present: true, sources: ['dotenv'] },
      { key: 'NEEDED', present: false, sources: [] },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('version probes strip inherited Node loader variables before starting any Node process', async () => {
  const directory = await fixture();
  const binaries = await mkdtemp(path.join(tmpdir(), 'envtrail-loader-tools-'));
  const previous = {
    PATH: process.env.PATH,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    NODE_PATH: process.env.NODE_PATH,
  };
  try {
    const marker = path.join(directory, 'hook-executed');
    const hook = path.join(directory, 'hook.cjs');
    const versionScript = path.join(binaries, 'version.cjs');
    await writeFile(
      hook,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`,
    );
    await writeFile(
      versionScript,
      "if (process.env.NODE_OPTIONS !== undefined || process.env.NODE_PATH !== undefined) process.exit(8); console.log('10.9.2');",
    );
    const wrapper = path.join(binaries, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
    await writeFile(
      wrapper,
      process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${versionScript}"\r\n`
        : `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(versionScript)}\n`,
    );
    await chmod(wrapper, 0o755);
    process.env.PATH = binaries;
    process.env.NODE_OPTIONS = `--require "${hook.replace(/\\/g, '/')}"`;
    process.env.NODE_PATH = directory;
    const captured = await captureSnapshot(directory);
    assert.equal(captured.runtime.npm, '10.9.2');
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  } finally {
    for (const key of ['PATH', 'NODE_OPTIONS', 'NODE_PATH'] as const) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(directory, { recursive: true, force: true });
    await rm(binaries, { recursive: true, force: true });
  }
});

test('project capture omits private metadata, hashes locks and distinguishes declarations from configuration', async () => {
  const directory = await fixture();
  const processKey = 'ENVTRAIL_TEST_PROCESS_PRESENCE_9B7F';
  const original = process.env[processKey];
  process.env[processKey] = 'process-super-secret';
  try {
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'private-project-name',
        engines: { node: '>=22', vscode: '^1' },
        packageManager: 'npm@10.9.2+sha512.abc',
        scripts: { postinstall: 'do-not-run-this' },
        dependencies: { 'private-dependency': 'file:/private/path' },
      }),
    );
    await writeFile(
      path.join(directory, '.env.example'),
      `DATABASE_URL=example-secret\nONLY_EXAMPLE=example\n${processKey}=unused`,
    );
    await writeFile(path.join(directory, '.env.sample'), 'ANOTHER=sample');
    await writeFile(
      path.join(directory, '.env'),
      'DATABASE_URL=database-super-secret\nUNDECLARED=private',
    );
    await writeFile(path.join(directory, '.env.test.example'), 'ONLY_EXAMPLE=still-example');
    await writeFile(path.join(directory, '.nvmrc'), '# team Node\n v22.14.0\n');
    await writeFile(path.join(directory, 'package-lock.json'), 'lockfile-bytes');
    const project = await readProject(directory);
    assert.deepEqual(project.engines, { node: '>=22' });
    assert.equal(project.packageManager, 'npm@10.9.2');
    assert.equal(project.nodeVersionFiles.nvmrc, 'v22.14.0');
    assert.match(project.lockfiles[0]!.sha256, /^[a-f0-9]{64}$/);
    const required = new Map(project.environment.required.map((entry) => [entry.key, entry]));
    assert.deepEqual(required.get('DATABASE_URL')?.sources, ['dotenv']);
    assert.deepEqual(required.get(processKey)?.sources, ['process']);
    assert.equal(required.get('ONLY_EXAMPLE')?.present, false);
    assert.equal(required.get('ANOTHER')?.present, false);
    assert.equal(required.has('UNDECLARED'), false);
    const json = JSON.stringify(project);
    for (const secret of [
      'database-super-secret',
      'process-super-secret',
      'example-secret',
      'private-project-name',
      'private-dependency',
      '/private/path',
      directory,
      'do-not-run-this',
    ])
      assert.equal(json.includes(secret), false, secret);
  } finally {
    if (original === undefined) delete process.env[processKey];
    else process.env[processKey] = original;
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid project configuration fails with actionable messages that omit its raw content', async () => {
  const directory = await fixture();
  try {
    await writeFile(path.join(directory, 'package.json'), '{private-secret');
    await assert.rejects(
      readProject(directory),
      (error: Error) =>
        /valid JSON/.test(error.message) && !error.message.includes('private-secret'),
    );
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ engines: { node: '/home/private-secret' } }),
    );
    await assert.rejects(
      readProject(directory),
      (error: Error) => /semver/.test(error.message) && !error.message.includes('private-secret'),
    );
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ packageManager: 'npm@latest' }),
    );
    await assert.rejects(readProject(directory), /must pin/);
    await writeFile(path.join(directory, 'package.json'), '{}');
    await writeFile(path.join(directory, '.node-version'), '/home/private-secret');
    await assert.rejects(
      readProject(directory),
      (error: Error) =>
        /supported alias/.test(error.message) && !error.message.includes('private-secret'),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bounded reads reject oversized project files', async () => {
  const directory = await fixture();
  try {
    await writeFile(path.join(directory, 'package.json'), ' '.repeat(1024 * 1024 + 1));
    await assert.rejects(readProject(directory), /safety limit/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('capture executes offline version probes outside the project and excludes project PATH entries', async () => {
  const directory = await fixture();
  const binaries = await mkdtemp(path.join(tmpdir(), 'envtrail-tools-'));
  const originalPath = process.env.PATH;
  try {
    const extension = process.platform === 'win32' ? '.cmd' : '';
    const npm = path.join(binaries, `npm${extension}`);
    const content =
      process.platform === 'win32'
        ? '@echo off\r\nif "%COREPACK_ENABLE_NETWORK%"=="0" (echo 10.9.2) else (exit /b 8)\r\n'
        : '#!/bin/sh\n[ "$COREPACK_ENABLE_NETWORK" = "0" ] || exit 8\nprintf "10.9.2\\n"\n';
    await writeFile(npm, content);
    await chmod(npm, 0o755);
    const local = path.join(directory, `pnpm${extension}`);
    await writeFile(
      local,
      process.platform === 'win32'
        ? '@echo off\r\necho 99.99.99\r\n'
        : '#!/bin/sh\nprintf "99.99.99\\n"\n',
    );
    await chmod(local, 0o755);
    process.env.PATH = [directory, binaries].join(path.delimiter);
    const captured = await captureSnapshot(directory);
    assert.equal(captured.runtime.node, process.versions.node);
    assert.equal(captured.runtime.npm, '10.9.2');
    assert.equal(captured.runtime.pnpm, null);
    assert.equal(captured.system.platform, process.platform);
    assert.equal(JSON.stringify(captured).includes(directory), false);
    assert.deepEqual(
      await readFile(path.join(directory, 'package.json'), 'utf8'),
      JSON.stringify({ engines: { node: '>=22' } }),
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
    await rm(binaries, { recursive: true, force: true });
  }
});

test('capture handles missing projects and missing package.json without exposing their paths', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'envtrail-empty-'));
  try {
    await assert.rejects(captureSnapshot(directory), /No package.json/);
    await assert.rejects(
      captureSnapshot(path.join(directory, 'missing')),
      /Project directory does not exist/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('symlinked project configuration is rejected instead of reading outside the project', async (context) => {
  const directory = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), 'envtrail-outside-'));
  try {
    await writeFile(path.join(outside, 'version'), '22.14.0');
    try {
      await symlink(path.join(outside, 'version'), path.join(directory, '.nvmrc'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('File symlinks require a Windows developer-mode/admin privilege.');
        return;
      }
      throw error;
    }
    await assert.rejects(readProject(directory), /regular file, not a link/);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('dotenv directories are rejected rather than silently counted as configured files', async () => {
  const directory = await fixture();
  try {
    await writeFile(path.join(directory, '.env.example'), 'TOKEN=');
    await mkdir(path.join(directory, '.env'));
    await assert.rejects(readProject(directory), /regular file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
