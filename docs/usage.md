# Workflow guide

EnvTrail compares evidence from development environments. Use a known-working machine as the baseline, then investigate the findings on the machine where the project fails.

## 1. Build EnvTrail

```sh
git clone https://github.com/YHS-Sec/envtrail.git
cd envtrail
npm ci
npm run build
```

The commands below assume you run them from the EnvTrail checkout. `--project` selects the project to inspect; without it, capture uses your current working directory.

## 2. Capture the working environment

```sh
node dist/cli.js capture --project /path/to/application --output baseline.json
node dist/cli.js inspect baseline.json
```

Keep the baseline tied to a specific revision of your application through your team's normal workflow. EnvTrail is an environment comparison tool, not a replacement for source control or a lockfile.

Review the snapshot before sharing. A snapshot omits secret values and project names but contains tool versions, variable names, and lockfile fingerprints. Do not commit real team snapshots to a public repository without reviewing them.

## 3. Compare on the affected machine

```sh
node dist/cli.js compare baseline.json --project /path/to/application --html report.html
```

Omitting the second snapshot tells EnvTrail to collect the current environment. To preserve that environment first:

```sh
node dist/cli.js capture --project /path/to/application --output current.json
node dist/cli.js compare baseline.json current.json --html report.html
```

Use matching source revisions when possible. A changed `.env.example` or project requirement can legitimately change the result.

## 4. Interpret the findings

Start with failures against declared project requirements. Next, check missing variables and differences related to the failing feature. Treat baseline/current version differences as leads for investigation.

Requirement checks use the **current snapshot's** declarations. EnvTrail reports changed declarations as a separate finding so you can spot a source revision mismatch. Moving Node.js aliases such as `lts/*`, `node`, or `stable` are recorded and explained, but are not resolved over the network.

Node.js is the runtime running EnvTrail. A confirmed mismatch with `engines.node`, a numeric `.nvmrc`, or a numeric `.node-version` is an error. Missing declared environment variables are also errors.

Package manager versions are collected through offline **system probes**, outside the project. EnvTrail avoids executing project-selected Corepack versions or Yarn `yarnPath` code. Package manager `engines` and pinned `packageManager` mismatches are warnings: a project's selected version can differ from the system probe. Verify the version through your normal trusted project workflow before changing your installation. An undetected version may be unavailable to the probe; it does not prove the tool is uninstalled.

Environment variable presence is not validation of a value. An empty assignment counts as present, and a variable with the wrong URL or expired token can still cause failure. EnvTrail does not test credentials, evaluate dotenv interpolation, choose framework-specific dotenv precedence, or connect to application services.

A matching report does not prove that the application will work. Permissions, native libraries, networking, file contents, and external services may differ outside the captured data.

## Machine-readable output

```sh
node dist/cli.js compare baseline.json current.json --json --output comparison.json
```

JSON output is useful for tools that need the structured result. Snapshot input and comparison output are different formats; keep their filenames distinct.

## Exit behavior

By default, differences do not cause a failing exit status. Opt in to a threshold when using a comparison as a check. Choose `warning` if you also want package manager probe mismatches to fail:

```sh
# Fail when the report contains an error finding
node dist/cli.js compare baseline.json current.json --fail-on error

# Fail on warnings as well as errors
node dist/cli.js compare baseline.json current.json --fail-on warning

# Report findings without failing because of them (the default)
node dist/cli.js compare baseline.json current.json --fail-on never
```

Invalid flags, unreadable files, invalid snapshots, and collection failures are command errors and can fail regardless of the chosen threshold.

| Exit code | Meaning                                                              |
| --------- | -------------------------------------------------------------------- |
| `0`       | Command succeeded; the configured finding threshold was not reached. |
| `1`       | Comparison reached the configured `--fail-on` threshold.             |
| `2`       | Invalid input or a command failure.                                  |

## Output files

`capture` prints snapshot JSON to stdout by default. Pass `--output` to write a file. Comparison `--output` requires `--json`; `--html` independently writes an HTML report.

Commands refuse to overwrite existing files unless you pass `--force`. Comparison output must never replace either input snapshot, even with `--force`.

```sh
node dist/cli.js capture --project /path/to/application --output current.json --force
```

Use `--force` only when you intend to replace an earlier output.

## Sharing HTML reports

HTML output is a standalone local artifact. Open it in a browser and inspect it before sharing. It contains environment metadata and variable names, even though it excludes environment variable values. Apply the same access controls you use for the underlying project.

The [included demo](assets/demo.html) uses synthetic data and is safe to use in public issues and screenshots.

## Getting help

Run `node dist/cli.js --help` for the current CLI reference. `inspect` without a filename collects and summarizes the current project; `inspect baseline.json` reads a saved snapshot. Both `capture` and live inspection accept `--project`.

When reporting a bug, include the exact command, Node.js version, operating system, and a minimal synthetic project. Do not attach an unreviewed snapshot or real `.env` file.
