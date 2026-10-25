# Privacy and collection boundaries

EnvTrail is designed for local use. It captures enough metadata to compare development environments without putting environment variable values in a snapshot.

## What a snapshot may reveal

Snapshots and reports contain:

- A capture timestamp, operating system identifier, and CPU architecture.
- The current Node.js runtime version and system npm, pnpm, Yarn, and Bun versions detected by offline probes.
- Supported `engines` and `packageManager` requirements from `package.json`.
- Supported Node.js version declarations from `.nvmrc` and `.node-version`.
- Supported lockfile names and their SHA-256 fingerprints.
- Declared environment variable names, presence, and the source category (`process` or `dotenv`).

Even this metadata can be sensitive. A variable name can reveal an internal integration, and a fingerprint can identify a known lockfile. Review every artifact before sharing it outside the people who need it.

## What is excluded

- Environment variable values and `.env` file contents.
- Usernames, hostnames, project names, and absolute project paths.
- Dependency lists and lockfile contents.
- Credentials, access tokens, and private file contents.
- Telemetry and automatic uploads of snapshots or reports.

EnvTrail uses the names declared in `.env.example`, `.env.sample`, and `.env.template` to decide which variables to check. It reads assignment names from local `.env` files and checks the process environment. A presence result is a boolean, not a copy of the value. Neither example values nor local values become snapshot data.

An empty assignment such as `API_TOKEN=` counts as present. EnvTrail does not evaluate dotenv interpolation, load variables into the process, determine framework precedence, or verify credentials. A variable supplied only by an example/template file does not satisfy the requirement.

## What capture does

Capture reads supported configuration files from the selected project and obtains version information from supported tools. It does not install dependencies, execute package scripts, or repair your machine.

Version detection may invoke installed tool binaries. Use a trusted machine, trusted tool installations, and a trusted executable search path. Local capture is not a sandbox for malicious executables.

Package manager probes run outside the project and avoid project-selected Corepack versions and Yarn `yarnPath` code. Their results describe system probes, which may differ from the package manager selected inside the project. A failed probe produces an undetected version, not proof that the tool is uninstalled.

EnvTrail does not intentionally perform network requests. Keep in mind that installed version managers or tool wrappers are separate software and can have their own behavior.

## Imported files and reports

Snapshots are untrusted input. EnvTrail validates their format before using them. A valid snapshot can still contain misleading metadata because its author controls the input. Do not treat another person's snapshot as authenticated evidence.

Reports are intended to display text safely, not execute input supplied by a project or snapshot. If you find report content that can execute code or leak metadata outside these boundaries, use the [security disclosure policy](../SECURITY.md).

## Before sharing

1. Inspect the snapshot or report locally.
2. Check environment variable names, requirements, and lockfile fingerprints for sensitive metadata.
3. Share only with the people who need the comparison.
4. Use synthetic data in public issues, demos, and screenshots.

If you accidentally expose a credential, remove the artifact and rotate the credential through its provider. Removing a public file alone cannot revoke copies already made.
