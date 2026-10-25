import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeNodeVersion,
  normalizePackageManager,
  parseSnapshot,
} from '../../src/core/schema.js';
import { snapshot } from './helpers.js';

test('valid snapshots are cloned and retain their closed schema', () => {
  const original = snapshot();
  const parsed = parseSnapshot(original);
  assert.deepEqual(parsed, original);
  parsed.project.environment.required[0]!.present = false;
  assert.equal(original.project.environment.required[0]!.present, true);
});

test('schema rejects unknown fields that could contain paths or environment values', () => {
  const withPath = { ...snapshot(), cwd: '/private/project' };
  assert.throws(() => parseSnapshot(withPath), /unsupported fields/);
  const withSecret = snapshot() as unknown as Record<string, unknown>;
  (withSecret.project as { environment: unknown }).environment = {
    required: [{ key: 'TOKEN', present: true, sources: ['process'], value: 'secret' }],
  };
  assert.throws(() => parseSnapshot(withSecret), /unsupported fields/);
});

test('schema rejects unsupported versions, malformed records, dates and excessive collections', () => {
  const cases: unknown[] = [
    null,
    [],
    {},
    { ...snapshot(), schemaVersion: 2 },
    { ...snapshot(), capturedAt: '2026-02-31T00:00:00.000Z' },
  ];
  const invalidRuntime = snapshot();
  invalidRuntime.runtime.npm = '<script>1.2.3</script>';
  cases.push(invalidRuntime);
  const invalidKey = snapshot();
  invalidKey.project.environment.required[0]!.key = 'TOKEN\nSECRET';
  cases.push(invalidKey);
  const mismatch = snapshot();
  mismatch.project.environment.required[0]!.sources = [];
  cases.push(mismatch);
  const duplicates = snapshot();
  duplicates.project.environment.required.push(duplicates.project.environment.required[0]!);
  cases.push(duplicates);
  const invalidLock = snapshot();
  invalidLock.project.lockfiles[0]!.sha256 = 'x'.repeat(64);
  cases.push(invalidLock);
  const duplicateLock = snapshot();
  duplicateLock.project.lockfiles.push(duplicateLock.project.lockfiles[0]!);
  cases.push(duplicateLock);
  const tooManyKeys = snapshot();
  tooManyKeys.project.environment.required = Array.from({ length: 257 }, (_, index) => ({
    key: `KEY_${index}`,
    present: false,
    sources: [],
  }));
  cases.push(tooManyKeys);
  for (const value of cases) assert.throws(() => parseSnapshot(value), /Invalid EnvTrail snapshot/);
});

test('only safe Node version declarations and pinned package managers survive normalization', () => {
  assert.equal(normalizeNodeVersion('# comment\n v22.14.0 # team version\n'), 'v22.14.0');
  assert.equal(normalizeNodeVersion('lts/*'), 'lts/*');
  assert.equal(normalizeNodeVersion('22'), '22');
  assert.equal(normalizeNodeVersion('/home/private/node'), null);
  assert.equal(normalizeNodeVersion('v22.01'), null);
  assert.equal(normalizePackageManager('pnpm@10.2.0+sha512.aabbcc'), 'pnpm@10.2.0');
  assert.equal(normalizePackageManager('npm@latest'), null);
  assert.equal(normalizePackageManager('https://example.invalid/private'), null);
});
