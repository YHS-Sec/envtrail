# Architecture

EnvTrail is a TypeScript CLI for Node.js 22 and later. Its main workflow is:

```text
supported project files + installed tool versions
                        |
                     capture
                        |
               versioned snapshot JSON
                        |
baseline + current -> compare -> structured findings
                                      |
                              terminal / JSON / HTML
```

## Capture boundary

Capture selects supported project configuration and version information. Environment declarations in `.env.example`, `.env.sample`, and `.env.template` contribute required names. The process environment and local dotenv assignment names contribute presence and source categories only. Secret values, personal identifiers, project names, dependency lists, and absolute paths do not belong in the snapshot model. Lockfiles contribute filenames and SHA-256 fingerprints, not contents.

Project files are data, not executable instructions. Collection must not run package scripts, install dependencies, load project configuration as JavaScript, or interpolate untrusted project content into shell commands.

Tool detection is limited to obtaining versions from installed tools. It must use bounded execution and predictable argument lists.

## Snapshot contract

The initial snapshot format is [schema version 1](snapshot-format.md). Consumers must validate the schema version and input shape rather than assuming that a JSON object is a snapshot. Unsupported schema versions should fail clearly instead of being silently reinterpreted.

Do not use comparison output as a snapshot. The input evidence and derived findings have different purposes.

Snapshot metadata is not authenticated. A file may describe an environment inaccurately, even when its shape is valid.

## Comparison boundary

Comparison derives findings from validated snapshots and declared project requirements. A finding should identify the relevant item and explain the difference without claiming that it proves an application failure.

Keep severity meaningful: a project requirement failure is different from a version difference that remains compatible. Presence cannot establish credential validity.

## Presentation boundary

Terminal, JSON, and HTML output share a structured comparison result. Renderers must preserve the comparison semantics. HTML must escape user-controlled labels and values and remain useful as a standalone local artifact.

## Testing priorities

Behavioral tests should emphasize:

- Version requirements and comparisons, including compatible differences.
- Missing, empty, malformed, and unsupported project configuration.
- Redaction and absence of environment variable values or personal paths.
- Snapshot validation, unsupported versions, and bounded input.
- Safe HTML output for untrusted strings.
- Exit behavior and end-to-end CLI commands.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the commands to run before submitting a change.
