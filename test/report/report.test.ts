import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { renderHtmlReport } from '../../src/report.js';
import type { Comparison, EnvSnapshot, Finding } from '../../src/core/types.js';

function snapshot(): EnvSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: '2026-10-25T10:30:00.000Z',
    system: { platform: 'linux', arch: 'x64' },
    runtime: { node: '22.20.0', npm: '10.9.3', pnpm: null, yarn: null, bun: null },
    project: {
      engines: { node: '>=22' },
      packageManager: 'npm@10.9.3',
      nodeVersionFiles: { nvmrc: '22', nodeVersion: null },
      lockfiles: [{ name: 'package-lock.json', sha256: 'a'.repeat(64) }],
      environment: { required: [{ key: 'DATABASE_URL', present: true, sources: ['process'] }] },
    },
  };
}

function comparison(findings: Finding[] = []): Comparison {
  return {
    baseline: snapshot(),
    current: snapshot(),
    baselineCapturedAt: '2026-10-25T10:30:00.000Z',
    currentCapturedAt: '2026-10-25T11:45:00.000Z',
    compatible: !findings.some((finding) => finding.severity === 'error'),
    findings,
    summary: {
      error: findings.filter((finding) => finding.severity === 'error').length,
      warning: findings.filter((finding) => finding.severity === 'warning').length,
      info: findings.filter((finding) => finding.severity === 'info').length,
    },
  };
}

test('report renders portable context, findings, and actionable next steps', () => {
  const input = comparison([
    {
      severity: 'warning',
      code: 'runtime-drift',
      title: 'Runtime versions differ',
      detail: 'The baseline uses Node.js 22.20.0.',
      suggestion: 'Choose the same Node.js release.',
    },
    {
      severity: 'error',
      code: 'missing-environment-key',
      title: 'A required key is missing',
      detail: 'DATABASE_URL is absent from the current environment.',
      suggestion: 'Set DATABASE_URL locally, then capture again.',
    },
    {
      severity: 'info',
      code: 'system-difference',
      title: 'System architecture differs',
      detail: 'Some native dependencies can behave differently.',
      suggestion: 'Review native dependency support.',
    },
  ]);
  input.current.runtime.node = '24.1.0';
  input.current.project.environment.required[0]!.present = false;
  const html = renderHtmlReport(input);

  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Action required/);
  assert.match(html, /<h1 id="report-title">Environment comparison<\/h1>/);
  assert.match(html, /<h2 id="findings-title">Findings<span class="findings-count">3<\/span>/);
  assert.match(html, /<h3 class="priority-heading">.*?Resolve first<\/h3>/);
  assert.ok(html.indexOf('Runtime &amp; environment') < html.indexOf('id="findings"'));
  assert.ok(html.indexOf('A required key is missing') < html.indexOf('Runtime versions differ'));
  assert.ok(html.indexOf('Runtime versions differ') < html.indexOf('System architecture differs'));
  assert.match(html, /Suggested next step/);
  assert.match(html, /Set DATABASE_URL locally, then capture again\./);
  assert.match(html, /2026-10-25 · 10:30:00 UTC/);
  assert.match(html, /<td class="changed">24\.1\.0<\/td>/);
  assert.match(html, /<td class="changed">0 \/ 1 present<\/td>/);
  assert.match(html, /<th scope="row">Node\.js requirement<\/th><td>&gt;=22<\/td>/);
  assert.match(html, /@media\(max-width:700px\)/);
  assert.match(html, /@media print/);
});

