# Security policy

This repository is local-first. The rules below are mandatory and override convenience.

## Never commit secrets

Do not put API keys, tokens, passwords, cookies, or session secrets in source, docs, comments, fixtures, commit messages, issues, or pull requests. This includes OpenAI, Anthropic, Gemini, DeepSeek, Cursor, Kiro, ZCode, and any other provider.

Placeholders in docs must be the literal text `<REDACTED>`. Do not invent realistic-looking keys.

The local proxy may see `Authorization` only in memory while forwarding a request. It must not write that header to logs, errors, or SQLite.

## Never commit sensitive content

Default usage storage is metadata only: token counts, model, time, app, project, cost, latency, and non-body session ids.

Explicit project-memory features may store user- or agent-authored handoff summaries and decision rationale in the selected project’s `.memory/baton.db`. This is separate from collector storage. Never automatically import prompts, responses, private tool memories, or credentials into these records. The separate native editor-memory feature may automatically index file metadata in supported local memory/rule directories; it reads contents only when the user views, aggregates, or synchronizes selected sources. No automatic aggregation, conversation import, cloud upload, or insertion into Baton records is permitted. Explicit cross-editor synchronization must preserve content outside its managed block, check source/target changes, and back up existing target files locally before writing. Project memory databases, generated handoff files, and copied design documents must stay out of this public repository. AGENTS.md changes require the user’s explicit project-level opt-in.

Do not commit prompts, model responses, source code from other projects, copied logs, or database files from `~/.claude`, `~/.codex`, or `~/.zcode`.

## Never commit test code

Do not add unit tests, integration tests, fixtures, recorded HTTP bodies, or local experiment scripts. That includes `tests/`, `__tests__/`, `*.test.ts`, `*.spec.ts`, and `*_test.rs`.

Do not force-add ignored files. Tests, if you run any, stay on your machine.

`scripts/check-secrets.sh` is allowed. It is a guard, not a test suite.

## If something already landed

Revoke the key at the provider first. Then remove it from Git history. Deleting the latest commit is not enough.
