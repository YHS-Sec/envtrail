import semver from 'semver';
import { parseSnapshot } from './schema.js';
import {
  TOOL_NAMES,
  type Comparison,
  type EnvSnapshot,
  type Finding,
  type Severity,
  type ToolName,
} from './types.js';

/** Compare observed differences and explicit requirements; never claim a difference caused a bug. */
export function compareSnapshots(
  baselineInput: EnvSnapshot,
  currentInput: EnvSnapshot,
): Comparison {
  const baseline = parseSnapshot(baselineInput);
  const current = parseSnapshot(currentInput);
  const findings: Finding[] = [];
  const add = (
    code: string,
    severity: Severity,
    title: string,
    detail: string,
    suggestion: string,
  ): void => {
    findings.push({ code, severity, title, detail, suggestion });
  };
  for (const field of ['platform', 'arch'] as const) {
    if (baseline.system[field] !== current.system[field])
      add(
        field === 'platform' ? 'PLATFORM_DIFFERENT' : 'ARCHITECTURE_DIFFERENT',
        'warning',
        field === 'platform' ? 'Operating systems differ' : 'CPU architectures differ',
        `Baseline: ${baseline.system[field]}. Current: ${current.system[field]}. Native dependencies or platform-specific behavior may differ.`,
        'Check whether the project and its native dependencies support both environments.',
      );
  }
  for (const name of TOOL_NAMES) {
    const before = baseline.runtime[name];
    const after = current.runtime[name];
    if (before && after && before !== after)
      add(
        'RUNTIME_VERSION_DIFFERENT',
        semver.major(before) !== semver.major(after) ? 'warning' : 'info',
        `${name} versions differ`,
        `Baseline: ${before}. Current: ${after}. A version difference alone does not establish incompatibility.${name === 'node' ? '' : ' These are system/offline probes; project-specific selection was not executed or verified.'}`,
        `Use the project's declared ${name} version where available, then reproduce the issue.`,
      );
    if (
      before &&
      !after &&
      !current.project.engines[name] &&
      !current.project.packageManager?.startsWith(`${name}@`)
    )
      add(
        'TOOL_UNAVAILABLE',
        'info',
        `${name} version could not be detected`,
        `The baseline detected ${name} ${before}; the current snapshot did not. The tool may be missing, inaccessible, or unavailable to the offline version probe.`,
        `If this project uses ${name}, check its installation and PATH.`,
      );
    if (!before && after)
      add(
        'TOOL_AVAILABLE',
        'info',
        `${name} version is now detectable`,
        `The baseline did not detect ${name}; the current snapshot detected ${name} ${after}. This does not establish when or how the tool was installed.`,
        `Confirm that this ${name} installation is the one intended for the project.`,
      );
  }
  for (const name of TOOL_NAMES) {
    const range = current.project.engines[name];
    if (!range) continue;
    const actual = current.runtime[name];
    if (!actual)
      add(
        'ENGINE_TOOL_UNAVAILABLE',
        'warning',
        `Cannot verify the ${name} requirement`,
        `package.json engines.${name} requires ${range}, but the system/offline probe could not detect a version. Project-specific selection was not executed or verified.`,
        `Check the intended ${name} installation inside the project, including any project-specific version selection.`,
      );
    else if (!semver.satisfies(actual, range))
      add(
        'ENGINE_MISMATCH',
        name === 'node' ? 'error' : 'warning',
        name === 'node'
          ? `${name} does not meet the project requirement`
          : `${name} system probe differs from the project requirement`,
        name === 'node'
          ? `package.json engines.${name} requires ${range}; the current version is ${actual}.`
          : `package.json engines.${name} requires ${range}; the system/offline probe detected ${actual}. Project-specific selection was not executed or verified.`,
        name === 'node'
          ? `Select a ${name} version that satisfies ${range} and capture the environment again.`
          : `Verify the ${name} version selected inside this project before changing its installation or configuration.`,
      );
  }
  for (const [name, requirement] of Object.entries(current.project.nodeVersionFiles)) {
    if (!requirement) continue;
    const filename = name === 'nvmrc' ? '.nvmrc' : '.node-version';
    if (!/^v?\d/.test(requirement)) {
      add(
        'NODE_ALIAS_UNRESOLVED',
        'info',
        `${filename} uses a Node alias`,
        `${filename} specifies ${requirement}. EnvTrail does not resolve moving aliases or release names through the network.`,
        'Use your version manager to resolve the alias, or declare a semver range in package.json engines.node.',
      );
      continue;
    }
    const range = requirement.replace(/^v/, '');
    if (!semver.satisfies(current.runtime.node, range))
      add(
        'NODE_VERSION_MISMATCH',
        'error',
        `Node does not match ${filename}`,
        `${filename} specifies ${requirement}; the current Node version is ${current.runtime.node}.`,
        `Select the Node version declared by ${filename} and capture the environment again.`,
      );
  }
  const manager = current.project.packageManager;
  if (manager) {
    const at = manager.indexOf('@');
    const name = manager.slice(0, at) as ToolName;
    const expected = manager.slice(at + 1);
    const actual = current.runtime[name];
    if (!actual)
      add(
        'PACKAGE_MANAGER_UNAVAILABLE',
        'warning',
        `Cannot verify the pinned ${name} version`,
        `package.json packageManager specifies ${manager}, but the system/offline probe could not detect a version. Offline Corepack proxies may be unavailable. Project-specific selection was not executed or verified.`,
        `Verify that the version selected inside this project matches ${name} ${expected}; EnvTrail does not execute the project's package-manager selection.`,
      );
    else if (!semver.eq(actual, expected))
      add(
        'PACKAGE_MANAGER_MISMATCH',
        'warning',
        `The ${name} system probe differs from the project pin`,
        `package.json packageManager specifies ${manager}; the system/offline probe detected ${actual}. Project-specific selection was not executed or verified. A project override may already select the pinned version.`,
        `Verify the ${name} version selected inside this project against ${expected} before changing its installation or configuration.`,
      );
  }
  const beforeLocks = new Map(baseline.project.lockfiles.map((lock) => [lock.name, lock.sha256]));
  const afterLocks = new Map(current.project.lockfiles.map((lock) => [lock.name, lock.sha256]));
  for (const [name, hash] of afterLocks) {
    const before = beforeLocks.get(name);
    if (before && before !== hash)
      add(
        'LOCKFILE_CHANGED',
        'warning',
        `${name} contents differ`,
        `SHA-256 differs between snapshots (${before.slice(0, 12)} → ${hash.slice(0, 12)}). This shows different lockfile bytes, not which dependency changed.`,
        'Compare the lockfile in Git and install dependencies with the intended frozen or clean install command.',
      );
    else if (!before)
      add(
        'LOCKFILE_ADDED',
        'info',
        `${name} is new in the current snapshot`,
        'This lockfile was absent from the baseline. The snapshots may use different dependency resolutions.',
        'Confirm both snapshots were captured from the intended project revision.',
      );
  }
  for (const name of beforeLocks.keys())
    if (!afterLocks.has(name))
      add(
        'LOCKFILE_REMOVED',
        'info',
        `${name} is absent from the current snapshot`,
        'This lockfile was present in the baseline. The snapshots may use different package managers or project revisions.',
        'Confirm both snapshots were captured from the intended project revision.',
      );
  const lockManagers = new Set<string>(
    current.project.lockfiles.map(({ name }) =>
      name.startsWith('pnpm-')
        ? 'pnpm'
        : name.startsWith('yarn.')
          ? 'yarn'
          : name.startsWith('bun.')
            ? 'bun'
            : 'npm',
    ),
  );
  if (lockManagers.size > 1)
    add(
      'MULTIPLE_PACKAGE_MANAGERS',
      'warning',
      'Lockfiles for multiple package managers are present',
      `Detected lockfile families: ${[...lockManagers].sort().join(', ')}. This may be intentional, but dependency resolutions can differ.`,
      'Document the intended package manager and remove obsolete lockfiles when appropriate.',
    );
  if (manager && lockManagers.size > 0 && !lockManagers.has(manager.slice(0, manager.indexOf('@'))))
    add(
      'PACKAGE_MANAGER_LOCKFILE_MISMATCH',
      'warning',
      'The pinned package manager has no matching lockfile',
      `packageManager specifies ${manager}, while the detected lockfile families are ${[...lockManagers].sort().join(', ')}.`,
      'Confirm the intended package manager and commit its lockfile.',
    );
  const baselineEnvironment = new Map(
    baseline.project.environment.required.map((entry) => [entry.key, entry]),
  );
  for (const entry of current.project.environment.required) {
    if (!entry.present)
      add(
        'ENV_MISSING',
        'error',
        `Required variable ${entry.key} is absent`,
        `${entry.key} is declared in an environment example, but was not found in the process environment or a local .env file.`,
        `Configure ${entry.key} locally without committing its value, then capture again.`,
      );
    else if (baselineEnvironment.get(entry.key)?.present === false)
      add(
        'ENV_AVAILABLE',
        'info',
        `Required variable ${entry.key} is now present`,
        `${entry.key} was absent in the baseline and is now present in the process environment or a local .env file. Values and runtime loading are not checked.`,
        'Reproduce the original issue to verify that the configured value is valid and loaded by the application.',
      );
  }
  const baselineKeys = new Set(baseline.project.environment.required.map((entry) => entry.key));
  const currentKeys = new Set(current.project.environment.required.map((entry) => entry.key));
  const addedKeys = [...currentKeys].filter((key) => !baselineKeys.has(key));
  const removedKeys = [...baselineKeys].filter((key) => !currentKeys.has(key));
  if (addedKeys.length || removedKeys.length)
    add(
      'ENV_REQUIREMENTS_CHANGED',
      'info',
      'Environment variable declarations differ',
      [
        addedKeys.length ? `Added: ${addedKeys.join(', ')}.` : '',
        removedKeys.length ? `Removed: ${removedKeys.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      'Confirm both snapshots use the intended environment example files. Only current declarations are checked for presence.',
    );
  if (
    JSON.stringify(baseline.project.engines) !== JSON.stringify(current.project.engines) ||
    baseline.project.packageManager !== current.project.packageManager ||
    JSON.stringify(baseline.project.nodeVersionFiles) !==
      JSON.stringify(current.project.nodeVersionFiles)
  )
    add(
      'PROJECT_REQUIREMENTS_CHANGED',
      'info',
      'Project version requirements differ',
      'The snapshots declare different engines, packageManager, or Node version files. Requirement checks use the current snapshot.',
      'Confirm both snapshots use the intended project revision and review its version declarations.',
    );
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.code.localeCompare(b.code) ||
      a.title.localeCompare(b.title),
  );
  const summary: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) summary[finding.severity]++;
  return {
    baseline,
    current,
    baselineCapturedAt: baseline.capturedAt,
    currentCapturedAt: current.capturedAt,
    findings,
    summary,
    compatible: summary.error === 0,
  };
}
