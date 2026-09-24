# TokenLens

See where your AI tokens go.

Local-first desktop observer for AI token usage: which app, which model, which project, and what it cost. Prompts, responses, and API keys stay off this repository.

## Status

v0.1 is not implemented yet. Design notes live outside the git tree, on the maintainer's machine. This repository starts with the security boundary so later code cannot drift into shipping keys or tests.

## Rules

Read [SECURITY.md](SECURITY.md) before adding files.

- No API keys, tokens, or realistic key samples.
- No prompts, responses, or copied logs from Claude Code, Codex, or ZCode.
- No test code. Tests and fixtures are gitignored and must not be force-added.

## Planned shape

Tauri 2, React, Rust, and SQLite. Collectors are plugins. The first collectors are Claude Code, Codex, ZCode, and an OpenAI-compatible localhost proxy.

## License

MIT. See [LICENSE](LICENSE).
