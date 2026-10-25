import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { compareSnapshots, parseSnapshot, renderHtmlReport } from '../dist/index.js';

const baseline = parseSnapshot({
  schemaVersion: 1,
  capturedAt: '2026-10-25T09:00:00.000Z',
  system: { platform: 'darwin', arch: 'arm64' },
  runtime: { node: '22.20.0', npm: '10.9.3', pnpm: null, yarn: null, bun: null },
  project: {
    engines: { node: '>=22 <23' },
    packageManager: 'npm@10.9.3',
    nodeVersionFiles: { nvmrc: '22.20.0', nodeVersion: null },
    lockfiles: [{ name: 'package-lock.json', sha256: 'a'.repeat(64) }],
    environment: {
      required: [
        { key: 'DATABASE_URL', present: true, sources: ['dotenv'] },
        { key: 'SESSION_SECRET', present: true, sources: ['process'] },
      ],
    },
  },
});
const current = parseSnapshot({
  ...baseline,
  capturedAt: '2026-10-25T09:05:00.000Z',
  system: { platform: 'win32', arch: 'x64' },
  runtime: { node: '24.15.0', npm: '11.12.1', pnpm: null, yarn: null, bun: null },
  project: {
    ...baseline.project,
    lockfiles: [{ name: 'package-lock.json', sha256: 'b'.repeat(64) }],
    environment: {
      required: [
        { key: 'DATABASE_URL', present: false, sources: [] },
        { key: 'SESSION_SECRET', present: true, sources: ['dotenv'] },
      ],
    },
  },
});
const paths = [
  ['../examples/baseline.json', `${JSON.stringify(baseline, null, 2)}\n`],
  ['../examples/current.json', `${JSON.stringify(current, null, 2)}\n`],
  ['../docs/assets/demo.html', renderHtmlReport(compareSnapshots(baseline, current))],
  ['../docs/index.html', renderHtmlReport(compareSnapshots(baseline, current))],
];
for (const [path, content] of paths) {
  const target = new URL(path, import.meta.url);
  await mkdir(fileURLToPath(new URL('.', target)), { recursive: true });
  const formatted = path.endsWith('.json')
    ? await format(content, { ...(await resolveConfig(fileURLToPath(target))), parser: 'json' })
    : content;
  await writeFile(target, formatted);
}
console.log(
  'Synthetic example snapshots and docs/assets/demo.html generated. No local environment data was used.',
);
