import { link, lstat, mkdir, open, realpath, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { parseSnapshot } from './core/schema.js';
import type { EnvSnapshot } from './core/types.js';

const MAX_SNAPSHOT_BYTES = 1024 * 1024;

async function canonicalOutput(file: string): Promise<string> {
  let parent = dirname(resolve(file));
  const suffix = [basename(file)];
  while (true) {
    try {
      return join(await realpath(parent), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      suffix.unshift(basename(parent));
      parent = next;
    }
  }
}

export async function readSnapshot(file: string): Promise<EnvSnapshot> {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) {
      throw new Error('A snapshot must be a regular JSON file of at most 1 MiB.');
    }
    const buffer = Buffer.alloc(MAX_SNAPSHOT_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot exceeds the 1 MiB limit.');
    let data: unknown;
    try {
      data = JSON.parse(
        buffer
          .subarray(0, total)
          .toString('utf8')
          .replace(/^\uFEFF/, ''),
      );
    } catch {
      throw new Error('Snapshot is not valid JSON.');
    }
    return parseSnapshot(data);
  } finally {
    await handle.close();
  }
}

export async function validateOutputs(
  outputs: string[],
  inputs: string[],
  force: boolean,
): Promise<void> {
  const identities = await Promise.all(inputs.map((file) => realpath(file)));
  const inputStats = await Promise.all(inputs.map((file) => stat(file)));
  const seen = new Set<string>();
  for (const file of outputs) {
    const absolute = resolve(file);
    const normalize = (value: string) =>
      process.platform === 'win32' ? value.toLowerCase() : value;
    const key = normalize(await canonicalOutput(absolute));
    if (seen.has(key)) throw new Error('Each output must use a different file.');
    seen.add(key);
    let stat;
    try {
      stat = await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (stat?.isSymbolicLink()) throw new Error('Refusing to write through an output symlink.');
    const identity = stat ? await realpath(absolute) : absolute;
    if (identities.some((input) => normalize(input) === normalize(identity))) {
      throw new Error('An output cannot overwrite an input snapshot, even with --force.');
    }
    if (stat && inputStats.some((input) => input.dev === stat.dev && input.ino === stat.ino)) {
      throw new Error('An output cannot overwrite a hard link to an input snapshot.');
    }
    if (stat && (!force || !stat.isFile())) {
      throw new Error(
        `Output ${JSON.stringify(file)} already exists. Use --force to replace a regular file.`,
      );
    }
  }
}

export async function writeArtifact(file: string, content: string, force: boolean): Promise<void> {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (force) await rename(temporary, target);
    else {
      // A hard-link creation is atomic and fails if another process created the target.
      await link(temporary, target);
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
