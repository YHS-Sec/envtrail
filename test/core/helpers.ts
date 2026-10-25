import type { EnvSnapshot } from '../../src/core/types.js';

export function snapshot(): EnvSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: '2026-10-25T00:00:00.000Z',
    system: { platform: 'linux', arch: 'x64' },
    runtime: { node: '22.14.0', npm: '10.9.2', pnpm: null, yarn: null, bun: null },
    project: {
      engines: { node: '>=22' },
      packageManager: 'npm@10.9.2',
      nodeVersionFiles: { nvmrc: null, nodeVersion: null },
      lockfiles: [{ name: 'package-lock.json', sha256: 'a'.repeat(64) }],
      environment: { required: [{ key: 'DATABASE_URL', present: true, sources: ['dotenv'] }] },
    },
  };
}
