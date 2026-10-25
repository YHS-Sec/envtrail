import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const name of ['dist', '.test-dist']) {
  const target = fileURLToPath(new URL(`../${name}`, import.meta.url));
  const location = relative(root, target);
  if (isAbsolute(location) || location.startsWith('..') || !location)
    throw new Error('Unsafe clean target.');
  await rm(target, { recursive: true, force: true });
}
