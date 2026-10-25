import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { ENV_KEY, normalizeNodeVersion, normalizePackageManager } from './schema.js';
import { LOCKFILE_NAMES, TOOL_NAMES, type EnvSnapshot } from './types.js';

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_LOCK_BYTES = 32 * 1024 * 1024;
const EXAMPLE_NAMES = ['.env.example', '.env.sample', '.env.template'];

async function readFileBounded(
  directory: string,
  name: string,
  maximum = MAX_CONFIG_BYTES,
): Promise<Buffer | null> {
  // Only fixed names or names from a direct directory listing are passed here.
  const filename = path.join(directory, name);
  let handle;
  try {
    // Open first: pathname checks must never authorize a later open of a different file.
    // NONBLOCK also prevents a substituted FIFO from blocking before fstat can reject it.
    const flags =
      constants.O_RDONLY |
      (process.platform === 'win32'
        ? 0
        : (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    handle = await open(filename, flags);
    const stat = await handle.stat();
    if (!stat.isFile())
      throw new Error(`Cannot read ${name}: expected a regular file, not a link.`);
    if (process.platform === 'win32') {
      // Windows has no O_NOFOLLOW. Reject links and replacement paths after opening,
      // and only read from the already-opened, identity-checked file handle.
      const pathnameStat = await lstat(filename);
      if (pathnameStat.isSymbolicLink() || !pathnameStat.isFile())
        throw new Error(`Cannot read ${name}: expected a regular file, not a link.`);
      if (pathnameStat.dev !== stat.dev || pathnameStat.ino !== stat.ino)
        throw new Error(`Cannot read ${name}: file changed while being captured.`);
    }
    if (stat.size > maximum)
      throw new Error(`Cannot read ${name}: file exceeds the ${maximum} byte safety limit.`);
    const bytes = Buffer.alloc(Math.min(stat.size + 1, maximum + 1));
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const finalStat = await handle.stat();
    if (
      total > maximum ||
      total !== stat.size ||
      finalStat.size !== stat.size ||
      finalStat.mtimeMs !== stat.mtimeMs ||
      finalStat.ino !== stat.ino ||
      finalStat.dev !== stat.dev
    )
      throw new Error(`Cannot read ${name}: file changed while being captured.`);
    return bytes.subarray(0, total);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP' || code === 'EISDIR')
      throw new Error(`Cannot read ${name}: expected a regular file, not a link.`);
    if (error instanceof Error && error.message.startsWith('Cannot read ')) throw error;
    throw new Error(`Cannot read ${name}. Check its permissions and try again.`);
  } finally {
    await handle?.close();
  }
}

/** Extract variable names only; dotenv values never leave this function. */
export function parseEnvironmentKeys(text: string): string[] {
  const keys = new Set<string>();
  let openQuote: string | null = null;
  const remainingQuote = (value: string, quote: string): string | null => {
    for (let index = 0; index < value.length; index++) {
      if (value[index] === '\\') {
        index++;
        continue;
      }
      if (value[index] === quote) return null;
    }
    return quote;
  };
  for (const line of text.split(/\r?\n/)) {
    if (openQuote !== null) {
      openQuote = remainingQuote(line, openQuote);
      continue;
    }
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match?.[1]) continue;
    if (ENV_KEY.test(match[1])) keys.add(match[1]);
    const value = (match[2] ?? '').trimStart();
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === '`')
      openQuote = remainingQuote(value.slice(1), quote);
  }
  return [...keys].sort();
}

export async function readProject(projectDir: string): Promise<EnvSnapshot['project']> {
  const packageBytes = await readFileBounded(projectDir, 'package.json');
  if (packageBytes === null)
    throw new Error('No package.json found. Run EnvTrail inside a Node project or pass --project.');
  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(packageBytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Invalid package.json');
    config = parsed as Record<string, unknown>;
  } catch {
    throw new Error('Cannot parse package.json. Expected a valid JSON object.');
  }
  const engines: EnvSnapshot['project']['engines'] = {};
  if (config.engines !== undefined) {
    if (!config.engines || typeof config.engines !== 'object' || Array.isArray(config.engines))
      throw new Error('package.json engines must be an object.');
    const raw = config.engines as Record<string, unknown>;
    for (const name of TOOL_NAMES) {
      if (raw[name] !== undefined) {
        if (
          typeof raw[name] !== 'string' ||
          raw[name].length === 0 ||
          raw[name].length > 200 ||
          /[\x00-\x1f\x7f]/.test(raw[name]) ||
          !semver.validRange(raw[name])
        )
          throw new Error(`package.json engines.${name} must be a valid semver range.`);
        engines[name] = raw[name];
      }
    }
  }
  let packageManager: string | null = null;
  if (config.packageManager !== undefined) {
    packageManager = normalizePackageManager(config.packageManager);
    if (packageManager === null)
      throw new Error(
        'package.json packageManager must pin npm, pnpm, yarn, or bun to a semver version.',
      );
  }
  const nodeVersionFiles: EnvSnapshot['project']['nodeVersionFiles'] = {
    nvmrc: null,
    nodeVersion: null,
  };
  for (const [filename, key] of [
    ['.nvmrc', 'nvmrc'],
    ['.node-version', 'nodeVersion'],
  ] as const) {
    const bytes = await readFileBounded(projectDir, filename, 4096);
    if (bytes !== null) {
      nodeVersionFiles[key] = normalizeNodeVersion(bytes.toString('utf8'));
      if (nodeVersionFiles[key] === null)
        throw new Error(
          `${filename} must contain a Node version or a supported alias such as lts/*.`,
        );
    }
  }
  const lockfiles: EnvSnapshot['project']['lockfiles'] = [];
  for (const name of LOCKFILE_NAMES) {
    const bytes = await readFileBounded(projectDir, name, MAX_LOCK_BYTES);
    if (bytes !== null)
      lockfiles.push({ name, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const requiredKeys = new Set<string>();
  for (const name of EXAMPLE_NAMES) {
    const bytes = await readFileBounded(projectDir, name);
    if (bytes !== null)
      for (const key of parseEnvironmentKeys(bytes.toString('utf8'))) requiredKeys.add(key);
  }
  if (requiredKeys.size > 256)
    throw new Error(
      'Environment examples contain more than 256 variable names. Reduce the example files before capturing.',
    );
  const dotenvKeys = new Set<string>();
  if (requiredKeys.size > 0) {
    let filenames: string[];
    try {
      filenames = await readdir(projectDir);
    } catch {
      throw new Error('Cannot list the project directory. Check its permissions and try again.');
    }
    for (const name of filenames.sort()) {
      // Example/template files declare requirements; they do not fulfill them.
      if (
        !/^\.env(?:\.[A-Za-z0-9_-]+)*$/.test(name) ||
        /\.(?:example|sample|template)(?:\.|$)/.test(name)
      )
        continue;
      const bytes = await readFileBounded(projectDir, name);
      if (bytes !== null)
        for (const key of parseEnvironmentKeys(bytes.toString('utf8'))) dotenvKeys.add(key);
    }
  }
  const required = [...requiredKeys].sort().map((key) => {
    const sources: Array<'process' | 'dotenv'> = [];
    if (process.env[key] !== undefined) sources.push('process');
    if (dotenvKeys.has(key)) sources.push('dotenv');
    return { key, present: sources.length > 0, sources };
  });
  return { engines, packageManager, nodeVersionFiles, lockfiles, environment: { required } };
}
