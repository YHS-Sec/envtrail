# Security policy

EnvTrail processes local project files and imported snapshots. Privacy leaks, unsafe command execution, unsafe file handling, and HTML report injection are security concerns.

## Reporting a vulnerability

Email **contact@v1sion.xyz** with a description, affected version or commit, and a minimal reproduction using synthetic data. Include the security impact and any suggested mitigation. Do not send production credentials or other people's private information.

If GitHub private vulnerability reporting is enabled for this repository, you can also use the **Security → Report a vulnerability** button. Otherwise, use email.

Please avoid public issues for unpatched vulnerabilities. Ordinary bugs and feature requests belong in [GitHub issues](https://github.com/YHS-Sec/envtrail/issues/new/choose).

## Supported versions

Security fixes target the latest release and the current default branch. This initial project does not maintain older release lines. There is no guaranteed response or remediation timeline.

## Privacy expectations

Snapshots must not contain environment variable values, usernames, hostnames, project names, absolute project paths, or dependency lists. EnvTrail does not intentionally send snapshots or reports to a server. However, tool versions, lockfile fingerprints, and variable names can still reveal information about an environment. Review artifacts before sharing them; see [the privacy guide](docs/privacy.md).

If you believe a snapshot or report contains information that violates these boundaries, include a redacted example in your private report.
