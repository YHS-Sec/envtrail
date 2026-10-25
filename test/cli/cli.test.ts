import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { EnvSnapshot } from '../../src/core/types.js';

const cli = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

function snapshot(): EnvSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: '2026-10-25T00:00:00.000Z',
    system: { platform: 'linux', arch: 'x64' },
    runtime: { node: '22.20.0', npm: '10.9.3', pnpm: null, yarn: null, bun: null },
    project: {
      engines: { node: '>=22' },
      packageManager: null,
      nodeVersionFiles: { nvmrc: null, nodeVersion: null },
      lockfiles: [],
      environment: { required: [] },
    },
  };
}

function run(args: string[], cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
  });
}

async function fixture(fn: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'envtrail-cli-'));
  try {
    await writeFile(join(directory, 'baseline.json'), JSON.stringify(snapshot()));
    await writeFile(join(directory, 'current.json'), JSON.stringify(snapshot()));
    await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('help and version work without a project and match package version', async () => {
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Privacy: local only/);
  const manifest = JSON.parse(await readFile(join(dirname(cli), '../../package.json'), 'utf8')) as {
    version: string;
  };
  assert.equal(run(['--version']).stdout.trim(), manifest.version);
});

test('JSON comparison is parseable and has no extra stdout', async () =>
  fixture(async (directory) => {
    const result = run(['compare', 'baseline.json', 'current.json', '--json'], directory);
    assert.equal(result.status, 0, result.stderr);
    const comparison = JSON.parse(result.stdout) as {
      summary: { error: number };
      baseline: EnvSnapshot;
    };
    assert.equal(comparison.summary.error, 0);
    assert.equal(comparison.baseline.schemaVersion, 1);
  }));

test('comparison thresholds use exit 1; malformed inputs and options use exit 2', async () =>
  fixture(async (directory) => {
    const current = snapshot();
    current.runtime.node = '20.0.0';
    await writeFile(join(directory, 'current.json'), JSON.stringify(current));
    assert.equal(
      run(['compare', 'baseline.json', 'current.json', '--fail-on', 'error'], directory).status,
      1,
    );
    assert.equal(run(['compare', 'baseline.json', 'current.json'], directory).status, 0);
    assert.equal(
      run(['compare', 'baseline.json', 'current.json', '--fail-on', 'garbage'], directory).status,
      2,
    );
    await writeFile(join(directory, 'invalid.json'), '{');
    const bad = run(['inspect', 'invalid.json'], directory);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /not valid JSON/);
    assert.doesNotMatch(bad.stderr, /\n\s+at /);
    assert.equal(run(['capture', '--html', 'ignored.html'], directory).status, 2);
    assert.equal(run(['wat'], directory).status, 2);
  }));

test('reports create missing directories and do not overwrite files without --force', async () =>
  fixture(async (directory) => {
    const args = ['compare', 'baseline.json', 'current.json', '--html', 'reports/compare.html'];
    const result = run(args, directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      await readFile(join(directory, 'reports/compare.html'), 'utf8'),
      /<!doctype html>/i,
    );
    assert.equal(run(args, directory).status, 2);
    assert.equal(run([...args, '--force'], directory).status, 0);
  }));

test('snapshot input is never overwritten and output collisions fail before writing', async () =>
  fixture(async (directory) => {
    const original = await readFile(join(directory, 'baseline.json'), 'utf8');
    const args = ['compare', 'baseline.json', 'current.json', '--html', 'baseline.json', '--force'];
    assert.equal(run(args, directory).status, 2);
    assert.equal(await readFile(join(directory, 'baseline.json'), 'utf8'), original);
    assert.equal(
      run(
        [
          'compare',
          'baseline.json',
          'current.json',
          '--json',
          '--output',
          'same.json',
          '--html',
          'same.json',
        ],
        directory,
      ).status,
      2,
    );
    assert.equal(
      run(['compare', 'baseline.json', 'current.json', '--output', 'result.json'], directory)
        .status,
      2,
    );
  }));

test('capture emits only allowlisted metadata and does not execute project scripts', async () =>
  fixture(async (directory) => {
    const secret = 'ENVTRAIL_TEST_SECRET_921d6c';
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'private-customer-name',
        engines: { node: '>=22' },
        scripts: { preinstall: 'this must never run', envtrail: 'this must never run' },
      }),
    );
    await writeFile(join(directory, '.env.example'), 'ENVTRAIL_SAMPLE_KEY=\n');
    await writeFile(
      join(directory, '.env'),
      `ENVTRAIL_SAMPLE_KEY=${secret}\nUNDECLARED_SECRET=${secret}\n`,
    );
    const result = run(['capture'], directory);
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout) as EnvSnapshot;
    assert.equal(data.project.environment.required[0]?.present, true);
    assert.doesNotMatch(
      result.stdout,
      new RegExp(`${secret}|private-customer-name|UNDECLARED_SECRET`),
    );
    assert.ok(!result.stdout.includes(directory));
  }));

test('inspect prints readable metadata and rejects ambiguous project options', async () =>
  fixture(async (directory) => {
    const result = run(['inspect', 'baseline.json'], directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /22\.20\.0/);
    assert.equal(run(['inspect', 'baseline.json', '--project', '.'], directory).status, 2);
    assert.equal(
      run(['compare', 'baseline.json', 'current.json', '--project', '.'], directory).status,
      2,
    );
  }));
