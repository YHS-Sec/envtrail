# Snapshot format, version 1

EnvTrail stores captured evidence as JSON with `schemaVersion: 1`. The application version and snapshot schema version are separate: a new EnvTrail release does not necessarily change this format.

This synthetic example is a complete snapshot:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-10-25T00:00:00.000Z",
  "system": {
    "platform": "linux",
    "arch": "x64"
  },
  "runtime": {
    "node": "22.14.0",
    "npm": "10.9.2",
    "pnpm": null,
    "yarn": null,
    "bun": null
  },
  "project": {
    "engines": {
      "node": ">=22"
    },
    "packageManager": "npm@10.9.2",
    "nodeVersionFiles": {
      "nvmrc": "22",
      "nodeVersion": null
    },
    "lockfiles": [],
    "environment": {
      "required": [
        {
          "key": "EXAMPLE_API_URL",
          "present": true,
          "sources": ["dotenv"]
        },
        {
          "key": "EXAMPLE_API_TOKEN",
          "present": false,
          "sources": []
        }
      ]
    }
  }
}
```

## Fields

| Field                          | Meaning                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                | Input contract version. This release accepts `1` only.                                                                 |
| `capturedAt`                   | UTC timestamp in the exact form produced by `Date.toISOString()`.                                                      |
| `system`                       | Operating system identifier and CPU architecture; no hostname or OS release.                                           |
| `runtime`                      | Current Node.js runtime and package manager versions from offline system probes. Undetected optional tools use `null`. |
| `project.engines`              | Supported semver requirements from `package.json`: `node`, `npm`, `pnpm`, `yarn`, and `bun`.                           |
| `project.packageManager`       | A supported package manager pinned to a semver version, or `null`. Corepack integrity metadata is omitted.             |
| `project.nodeVersionFiles`     | Normalized `.nvmrc` and `.node-version` declarations, or `null`.                                                       |
| `project.lockfiles`            | Supported lockfile names with lowercase hexadecimal SHA-256 fingerprints. Contents are omitted.                        |
| `project.environment.required` | Declared variable names, presence flags, and source categories. Values are omitted.                                    |

Supported lockfiles are `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, and `bun.lockb`.

Package manager probe results do not establish which version a project will select through Corepack or Yarn `yarnPath`. EnvTrail avoids executing that project-selected code. `null` means the version was not detected, which does not prove the tool is uninstalled. Package manager requirement mismatches are warnings; confirmed Node.js requirement failures remain errors.

Environment source categories are `process` and `dotenv`. A present variable has at least one source. A missing variable has an empty source array. An empty value still counts as present. Capture merges requirement names from `.env.example`, `.env.sample`, and `.env.template`; these declaration files do not themselves fulfill a requirement.

## Validation and limits

Imported snapshots use a closed format: unsupported fields, malformed versions, duplicate lockfiles or variable names, invalid presence/source combinations, and unsupported schema versions are rejected. Do not add ad hoc fields such as paths or annotations to a snapshot. Keep team context separately.

There is a maximum of 256 declared environment keys. Names must match `[A-Za-z_][A-Za-z0-9_]*` and contain at most 128 characters. Supported version requirements must be valid semver ranges.

The code in [the snapshot types](../src/core/types.ts) and [validator](../src/core/schema.ts) defines the executable contract. A valid shape does not authenticate a snapshot or prove that its metadata is truthful.

## Comparison JSON

`compare --json` produces a derived comparison with the validated baseline and current snapshots, findings, severity counts, and a compatibility indicator. It is not snapshot input.

Compatibility means the comparison has no error findings. Package manager probe mismatches and other warnings still need review; a compatible result is not proof that every requirement is met or that an application will run. See [the usage guide](usage.md).
