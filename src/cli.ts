#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureSnapshot } from './core/capture.js';
import { compareSnapshots } from './core/compare.js';
import type { Comparison, EnvSnapshot } from './core/types.js';
import { renderHtmlReport } from './report.js';
import { readSnapshot, serialize, validateOutputs, writeArtifact } from './io.js';
import { VERSION } from './version.js';

const HELP = `EnvTrail ${VERSION} — explain "it works on my machine".

Usage:
  envtrail capture [--project dir] [--output file] [--force]
  envtrail compare baseline.json [current.json] [options]
  envtrail inspect [snapshot.json] [--project dir]

Commands:
  capture    Collect a Node project's environment; JSON goes to stdout by default.
  compare    Compare two snapshots, or compare a baseline with this machine.
  inspect    Read a snapshot in plain text, or inspect the current project.

Options:
  -p, --project dir       Project directory (default: current directory).
  -o, --output file       Save capture JSON; compare requires --json.
      --html file         Save a standalone, offline HTML comparison report.
      --json              Print a machine-readable comparison.
      --fail-on level     Exit 1 on error, warning, or never (default: never).
      --force             Replace existing output files; never replace inputs.
  -h, --help              Show this help.
  -v, --version           Show version.

Examples:
  envtrail capture -o snapshots/baseline.json
  envtrail compare snapshots/baseline.json --html reports/compare.html
  envtrail compare baseline.json current.json --json --fail-on error

Privacy: local only. No environment variable values, usernames, or absolute paths
are recorded in snapshots. Only keys declared in .env.example, .env.sample, or
.env.template are checked. Review variable names and metadata before sharing.
Exit codes: 0 success, 1 comparison threshold reached, 2 invalid input or failure.
`;

type Option = 'project' | 'output' | 'html' | 'json' | 'fail-on' | 'force' | 'help' | 'version';

function checkOptions(values: object, allowed: Option[]): void {
  for (const key of Object.keys(values) as Option[]) {
    if (!allowed.includes(key))
      throw new Error(`Option --${key} is not supported by this command.`);
  }
}

function cleanTerminal(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}

export function formatComparison(comparison: Comparison): string {
  const { error, warning, info } = comparison.summary;
  const lines = [
    'ENVTRAIL / ENVIRONMENT COMPARISON',
    `${error} error(s) · ${warning} warning(s) · ${info} note(s)`,
    'Differences are diagnostic evidence, not a guaranteed root cause.',
    '',
  ];
  for (const finding of comparison.findings) {
    lines.push(`[${finding.severity.toUpperCase()}] ${finding.title}`);
    lines.push(`  ${finding.detail}`, `  Next: ${finding.suggestion}`, '');
  }
  if (!comparison.findings.length)
    lines.push('No differences found in the fields EnvTrail checks.', '');
  return cleanTerminal(`${lines.join('\n')}\n`);
}

export function formatSnapshot(snapshot: EnvSnapshot): string {
  const lines = [
    'ENVTRAIL / SNAPSHOT',
    `Captured: ${snapshot.capturedAt}`,
    `System: ${snapshot.system.platform} / ${snapshot.system.arch}`,
    '',
    'Runtime',
    ...Object.entries(snapshot.runtime).map(
      ([key, value]) => `  ${key.padEnd(6)} ${value ?? 'not detected'}`,
    ),
    '',
    'Project requirements',
    ...Object.entries(snapshot.project.engines).map(([key, value]) => `  engines.${key}: ${value}`),
    `  packageManager: ${snapshot.project.packageManager ?? 'not declared'}`,
    `  .nvmrc: ${snapshot.project.nodeVersionFiles.nvmrc ?? 'not declared'}`,
    `  .node-version: ${snapshot.project.nodeVersionFiles.nodeVersion ?? 'not declared'}`,
    `  lockfiles: ${snapshot.project.lockfiles.map((file) => file.name).join(', ') || 'none'}`,
    '',
    'Declared environment keys (values never recorded)',
    ...snapshot.project.environment.required.map(
      (item) => `  ${item.present ? '[present]' : '[missing]'} ${item.key}`,
    ),
    '',
  ];
  return cleanTerminal(`${lines.join('\n')}\n`);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      project: { type: 'string', short: 'p' },
      output: { type: 'string', short: 'o' },
      html: { type: 'string' },
      json: { type: 'boolean' },
      'fail-on': { type: 'string' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return 0;
  }
  const [command, ...files] = positionals;
  for (const key of ['project', 'output', 'html'] as const) {
    if (values[key] === '') throw new Error(`--${key} must not be empty.`);
  }
  const project = resolve(values.project ?? '.');
  const force = values.force ?? false;

  if (command === 'capture') {
    checkOptions(values, ['project', 'output', 'force']);
    if (files.length)
      throw new Error('capture accepts no positional arguments. Use --project dir.');
    if (values.output) await validateOutputs([values.output], [], force);
    const snapshot = await captureSnapshot(project);
    const content = serialize(snapshot);
    if (values.output) {
      await writeArtifact(values.output, content, force);
      process.stdout.write(`Snapshot saved to ${JSON.stringify(values.output)}.\n`);
    } else process.stdout.write(content);
    return 0;
  }
  if (command === 'inspect') {
    checkOptions(values, ['project']);
    if (files.length > 1) throw new Error('inspect accepts at most one snapshot.');
    if (files.length && values.project)
      throw new Error('--project cannot be used with a snapshot file.');
    const snapshot = files[0] ? await readSnapshot(files[0]) : await captureSnapshot(project);
    process.stdout.write(formatSnapshot(snapshot));
    return 0;
  }
  if (command === 'compare') {
    checkOptions(values, ['project', 'output', 'html', 'json', 'fail-on', 'force']);
    if (!files[0] || files.length > 2)
      throw new Error('compare requires a baseline and optionally a current snapshot.');
    if (files[1] && values.project)
      throw new Error('--project is only used when capturing the current environment.');
    if (values.output && !values.json) throw new Error('compare --output requires --json.');
    const threshold = values['fail-on'] ?? 'never';
    if (!['never', 'error', 'warning'].includes(threshold))
      throw new Error('--fail-on must be never, error, or warning.');
    const outputs = [values.output, values.html].filter(
      (value): value is string => value !== undefined,
    );
    await validateOutputs(outputs, files, force);
    const baseline = await readSnapshot(files[0]);
    const current = files[1] ? await readSnapshot(files[1]) : await captureSnapshot(project);
    const comparison = compareSnapshots(baseline, current);
    if (values.html) await writeArtifact(values.html, renderHtmlReport(comparison), force);
    const result = values.json ? serialize(comparison) : formatComparison(comparison);
    if (values.output) {
      await writeArtifact(values.output, result, force);
      process.stdout.write(`Comparison saved to ${JSON.stringify(values.output)}.\n`);
    } else process.stdout.write(result);
    if (values.html && !values.json)
      process.stdout.write(`HTML report saved to ${JSON.stringify(values.html)}.\n`);
    if (threshold === 'error' && comparison.summary.error > 0) return 1;
    if (threshold === 'warning' && comparison.summary.error + comparison.summary.warning > 0)
      return 1;
    return 0;
  }
  throw new Error(`Unknown command ${JSON.stringify(command)}. Run envtrail --help.`);
}

if (
  process.argv[1] &&
  pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'Unexpected failure.';
      process.stderr.write(`EnvTrail: ${cleanTerminal(detail)}\n`);
      process.exitCode = 2;
    });
}
