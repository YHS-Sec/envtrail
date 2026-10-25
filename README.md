# ![EnvTrail](docs/assets/logo.svg)

**Find the environment differences behind “it works on my machine.”**

[![CI](https://github.com/YHS-Sec/envtrail/actions/workflows/ci.yml/badge.svg)](https://github.com/YHS-Sec/envtrail/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-14b8a6.svg)](LICENSE)
[![Node.js ≥22](https://img.shields.io/badge/Node.js-%E2%89%A522-339933.svg)](https://nodejs.org/)

[한국어](README.ko.md) · [Live example report](https://yhs-sec.github.io/envtrail/) · [Privacy](docs/privacy.md) · [Contributing](CONTRIBUTING.md)

EnvTrail is a local CLI for Node.js projects. Capture a teammate's working environment, compare it with yours, and get a focused report of version differences, project requirements, and missing environment variables.

No account, upload, or background service. Environment variable **values are never recorded in snapshots or reports**.

![EnvTrail comparison report showing environment differences with synthetic data](docs/assets/demo.png)

_A sample comparison using synthetic environments._

## Try it

Requires Node.js 22 or later and npm. Install the package attached to the first GitHub release:

```sh
npm install -g https://github.com/YHS-Sec/envtrail/releases/download/v0.1.0/yhs-sec-envtrail-0.1.0.tgz
envtrail --help
```

The package is distributed through GitHub Releases. It is not published to the npm registry yet.

### Build from source

If you prefer to inspect or develop the source:

```sh
git clone https://github.com/YHS-Sec/envtrail.git
cd envtrail
npm ci
npm run build
node dist/cli.js --help
```

The examples below use the installed `envtrail` command. From a source checkout, replace it with `node /path/to/envtrail/dist/cli.js`.

### Compare two machines

Capture a baseline from a working machine:

```sh
envtrail capture --project /path/to/my-app --output baseline.json
```

Share `baseline.json` after reviewing it. On the other machine, compare the same project with that baseline:

```sh
envtrail compare baseline.json --project /path/to/my-app --html report.html
```

Or compare two saved snapshots without collecting the current environment:

```sh
envtrail capture --project /path/to/my-app --output current.json
envtrail compare baseline.json current.json --html report.html
```

Open `report.html` in your browser. It is a standalone file that you can keep locally.

> The paths above are examples. In PowerShell, use a project path such as `C:\work\my-app`. If you run EnvTrail inside the project directory, you can omit `--project`.

## Useful commands

```sh
# Read a saved snapshot
envtrail inspect baseline.json

# Produce a machine-readable comparison
envtrail compare baseline.json current.json --json --output comparison.json

# Make warnings and errors fail a CI job
envtrail compare baseline.json current.json --fail-on warning
```

`--fail-on` accepts `error`, `warning`, or `never`. The default is `never`: findings are informational unless you explicitly choose a failure threshold. Invalid input and command errors still fail.

Capture prints snapshot JSON to stdout unless you pass `--output`. Existing output files are protected; pass `--force` to replace one intentionally. An input snapshot can never be overwritten by comparison output.

## What it helps you check

- Node.js and detected system npm, pnpm, Yarn, and Bun versions across machines.
- Requirements in `package.json` (`engines`, `packageManager`), `.nvmrc`, and `.node-version`.
- Lockfile fingerprints, without storing lockfile contents or dependency lists.
- Variable names declared in `.env.example`, `.env.sample`, or `.env.template`, and whether they exist in the process environment or local `.env` files.
- Differences you can review in the terminal, JSON output, or an HTML report.

EnvTrail does not install dependencies, run package scripts, change your environment, or read environment variable values into a snapshot. It reads the selected project's supported configuration files and invokes supported tools to obtain version information.

## Know what a result means

A difference is a clue, not proof of the root cause. Two different versions may both satisfy a project's requirements. An empty assignment counts as a present environment variable; presence does not prove a usable value or a valid credential. Matching snapshots cannot rule out networking, permissions, external services, native dependencies, or application bugs.

Package manager versions come from offline system probes. EnvTrail does not run project-selected Corepack versions or Yarn `yarnPath` code. Package manager requirement mismatches are warnings because the project may select a different version; an undetected version does not prove that a tool is uninstalled. Confirmed Node.js requirement failures and missing declared variables are errors.

Start with the reported project requirement failures, then investigate relevant differences. See [the workflow guide](docs/usage.md) and [privacy boundaries](docs/privacy.md) before sharing a report.

## Develop

```sh
npm ci
npm run check
npm run smoke:package
npm run demo
```

`npm run check` runs type checking, tests, a production build, and formatting checks. `npm test` runs the test suite on its own. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [architecture](docs/architecture.md) for the implementation boundaries.

The first release targets Node.js projects. Read the [changelog](CHANGELOG.md), [report a bug](https://github.com/YHS-Sec/envtrail/issues/new/choose), or propose a focused improvement in an issue. For sensitive reports, use the [security policy](SECURITY.md).

## License

[MIT](LICENSE) © 2026 YHS-Sec.
