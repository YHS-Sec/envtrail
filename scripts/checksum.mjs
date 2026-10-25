import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';

const files = (await readdir('.'))
  .filter((file) => /^yhs-sec-envtrail-[0-9].*\.tgz$/.test(file))
  .sort();
if (files.length !== 1) throw new Error('Expected exactly one release package.');
const checksums = await Promise.all(
  files.map(
    async (file) =>
      `${createHash('sha256')
        .update(await readFile(file))
        .digest('hex')}  ${file}`,
  ),
);
await writeFile('SHA256SUMS.txt', `${checksums.join('\n')}\n`);
