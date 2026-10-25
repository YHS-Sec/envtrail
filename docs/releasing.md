# Releasing EnvTrail

EnvTrail distributes installable packages through GitHub Releases. The release workflow does **not** publish to the npm registry.

The examples below use `0.2.0`. Replace it with the version you intend to release.

## Prepare the version

Make a focused release pull request that updates:

- `package.json` and `package-lock.json` to the same package version.
- `src/version.ts` to the same CLI version.
- `CHANGELOG.md` with the release date and user-facing changes.
- Versioned installation examples in `README.md` and `README.ko.md` when promoting the new release.

To update package metadata without creating a commit or tag automatically:

```sh
npm version 0.2.0 --no-git-tag-version
```

Update the remaining files, then validate the release candidate:

```sh
npm ci
npm run check
npm run demo
npm run smoke:package
```

Inspect the synthetic HTML demo in a browser. If its appearance or findings changed, refresh `docs/assets/demo.png` and review both README pages. Review the packaged contents and ensure no real snapshots, credentials, or personal files are included.

## Merge and check main

Merge the release changes through the normal pull request workflow. The protected `main` branch requires the **CI** and **Analyze JavaScript and TypeScript** checks. The initial repository configuration requires zero approving reviews so a sole maintainer can merge after checks pass. Administrator bypass is enabled; force pushes and branch deletion are blocked.

Fetch the merged `main` branch and confirm that its GitHub checks passed. Tag that reviewed commit, not an unmerged local branch. Start with a clean working tree:

```sh
git switch main
git pull --ff-only origin main
git status --short
```

If `git status --short` lists changes, resolve them before continuing. Confirm the version files and changelog describe the commit you are about to tag.

## Push the release tag

Create an annotated tag and push that tag explicitly:

```sh
git tag -a v0.2.0 -m "EnvTrail v0.2.0"
git push origin v0.2.0
```

The [release workflow](../.github/workflows/package.yml) runs on `v*` tags. It verifies that the tag equals `v` plus the package version, runs the project checks, builds an npm tarball, and creates `SHA256SUMS.txt`.

The verification job has read access. After it succeeds, a separate release job checks out the same tag, installs the locked dependencies with lifecycle scripts disabled, rebuilds the package, and creates and verifies its SHA-256 checksum. It uses GitHub's temporary workflow token to publish a GitHub Release with generated notes. It requires the tag to exist and attaches both the `.tgz` package and `SHA256SUMS.txt` directly to the release. No npm publishing token or long-lived release key is needed.

Manual workflow dispatch validates and packages the selected branch, but only a tag run publishes a release. The workflows do not upload Actions artifacts or enable dependency caching. GitHub Release assets are the installation distribution.

The public project uses standard GitHub-hosted Actions runners, GitHub Pages for its demo, and GitHub Releases for distribution. This setup requires no additional paid service, external AI API, or hosted backend.

## Verify the published release

Open the workflow run and the new GitHub Release. Confirm that the intended tag, notes, package, and checksum file are present. For this example the installable asset is `yhs-sec-envtrail-0.2.0.tgz`:

```sh
npm install -g https://github.com/YHS-Sec/envtrail/releases/download/v0.2.0/yhs-sec-envtrail-0.2.0.tgz
envtrail --version
envtrail --help
```

The version command must print `0.2.0`. Run a comparison with the synthetic example snapshots when checking the installed package.

To verify a downloaded package and checksum file in the same directory, Linux users can run `sha256sum --check SHA256SUMS.txt`; macOS users can run `shasum -a 256 --check SHA256SUMS.txt`. In PowerShell, run `Get-FileHash -Algorithm SHA256 .\yhs-sec-envtrail-0.2.0.tgz` and compare the hash with `SHA256SUMS.txt`.

## If a release run fails

Read the failed job in GitHub Actions before taking action. A rerun can recover a transient failure before publication. If the GitHub Release already exists, duplicate creation is rejected: the workflow does not automatically overwrite assets or delete an existing release. Check the existing release and its assets before attempting recovery.

Do not move, delete, or rewrite a published release tag to hide a failed run or replace released code. If the released code needs a correction, prepare a new version and tag through the same process. Keep the original failure and release history available for review.
