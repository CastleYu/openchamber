# ACP portable builds

ACP integration builds come from `codex/acp-integration` in `CastleYu/openchamber`. The dedicated [workflow](../../../.github/workflows/acp-portable.yml) builds Windows x64 portable artifacts on push. Manual dispatch builds by default; select `publish` to publish the verified artifact as a GitHub prerelease.

## Local build

Install the locked dependencies with `bun install --frozen-lockfile`, then run:

```sh
node scripts/build-personal.mjs --acp --version
node scripts/build-personal.mjs --acp
```

The version is `<upstream>-DIJIANG.<feature.fix>-ACP.local`, for example `2.0.4-DIJIANG.4.0-ACP.local`. CI replaces `local` with `<run_number>.<run_attempt>`, giving each attempt a distinct identity. `--debug` appends `-DEBUG` for local diagnostics.

The script reuses the personal build's web asset staging, pinned OpenCode preparation and verification, Electron bundling, native rebuild and portable packaging. It writes the EXE and `build-info.json` to `packages/electron/dist/acp/<version>/`. The metadata records the ACP channel, source commit and notification-only update policy.

## Publication and replacement

The workflow permits publication only from the ACP branch in the personal repository. `scripts/publish-acp.mjs` checks the downloaded build identity, creates a draft tagged `v<version>`, uploads the EXE, metadata and `SHA256SUMS.txt`, and verifies GitHub's file sizes and SHA-256 digests. It then publishes with `prerelease=true` and `make_latest=false`.

An upload or verification failure leaves a draft. Rerun the workflow to build and publish a new attempt with a new version. The stable personal workflow and community update feed retain their existing behavior.

Close the running application before replacing the portable executable. Keep the previous executable and existing AppData/OpenCode data. To roll back, close the ACP build and reopen the previous executable. The portable package uses the existing application data locations; the ACP suffix separates build artifacts and release tags.

## Checks

```sh
node --test scripts/acp-build.test.mjs scripts/publish-acp.test.mjs scripts/build-personal.test.mjs packages/electron/personal-updates.test.mjs
```

The workflow also runs workspace type-checking before packaging. A successful Actions build verifies packaging; launch and ACP agent interaction require testing the resulting Windows executable.

Local validation on 2026-10-14 produced `2.0.4-DIJIANG.4.0-ACP.local` for Windows x64 (171,635,242 bytes). SHA-256: `f1602aed154e46e54a6dc2c0d5769909515c321248f86a7c1775fc7dd95b146a`. Production web assets passed the local ACP fixture conversation and permission flow. The packaged Electron application has not been launched for acceptance. This local build has no source-commit identity; CI supplies that identity for publication.

[简体中文](ACP-BUILD.zh-CN.md) · [Personal build policy](BUILD.md)
