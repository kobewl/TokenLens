# TokenLens

See where your AI tokens go.

Local-first AI tool workspace: usage visibility, project handoffs, shared memory, and decision history. Prompts, responses, and API keys stay off this repository.

## Run

```bash
npm install
npm run tauri dev
```

The window reads available ZCode, Codex, Claude Code, Gemini CLI, and Cursor usage on this machine. It stores only usage metadata in its own SQLite file. It does not estimate cost, and it does not copy prompts or API keys. The dashboard shows a source coverage list because some installed apps do not expose verifiable per-request token counts locally.

Statistics use local calendar days. ZCode history already observed by TokenLens is retained when ZCode rotates its own database. Repeated Codex cumulative notifications are ignored. Cursor calls without a reliable timestamp appear only under **All**, and Cursor context size alone is never counted as usage. Local logs may still differ from provider billing records.

## Status

The first screen is a light usage dashboard with an app sidebar, provider / model / date filters, summary cards, and an hourly or daily bar chart. Switch the chart between requests and Tokens, expand input / output / cache / reasoning metrics, and inspect the latest 200 request metadata records in pages of 10. Provider, model, and project tabs show aggregate usage. Collection and queries run on background workers so synchronization does not block the window. Unchanged Codex files and ZCode / Cursor databases reuse cached usage metadata, and unchanged rows are not rewritten. Source coverage and appearance settings open from the sidebar; automatic refresh can run every 30 or 60 seconds, or be disabled. Empty selections show a single compact message. Only apps with collected usage appear in quick navigation; source coverage remains available for all detected apps. Zero-valued extra metrics and entire zero-valued token columns are hidden, as are cost and speed until verifiable data is collected. Browser previews show empty states; real local usage is available in the desktop app. Design notes live outside the git tree, on the maintainer's machine.

## AI tool workspace and project memory

**Tool overview** brings CLI, IDE, and desktop tools into one directory, alongside actual collector coverage and all-time usage. A catalog entry does not imply the app is installed or its MCP connection is verified. **Usage statistics** retains the existing filters and charts.

**Project memory** adds explicitly selected project directories to a local registry. The first handoff, decision, or view rebuild creates `.memory/baton.db` in that project. The store uses the Baton schema v1 from the supplied design documents: immutable handoff events, decisions with `active` / `superseded` history, and schema-version checks. Chinese keyword searches treat `%` and `_` as literal characters. The UI displays the latest 50 handoffs and decision history; current briefs include effective decisions. No private tool memory or conversation bodies are imported.

Writes regenerate `.memory/handoff.md`. **Connect tool → Generate guidance** is an explicit opt-in to maintain only the Baton marker block in `AGENTS.md`; malformed or repeated markers leave the original file intact and return a warning. View generation failures do not roll back an already saved memory record. Removing a project from the list leaves its files intact. Clearing usage does not clear project memory.

The installed TokenLens binary doubles as a stdio MCP server, so agents can share the same store without Python, an API key, a network port, or a running desktop window. The four tools are `current`, `handoff`, `add_decision`, and `search`. In the project page, **Connect tool** generates a project-bound configuration using the installed executable path:

```text
TokenLens.app/Contents/MacOS/tokenlens --mcp --project /absolute/project/path --tool cursor
```

Codex configuration is generated as TOML; other clients receive a generic JSON fragment. Add it using the client's supported MCP settings format. Copying a generic configuration does not establish a working client connection; verify tools/list and one handoff/current round trip in that client. If MCP is unavailable, use the generated handoff Markdown as the file-based fallback. The desktop and MCP transport share one Rust implementation rather than introducing a separate Python service.

Memory records contain explicitly authored summaries and rationale, not usage metadata. They stay in the selected project's `.memory/` directory and are never uploaded or automatically committed. This repository ignores `.memory/` and database files. Each external project decides how to back up or version its memory; do not commit sensitive content. The original design documents remain outside this public repository.

## Data management

**Export metadata** saves the complete current app / provider / model / date selection to a JSON file through the native save dialog. The latest-200 display limit does not apply to export. Exports above 100,000 records are rejected so you can narrow the selection. The file contains only the same usage metadata stored in TokenLens; it does not contain prompts, responses, or credentials.

**Settings → Clear usage** removes TokenLens's local usage history after confirmation and turns automatic refresh off. Original app logs and appearance preferences remain intact. Syncing again reimports available source records. Automatic refresh and appearance preferences persist between launches.

Claude Code project attribution uses each record's working directory when available, preserving names that contain hyphens. JSONL discovery does not follow nested symbolic links; unreadable directories, excessive depth / file count, and files above 128 MiB report a source error and preserve the previous snapshot.

## macOS installation and builds

The **macOS packages** GitHub Actions workflow builds both Apple Silicon (`aarch64-apple-darwin`) and Intel (`x86_64-apple-darwin`) packages on pull requests, version tags, or manual dispatch. Each build artifact contains a DMG, an app ZIP preserving executable permissions, and SHA-256 checksums. macOS 12 or later is required. Choose the package matching your Mac's processor, open the DMG, and drag TokenLens to Applications.

These development packages are unsigned and not notarized. macOS may block first launch; for a package you have verified, use **System Settings → Privacy & Security → Open Anyway**. A trusted public release requires an Apple Developer signing identity and notarization configuration, which this repository does not currently have.

To build on a Mac with Node.js 24, Rust, and Xcode Command Line Tools:

```bash
npm ci
rustup target add aarch64-apple-darwin
npm run tauri -- build --target aarch64-apple-darwin --bundles app,dmg -- --locked
```

For an Intel build replace the target with `x86_64-apple-darwin`. Packages are written under `src-tauri/target/<target>/release/bundle/`.

## Rules

Read [SECURITY.md](SECURITY.md) before adding files.

- No API keys, tokens, or realistic key samples.
- No prompts, responses, or copied logs from Claude Code, Codex, or ZCode.
- No test code. Tests and fixtures are gitignored and must not be force-added.

## Planned shape

Tauri 2, React, Rust, and SQLite. Collectors are plugins. The first collectors are Claude Code, Codex, ZCode, and an OpenAI-compatible localhost proxy.

## License

MIT. See [LICENSE](LICENSE).
