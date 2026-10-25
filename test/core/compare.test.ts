import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSnapshots } from '../../src/core/compare.js';
import { snapshot } from './helpers.js';

test('identical compliant environments have no findings and do not mutate input', () => {
  const before = snapshot();
  const current = snapshot();
  const comparison = compareSnapshots(before, current);
  assert.deepEqual(comparison.summary, { error: 0, warning: 0, info: 0 });
  assert.equal(comparison.compatible, true);
  assert.notEqual(comparison.current, current);
  assert.deepEqual(current, before);
});

test('Node engine and variable violations are errors while system package-manager differences are warnings', () => {
  const current = snapshot();
  current.runtime.node = '20.19.0';
  current.runtime.npm = '9.9.4';
  current.project.environment.required[0]!.present = false;
  current.project.environment.required[0]!.sources = [];
  const comparison = compareSnapshots(snapshot(), current);
  assert.equal(comparison.compatible, false);
  assert.equal(comparison.summary.error, 2);
  for (const code of ['ENGINE_MISMATCH', 'ENV_MISSING']) {
    const finding = comparison.findings.find((item) => item.code === code);
    assert.equal(finding?.severity, 'error');
    assert.ok(finding?.detail);
    assert.ok(finding?.suggestion);
  }
  assert.equal(
    comparison.findings.find((item) => item.code === 'PACKAGE_MANAGER_MISMATCH')?.severity,
    'warning',
  );
});

test('system package-manager probes cannot establish that project-specific selection is incompatible', () => {
  const current = snapshot();
  current.project.packageManager = 'npm@11.0.0';
  current.project.engines.npm = '>=11';
  const comparison = compareSnapshots(snapshot(), current);
  assert.equal(comparison.summary.error, 0);
  assert.equal(comparison.compatible, true);
  for (const code of ['PACKAGE_MANAGER_MISMATCH', 'ENGINE_MISMATCH']) {
    const finding = comparison.findings.find((item) => item.code === code);
    assert.equal(finding?.severity, 'warning');
    assert.match(finding!.detail, /system\/offline probe/);
    assert.match(finding!.detail, /Project-specific selection was not executed or verified/);
  }
});

test('version differences alone are not labeled an error or a proven cause', () => {
  const current = snapshot();
  current.runtime.node = '24.1.0';
  const comparison = compareSnapshots(snapshot(), current);
  assert.equal(comparison.summary.error, 0);
  assert.equal(comparison.compatible, true);
  assert.equal(comparison.findings[0]?.severity, 'warning');
  assert.match(comparison.findings[0]!.detail, /does not establish incompatibility/);
});

test('numeric version files support partial versions while aliases are left unresolved', () => {
  const current = snapshot();
  current.project.nodeVersionFiles = { nvmrc: '22', nodeVersion: 'lts/*' };
  let comparison = compareSnapshots(snapshot(), current);
  assert.equal(comparison.summary.error, 0);
  assert.ok(comparison.findings.some((finding) => finding.code === 'NODE_ALIAS_UNRESOLVED'));
  current.project.nodeVersionFiles.nvmrc = '22.13.0';
  comparison = compareSnapshots(snapshot(), current);
  assert.equal(
    comparison.findings.find((finding) => finding.code === 'NODE_VERSION_MISMATCH')?.severity,
    'error',
  );
});

test('unavailable tools are uncertainty warnings, rather than claiming absence or incompatibility', () => {
  const current = snapshot();
  current.runtime.npm = null;
  const comparison = compareSnapshots(snapshot(), current);
  assert.equal(comparison.summary.error, 0);
  assert.equal(
    comparison.findings.find((finding) => finding.code === 'PACKAGE_MANAGER_UNAVAILABLE')?.severity,
    'warning',
  );
});

test('newly detectable tools and restored environment presence remain visible as differences', () => {
  const before = snapshot();
  before.project.environment.required[0]!.present = false;
  before.project.environment.required[0]!.sources = [];
  const current = snapshot();
  current.runtime.pnpm = '10.10.0';
  const comparison = compareSnapshots(before, current);
  assert.equal(comparison.summary.error, 0);
  assert.equal(
    comparison.findings.find((finding) => finding.code === 'TOOL_AVAILABLE')?.severity,
    'info',
  );
  assert.equal(
    comparison.findings.find((finding) => finding.code === 'ENV_AVAILABLE')?.severity,
    'info',
  );
});

test('lockfile, platform, architecture and current declarations are compared independently', () => {
  const current = snapshot();
  current.system = { platform: 'win32', arch: 'arm64' };
  current.project.lockfiles[0]!.sha256 = 'b'.repeat(64);
  current.project.lockfiles.push({ name: 'yarn.lock', sha256: 'c'.repeat(64) });
  current.project.environment.required = [];
  const comparison = compareSnapshots(snapshot(), current);
  for (const code of [
    'PLATFORM_DIFFERENT',
    'ARCHITECTURE_DIFFERENT',
    'LOCKFILE_CHANGED',
    'LOCKFILE_ADDED',
    'MULTIPLE_PACKAGE_MANAGERS',
    'ENV_REQUIREMENTS_CHANGED',
  ])
    assert.ok(
      comparison.findings.some((finding) => finding.code === code),
      code,
    );
  assert.equal(
    comparison.summary.error,
    0,
    'removed declarations do not prove a variable is missing',
  );
});

test('requirements use the current project and prerelease versions obey semver', () => {
  const current = snapshot();
  current.project.engines.node = '>=24';
  current.runtime.node = '24.0.0-rc.1';
  const comparison = compareSnapshots(snapshot(), current);
  assert.ok(comparison.findings.some((finding) => finding.code === 'ENGINE_MISMATCH'));
  assert.ok(comparison.findings.some((finding) => finding.code === 'PROJECT_REQUIREMENTS_CHANGED'));
});
