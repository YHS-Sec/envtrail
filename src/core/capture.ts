import { spawn } from 'node:child_process';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import semver from 'semver';
import { readProject } from './project.js';
import { parseSnapshot } from './schema.js';
import type { EnvSnapshot } from './types.js';

const PROBE_TIMEOUT_MS = 3000;
const MAX_PROBE_BYTES = 8192;
type PackageTool = 'npm' | 'pnpm' | 'yarn' | 'bun';

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

async function findExecutable(tool: PackageTool, projectDir: string): Promise<string | null> {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    // Relative/empty PATH entries depend on cwd and may execute project-controlled code.
    if (!directory || !path.isAbsolute(directory)) continue;
    // Check the PATH entry before resolving symlinks as well as the resulting executable.
    if (
      isWithin(projectDir, path.resolve(directory)) ||
      /[\\/]node_modules[\\/]\.bin(?:[\\/]|$)/i.test(directory)
    )
      continue;
    for (const extension of extensions) {
      try {
        const candidate = await realpath(path.join(directory, `${tool}${extension}`));
        if (isWithin(projectDir, candidate) || /[\\/]node_modules[\\/]\.bin[\\/]/i.test(candidate))
          continue;
        // cmd expands percent variables even inside quotes. Reject shell syntax in wrapper paths.
        if (process.platform === 'win32' && /[%!"&|<>^\r\n]/.test(candidate)) continue;
        if (!(await stat(candidate)).isFile()) continue;
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        /* Missing or inaccessible tools are reported as unavailable. */
      }
    }
  }
  return null;
}

async function probe(tool: PackageTool, projectDir: string): Promise<string | null> {
  const executable = await findExecutable(tool, projectDir);
  if (!executable) return null;
  return await new Promise<string | null>((resolve) => {
    let settled = false;
    let output = '';
    let total = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const wrapper = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
    // A fixed system shell is needed for Windows package-manager shims, never shell:true.
    const command = wrapper
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
      : executable;
    const args = wrapper ? ['/d', '/s', '/c', `""${executable}" --version"`] : ['--version'];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      COREPACK_ENABLE_NETWORK: '0',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      COREPACK_ENABLE_PROJECT_SPEC: '0',
      COREPACK_ENABLE_AUTO_PIN: '0',
      COREPACK_DEFAULT_TO_LATEST: '0',
      npm_config_ignore_scripts: 'true',
      npm_config_update_notifier: 'false',
      NO_UPDATE_NOTIFIER: '1',
      YARN_IGNORE_PATH: '1',
    };
    // Loader hooks would run before --version and can execute project code.
    // Compare case-insensitively because Windows environment keys are case-insensitive.
    for (const key of Object.keys(env))
      if (['NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase())) delete env[key];
    const child = spawn(command, args, {
      cwd: tmpdir(),
      windowsHide: true,
      shell: false,
      windowsVerbatimArguments: wrapper,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    function finish(value: string | null): void {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(value);
    }
    function stop(): void {
      if (child.pid) {
        if (process.platform === 'win32') {
          const killer = spawn(
            path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/pid', String(child.pid), '/t', '/f'],
            { windowsHide: true, stdio: 'ignore' },
          );
          killer.once('error', () => {
            child.kill();
          });
          killer.unref();
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill();
          }
        }
      }
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    }
    function collect(chunk: Buffer): void {
      total += chunk.length;
      if (total > MAX_PROBE_BYTES) {
        stop();
        finish(null);
        return;
      }
      output += chunk.toString('utf8');
    }
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', () => finish(null));
    child.once('close', (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }
      const versions = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(
          (line) =>
            /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(line) &&
            semver.valid(line),
        );
      finish(versions.length === 1 ? (versions[0] ?? null) : null);
    });
    timeout = setTimeout(() => {
      stop();
      finish(null);
    }, PROBE_TIMEOUT_MS);
    timeout.unref();
  });
}

/** Capture locally, without installing dependencies, running project scripts or storing env values. */
export async function captureSnapshot(projectDir: string): Promise<EnvSnapshot> {
  let directory: string;
  try {
    directory = await realpath(path.resolve(projectDir));
  } catch {
    throw new Error('Project directory does not exist or cannot be accessed.');
  }
  const project = await readProject(directory);
  const [npm, pnpm, yarn, bun] = await Promise.all(
    ['npm', 'pnpm', 'yarn', 'bun'].map((tool) => probe(tool as PackageTool, directory)),
  );
  return parseSnapshot({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    system: { platform: process.platform, arch: process.arch },
    runtime: {
      node: process.versions.node,
      npm: npm ?? null,
      pnpm: pnpm ?? null,
      yarn: yarn ?? null,
      bun: bun ?? null,
    },
    project,
  });
}
