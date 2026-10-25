import semver from 'semver';
import { LOCKFILE_NAMES, TOOL_NAMES, type EnvSnapshot, type ToolName } from './types.js';

const platforms = new Set([
  'aix',
  'android',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'openbsd',
  'sunos',
  'win32',
  'cygwin',
  'netbsd',
]);
const architectures = new Set([
  'arm',
  'arm64',
  'ia32',
  'loong64',
  'mips',
  'mipsel',
  'ppc',
  'ppc64',
  'riscv64',
  's390',
  's390x',
  'x64',
]);
export const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

function fail(path: string): never {
  throw new Error(`Invalid EnvTrail snapshot: ${path}.`);
}
function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key)))
    fail(`${path} contains unsupported fields`);
  return result;
}
function string(value: unknown, path: string, max = 200): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    fail(path);
  return value;
}
function version(value: unknown, path: string): string {
  const result = string(value, path, 128);
  if (semver.valid(result) === null || result.startsWith('v') || result.startsWith('=')) fail(path);
  return result;
}
export function normalizeNodeVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .find((line) => line && !line.startsWith('#'));
  if (!token || token.length > 128) return null;
  if (/^v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/.test(token) && semver.validRange(token))
    return token;
  if (/^(?:lts\/(?:[a-z]+|\*)|node|stable|latest|system)$/.test(token)) return token;
  return null;
}
export function normalizePackageManager(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  const match = /^(npm|pnpm|yarn|bun)@(.+)$/.exec(value);
  if (!match || !match[2] || !semver.valid(match[2]) || !/^\d/.test(match[2])) return null;
  // Corepack integrity hashes are not useful environment comparison data.
  return `${match[1]}@${semver.parse(match[2])?.version}`;
}

/** Validate a closed, bounded schema before a file is rendered or compared. */
export function parseSnapshot(input: unknown): EnvSnapshot {
  const root = object(input, 'root', [
    'schemaVersion',
    'capturedAt',
    'system',
    'runtime',
    'project',
  ]);
  if (root.schemaVersion !== 1) fail('schemaVersion must be 1');
  const capturedAt = string(root.capturedAt, 'capturedAt', 30);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(capturedAt) ||
    !Number.isFinite(Date.parse(capturedAt)) ||
    new Date(capturedAt).toISOString() !== capturedAt
  )
    fail('capturedAt must be an ISO UTC timestamp');
  const system = object(root.system, 'system', ['platform', 'arch']);
  const platform = string(system.platform, 'system.platform', 20);
  const arch = string(system.arch, 'system.arch', 20);
  if (!platforms.has(platform) || !architectures.has(arch)) fail('system');
  const rawRuntime = object(root.runtime, 'runtime', TOOL_NAMES);
  const runtime: EnvSnapshot['runtime'] = {
    node: version(rawRuntime.node, 'runtime.node'),
    npm: null,
    pnpm: null,
    yarn: null,
    bun: null,
  };
  for (const name of TOOL_NAMES.filter((tool) => tool !== 'node')) {
    runtime[name] = rawRuntime[name] === null ? null : version(rawRuntime[name], `runtime.${name}`);
  }
  const rawProject = object(root.project, 'project', [
    'engines',
    'packageManager',
    'nodeVersionFiles',
    'lockfiles',
    'environment',
  ]);
  const rawEngines = object(rawProject.engines, 'project.engines', TOOL_NAMES);
  const engines: Partial<Record<ToolName, string>> = {};
  for (const name of TOOL_NAMES) {
    if (rawEngines[name] !== undefined) {
      const range = string(rawEngines[name], `project.engines.${name}`);
      if (!semver.validRange(range)) fail(`project.engines.${name}`);
      engines[name] = range;
    }
  }
  const packageManager =
    rawProject.packageManager === null ? null : normalizePackageManager(rawProject.packageManager);
  if (
    rawProject.packageManager !== null &&
    (packageManager === null || packageManager !== rawProject.packageManager)
  )
    fail('project.packageManager');
  const rawVersions = object(rawProject.nodeVersionFiles, 'project.nodeVersionFiles', [
    'nvmrc',
    'nodeVersion',
  ]);
  const nodeVersionFiles: EnvSnapshot['project']['nodeVersionFiles'] = {
    nvmrc: null,
    nodeVersion: null,
  };
  for (const key of ['nvmrc', 'nodeVersion'] as const) {
    if (rawVersions[key] !== null) {
      const nodeVersion = string(rawVersions[key], `project.nodeVersionFiles.${key}`, 128);
      if (normalizeNodeVersion(nodeVersion) !== nodeVersion)
        fail(`project.nodeVersionFiles.${key}`);
      nodeVersionFiles[key] = nodeVersion;
    }
  }
  if (!Array.isArray(rawProject.lockfiles) || rawProject.lockfiles.length > LOCKFILE_NAMES.length)
    fail('project.lockfiles');
  const lockfiles: EnvSnapshot['project']['lockfiles'] = [];
  const lockNames = new Set<string>();
  for (const entry of rawProject.lockfiles) {
    const lock = object(entry, 'project.lockfiles entry', ['name', 'sha256']);
    const name = string(lock.name, 'project.lockfiles.name', 30);
    const sha256 = string(lock.sha256, 'project.lockfiles.sha256', 64);
    if (
      !LOCKFILE_NAMES.includes(name as (typeof LOCKFILE_NAMES)[number]) ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      lockNames.has(name)
    )
      fail('project.lockfiles');
    lockNames.add(name);
    lockfiles.push({ name: name as (typeof LOCKFILE_NAMES)[number], sha256 });
  }
  const environment = object(rawProject.environment, 'project.environment', ['required']);
  if (!Array.isArray(environment.required) || environment.required.length > 256)
    fail('project.environment.required');
  const required: EnvSnapshot['project']['environment']['required'] = [];
  const envKeys = new Set<string>();
  for (const entry of environment.required) {
    const env = object(entry, 'project.environment.required entry', ['key', 'present', 'sources']);
    const key = string(env.key, 'environment key', 128);
    if (
      !ENV_KEY.test(key) ||
      envKeys.has(key) ||
      typeof env.present !== 'boolean' ||
      !Array.isArray(env.sources) ||
      env.sources.length > 2
    )
      fail('project.environment.required');
    const sources: Array<'process' | 'dotenv'> = [];
    for (const source of env.sources) {
      if ((source !== 'process' && source !== 'dotenv') || sources.includes(source))
        fail('environment sources');
      sources.push(source);
    }
    if (env.present !== sources.length > 0) fail('environment presence does not match its sources');
    envKeys.add(key);
    required.push({ key, present: env.present, sources });
  }
  return {
    schemaVersion: 1,
    capturedAt,
    system: { platform, arch },
    runtime,
    project: { engines, packageManager, nodeVersionFiles, lockfiles, environment: { required } },
  };
}