test('report escapes all untrusted fields and never places untrusted text in CSS', () => {
  const attack = `</style><script>alert("secret")</script><img src=x onerror='alert(1)'>&`;
  const input = comparison([
    { severity: 'error', code: attack, title: attack, detail: attack, suggestion: attack },
  ]);
  input.current.runtime.node = attack;
  input.current.project.engines.node = attack;
  input.current.project.nodeVersionFiles.nvmrc = attack;
  input.current.project.packageManager = attack;
  input.current.system.platform = attack;
  const html = renderHtmlReport(input);

  assert.doesNotMatch(html, /<script\b|<img\b|onerror='alert/);
  assert.ok(!html.includes(attack));
  assert.match(html, /&lt;\/style&gt;&lt;script&gt;alert\(&quot;secret&quot;\)&lt;\/script&gt;/);
  assert.match(html, /onerror=&#39;alert\(1\)&#39;/);
  assert.match(html, /&gt;&amp;/);
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(style);
  assert.ok(!style.includes('alert'));
  assert.equal((html.match(/<style>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/style>/g) ?? []).length, 1);
});

test('even invalid runtime severity values cannot inject HTML or CSS classes', () => {
  const input = comparison([
    {
      severity: 'info" onclick="alert(1)' as Finding['severity'],
      code: 'unexpected-input',
      title: 'Safe fallback',
      detail: 'Details',
      suggestion: 'Review',
    },
  ]);
  const html = renderHtmlReport(input);
  assert.doesNotMatch(html, /onclick=/);
  assert.match(html, /class="tag info">Note/);
});

test('report has no script, remote resources, embedded snapshot, or telemetry', () => {
  const input = comparison();
  const html = renderHtmlReport(input);

  assert.doesNotMatch(html, /<script\b|<iframe\b|<object\b|<embed\b|<form\b|<link\b/i);
  assert.doesNotMatch(html, /\b(?:src|href)\s*=\s*["'](?:https?:|\/\/|data:)/i);
  assert.doesNotMatch(html, /@import|url\s*\(|fetch\s*\(|XMLHttpRequest|sendBeacon/i);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'none'/);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(css);
  const hash = createHash('sha256').update(css, 'utf8').digest('base64');
  assert.ok(html.includes(`style-src 'sha256-${hash}'`));
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /Generated locally\. No telemetry\./);
  assert.ok(!html.includes(JSON.stringify(input)));
});

test('report allowlists fields and omits extra snapshot paths, names, and environment values', () => {
  const input = comparison();
  Object.assign(input.current, {
    cwd: 'C:\\Users\\private-user\\private-project',
    home: '/home/private-user',
    username: 'DO_NOT_DISCLOSE_USERNAME',
    projectName: 'DO_NOT_DISCLOSE_PROJECT_NAME',
  });
  Object.assign(input.current.project.environment.required[0]!, {
    value: 'postgres://private:SECRET_PASSWORD@localhost/db',
  });
  Object.assign(input.current.project, { dependencies: { DO_NOT_DISCLOSE_DEPENDENCY: '*' } });
  const html = renderHtmlReport(input);

  for (const privateValue of [
    'private-user',
    'private-project',
    'DO_NOT_DISCLOSE',
    'SECRET_PASSWORD',
    'postgres://',
  ]) {
    assert.ok(!html.includes(privateValue), `${privateValue} should not be included`);
  }
  assert.match(html, /Environment-variable values/);
  assert.match(html, /Absolute project and home paths/);
});

test('clean reports explain the limits of supported checks without claiming parity', () => {
  const html = renderHtmlReport(comparison());
  assert.match(html, /No blockers found/);
  assert.match(html, /No differences found in supported checks\./);
  assert.match(html, /Application behavior can still depend on services/);
  assert.doesNotMatch(html, /class="issue"/);
  assert.match(html, /scope="col">Baseline/);
  assert.match(html, /scope="col">Current/);
  assert.match(html, /scope="row">Node\.js/);
});

test('warning-only reports remain reviewable and counts derive from visible findings', () => {
  const input = comparison([
    {
      severity: 'warning',
      code: 'warning',
      title: 'Review this',
      detail: 'Review the version difference.',
      suggestion: '',
    },
  ]);
  input.summary = { error: 999, warning: 999, info: 999 };
  const html = renderHtmlReport(input);

  assert.match(html, /Review recommended/);
  assert.match(
    html,
    /class="summary-item warning"><span class="dot" aria-hidden="true"><\/span><strong>1<\/strong> warning/,
  );
  assert.doesNotMatch(html, /<strong>999<\/strong>/);
  assert.doesNotMatch(html, /class="action"/);
});

test('report sections are reachable without JavaScript and missing probes remain inconclusive', () => {
  const input = comparison();
  input.current.runtime.npm = null;
  const html = renderHtmlReport(input);
  for (const section of ['overview', 'findings', 'environment', 'sharing']) {
    assert.ok(html.includes(`href="#${section}"`));
    assert.ok(html.includes(`id="${section}"`));
  }
  assert.match(html, /<td class="changed">Not detected<\/td>/);
  assert.doesNotMatch(html, /Not installed|Same project\.|Spot the difference\./);
});

test('invalid timestamps use a safe, stable fallback and rendering is deterministic', () => {
  const input = comparison();
  input.baselineCapturedAt = '<img src=x onerror=alert(1)>';
  const first = renderHtmlReport(input);
  const second = renderHtmlReport(input);
  assert.equal(first, second);
  assert.match(first, /Unknown capture time/);
  assert.doesNotMatch(first, /<img/);
});
