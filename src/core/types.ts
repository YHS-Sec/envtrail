/** Snapshot files intentionally omit paths, names, environment values and dependency lists. */
export const TOOL_NAMES = ['node', 'npm', 'pnpm', 'yarn', 'bun'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const LOCKFILE_NAMES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
] as const;
export type LockfileName = (typeof LOCKFILE_NAMES)[number];
export type EnvironmentSource = 'process' | 'dotenv';

export interface EnvSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  system: { platform: string; arch: string };
  /** node is the active EnvTrail runtime; package managers are system/offline version probes. */
  runtime: {
    node: string;
    npm: string | null;
    pnpm: string | null;
    yarn: string | null;
    bun: string | null;
  };
  project: {
    engines: Partial<Record<ToolName, string>>;
    packageManager: string | null;
    nodeVersionFiles: { nvmrc: string | null; nodeVersion: string | null };
    lockfiles: Array<{ name: LockfileName; sha256: string }>;
    environment: {
      required: Array<{ key: string; present: boolean; sources: EnvironmentSource[] }>;
    };
  };
}

export type Severity = 'error' | 'warning' | 'info';
export interface Finding {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  suggestion: string;
}

export interface Comparison {
  baseline: EnvSnapshot;
  current: EnvSnapshot;
  baselineCapturedAt: string;
  currentCapturedAt: string;
  findings: Finding[];
  summary: Record<Severity, number>;
  /** True when no explicit project requirement is known to be unmet. Warnings still need review. */
  compatible: boolean;
}
