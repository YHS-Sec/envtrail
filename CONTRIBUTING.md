# Contributing to EnvTrail

Thank you for helping developers understand their environments. Small, focused improvements are welcome: a reproducible bug, a clearer diagnostic, a supported configuration case, or documentation that makes the first run easier.

## Before you start

Search existing issues and pull requests. For a substantial feature, open an issue explaining the problem and a small proposed scope before investing in an implementation. For bugs and documentation fixes, a focused pull request is welcome directly.

Keep examples synthetic. Do not attach real `.env` files, credentials, private registry URLs, personal paths, or unreviewed environment snapshots. Read the [privacy guide](docs/privacy.md). Report vulnerabilities through [SECURITY.md](SECURITY.md), rather than a public issue.

## Local setup

Use Node.js 22 or later and npm:

```sh
git clone https://github.com/YHS-Sec/envtrail.git
cd envtrail
npm ci
npm run check
```

Create a branch for your change. Make your edits, then run:

```sh
npm run check
npm run smoke:package
```

`smoke:package` verifies the packaged installation and CLI, including execution through the installed binary.

For report changes, also generate and open the demo:

```sh
npm run demo
```

Inspect `docs/assets/demo.html` in a browser. Check narrow and wide layouts, keyboard access, long labels, and escaped user-controlled text when relevant.

## Implementation boundaries

- Collect only the data needed to explain environment compatibility. Do not add variable values, hostnames, usernames, absolute paths, or telemetry to snapshots.
- Do not execute project scripts or install project dependencies during capture.
- Treat project files and imported snapshots as untrusted input. Validate their shape and bound file reads.
- Explain what a finding proves. A version difference alone does not prove an application failure.
- Preserve the versioned snapshot contract, or introduce an explicit migration/versioning plan.
- Avoid new runtime dependencies unless they materially simplify a supported use case.

Add focused tests for behavior changes, especially privacy boundaries, parsing, version comparisons, malformed input, and report escaping. Do not add tests merely to mirror implementation details.

## Pull requests

Describe the problem, the resulting behavior, and the checks you ran. Include a synthetic example or screenshot when it makes the change easier to assess. Keep unrelated cleanup separate.

Use clear commit messages. There is no CLA or required commit-message format. By submitting a contribution, you agree that it will be distributed under this repository's [MIT license](LICENSE).

Review may take time. Maintainers may request a smaller scope or defer changes that expand the project's privacy surface or supported ecosystem.

Maintainers preparing a version should follow the [release guide](docs/releasing.md).

## Community

Follow our [Code of Conduct](CODE_OF_CONDUCT.md). Ask usage questions through the issue chooser, and include the command, your Node.js version, and a redacted example so others can reproduce the problem.
