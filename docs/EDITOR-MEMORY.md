# Native editor memory

TokenLens starts on **Editor memory** and automatically builds a local source index. Sources are listed separately by editor, scope, project label, file name, and path. Startup discovery indexes metadata; document contents are read only after **View original**, **Aggregate selected memory**, or explicit sync actions. Nothing is automatically aggregated, written into another editor, or imported into the Baton handoff store.

## Read adapters

| Source | Local files / records |
| --- | --- |
| Claude Code | `~/.claude/CLAUDE.md`, rules, and `projects/*/memory/*.md`; project `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` and rules |
| Codex | `$CODEX_HOME` or `~/.codex`: `AGENTS.md`, `AGENTS.override.md`, and Markdown under `memories/` |
| Gemini CLI | `~/.gemini/GEMINI.md` and known projects' `GEMINI.md` |
| Cursor | Project `.cursorrules`, `.cursor/rules/*.mdc` / `.md`; local rules directory and the exact `aicontext.personalContext` record, if present |
| Kiro | Global and project `steering/*.md` |
| Windsurf | `~/.codeium/windsurf/memories/*.md` and project `.windsurf/rules/*.md` |
| OpenCode | `~/.config/opencode/AGENTS.md`; shared project AGENTS files appear under Common project guidance |
| VS Code Copilot | Project `.github/copilot-instructions.md` and `.github/instructions/*.md` |
| Antigravity / Trae | Existing project `.agent/rules/*.md` / `.trae/rules/*.md`; Trae global rule files |
| Common guidance | Known projects' `AGENTS.md` and `AGENTS.override.md`, kept as a shared source rather than attributed to an arbitrary editor |

These adapters expose existing memory or rule artifacts. They do not imply that every editor has the same memory system. Cursor cloud Memories and undocumented proprietary stores are not imported. ZCode's session directory metadata is used for project discovery; its private memory format is not yet adapted. File-based import references are shown as original text rather than expanded into arbitrary files.

Projects come from registered directories, cwd metadata in bounded Claude/Codex session headers, Codex thread-directory metadata, ZCode session-directory metadata, Gemini's local project registry, editor workspaceStorage folder records, and Projects / Developer / Code / Documents/GitHub directories. This is a bounded scan, not a whole-disk crawl. **Add project directory** can supplement discovery. Nested symbolic links are skipped. Text reads are UTF-8 and bounded to 512 KiB per file; a manual aggregate accepts up to 20 sources and 1 MiB. Native memory contents remain separate from usage SQLite and are never logged or sent to the update service.

## Aggregate and sync

**Aggregate selected memory** retains source headings and original content. It is an explicit, editable snapshot, not an AI-written summary or an automatic conflict resolver. Viewing or selecting a file does not aggregate it. Refreshing the index does not regenerate a previous aggregate.

**Sync this memory** or **Choose sync target** creates a preview for a discovered project and supported editor. Targets are Claude's `.claude/rules/tokenlens-memory.md`, Cursor's `.cursor/rules/tokenlens-memory.mdc`, Kiro's `.kiro/steering/tokenlens-memory.md`, Windsurf's `.windsurf/rules/tokenlens-memory.md`, Gemini's `GEMINI.md`, Copilot's `.github/copilot-instructions.md`, or Codex/OpenCode's `AGENTS.md`. This writes project instructions the target can consume, rather than reverse-engineering or replacing its internal auto-memory database. Native rule frontmatter is generated for new dedicated rule files.

Only the `tokenlens:memory` marker block is added or replaced. Other bytes are preserved; malformed or duplicated markers abort the preview. Updating `AGENTS.md` requires a checkbox for the selected project. Original source fingerprints are checked before preview and before applying. Changed targets, changed sources, symlinks, oversized contents, unknown targets and unscanned roots are rejected. Existing targets are backed up with restrictive permissions under the app data directory's `memory-backups/` before an atomic file replacement.

**Undo this sync** is available in the running app for the latest sync operation. It restores the original file or removes a newly created target. If the target changed after synchronization, undo stops to preserve the newer edits. Backup files remain available across restarts; the in-memory undo action is session-local. Nothing is committed to Git or uploaded automatically.

The scanner works on the machine running the installed desktop app. A browser preview or remote development workspace cannot inspect another machine's files.
