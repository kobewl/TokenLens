# Releases and in-app updates

TokenLens uses a single stable channel served by GitHub Releases. A `vX.Y.Z` tag triggers `.github/workflows/release.yml`. Pull requests and the **macOS packages** manual workflow build preview installers without signed updater assets or publishing a release.

## One-time setup

The app embeds the updater **public** key in `src-tauri/tauri.conf.json`. The matching private key must be configured in **Repository Settings → Secrets and variables → Actions**:

- `TAURI_SIGNING_PRIVATE_KEY`: complete contents of the Tauri-generated private key file.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password, if one was set. Leave unset for an unencrypted key.

Keep the private key outside the repository, never paste it into an issue, PR, or chat, and keep a secure backup. The initial key was generated outside the Git tree and the matching public key is already embedded. Use that key, rather than generating a different key for this configuration. To upload it from a trusted machine using GitHub CLI:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo kobewl/TokenLens < /absolute/path/to/signing.key
```

Changing the public key prevents apps using the previous key from accepting new updates; plan a migration before changing it. Updater signing authenticates downloads. It does not provide Apple Developer code signing or notarization; the current macOS installers still require the normal first-launch approval for unsigned applications.

## Release a version

1. Run `npm run release:version -- 0.3.1` to synchronize the frontend, package lock, Cargo package/lock, and Tauri bundle versions.
2. Write `docs/releases/0.3.1.md`. These notes are bundled into the app's **What's new** window and included in the remote update manifest.
3. Run `npm run release:check -- v0.3.1` and `npm run build`. Review and merge the change into `main`.
4. Tag the merged release commit and push the tag:

```bash
git tag -a v0.3.1 -m 'TokenLens v0.3.1'
git push origin v0.3.1
```

The workflow validates all versions, requires a stable tag whose commit is on `main`, checks for the signing secret, and builds both Apple Silicon and Intel packages. The publish job waits for both builds, verifies each updater signature against the app's embedded public key, including its signed app version, then generates `latest.json` and `SHA256SUMS`. It creates a draft release, uploads the complete asset set, and publishes it as the latest stable release. A published tag is immutable: retrying cannot overwrite it. A failed draft can be retried using **Release → Run workflow** with the existing version tag. No release is published after a failed build or signature check.

Release assets include each architecture's DMG, app ZIP, signed `.app.tar.gz` and `.sig`, a two-platform update manifest, and checksums. `darwin-aarch64` and `darwin-x86_64` are the native updater targets. The release notes and manifest never contain collected usage or project memory.

## App behavior

**Settings → Check updates** uses the Tauri updater over HTTPS. A startup check runs after a short delay if enabled and shows an unobtrusive notice when a new version is available. Dismissing a version suppresses its startup notice; a manual check still shows it. Missing or unreachable release metadata is an error, never an “up to date” result.

Users review Markdown release notes, then confirm download and installation. Remote raw HTML, images, and non-HTTPS links are not rendered. Downloads are signature checked and bound to the announced version before installing. The UI stays locked during installation and offers an explicit restart or restart later. Upgrading preserves the app data directory and external project memory. A failed check or download can be retried. On macOS, run the installed app from Applications, rather than the mounted DMG.

Versions before 0.3.0 do not contain the updater; install 0.3.0 manually once. Later versions can use in-app updates. New-version notes are shown once after upgrading a version that already supports this preference and remain available in Settings.

## Local packaging

Release bundles require the matching signing key:

```bash
TAURI_SIGNING_PRIVATE_KEY=/absolute/path/to/signing.key npm run tauri -- build --target aarch64-apple-darwin --bundles app,dmg -- --locked
```

For an unsigned preview, pass a JSON override disabling updater artifacts:

```bash
npm run tauri -- build --config '{"bundle":{"createUpdaterArtifacts":false}}' --target aarch64-apple-darwin --bundles app,dmg -- --locked
```
