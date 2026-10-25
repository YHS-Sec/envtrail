import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readSnapshot, validateOutputs, writeArtifact } from '../../src/io.js';

async function fixture(fn: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'envtrail-io-'));
  try {
    await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('output aliases through directory links are rejected before either output exists', async () =>
  fixture(async (directory) => {
    const real = join(directory, 'real');
    const alias = join(directory, 'alias');
    await mkdir(real);
    await symlink(real, alias, 'junction');
    await assert.rejects(
      validateOutputs([join(real, 'nested/report'), join(alias, 'nested/report')], [], true),
      /different file/,
    );
  }));

test('hard links to input snapshots cannot be overwritten', async () =>
  fixture(async (directory) => {
    const input = join(directory, 'input.json');
    const output = join(directory, 'output.json');
    await writeFile(input, '{}');
    await link(input, output);
    await assert.rejects(validateOutputs([output], [input], true), /hard link/);
    assert.equal(await readFile(input, 'utf8'), '{}');
  }));

test('artifact writes preserve existing files and clean temporary files on collision', async () =>
  fixture(async (directory) => {
    const output = join(directory, 'report.html');
    await writeArtifact(output, 'first', false);
    await assert.rejects(writeArtifact(output, 'second', false));
    assert.equal(await readFile(output, 'utf8'), 'first');
    assert.deepEqual(await readdir(directory), ['report.html']);
    await writeArtifact(output, 'replacement', true);
    assert.equal(await readFile(output, 'utf8'), 'replacement');
    assert.deepEqual(await readdir(directory), ['report.html']);
  }));

test('imported snapshot size is bounded and malformed schemas are rejected', async () =>
  fixture(async (directory) => {
    const input = join(directory, 'input.json');
    await writeFile(input, ' '.repeat(1024 * 1024 + 1));
    await assert.rejects(readSnapshot(input), /1 MiB/);
    await writeFile(input, '{"schemaVersion":999}');
    await assert.rejects(readSnapshot(input), /schemaVersion/);
  }));
