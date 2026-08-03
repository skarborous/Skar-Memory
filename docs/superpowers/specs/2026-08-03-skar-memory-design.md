# Skar-Memory Design

Date: 2026-08-03
Status: draft for review

## Goal

Package the existing Cursor agent memory hooks (learn from repeated shell/tool failures, inject lessons, optionally enforce) as a **hooks-first**, cross-platform, open-source-ready repo. Local lesson data stays on the machine. MCP is explicitly out of v1.

## Non-goals (v1)

- MCP server
- npm publish / `npx` installer
- Cloud sync
- End-to-end tests against a live Cursor UI
- Migrating or rewriting the author's current live install in this phase (reference repo only until an explicit install step)

## Architecture

**Source of truth:** git repo `Skar-Memory` (e.g. `~/Documents/GitHub/Skar-Memory`).

**Runtime link (after install):** `~/.cursor/hooks/memory` → junction (Windows) or symlink (Unix) → `<repo>/hooks`.

**Data (never committed):** `~/.cursor/memory/`

- `config.json` — `knownWorkParents` and related settings
- `projects/<slug>/{learned,observations,project}.json`
- audit / debug samples as today

**Cursor wiring:** install merges only Skar-Memory hook entries into `~/.cursor/hooks.json`. Other hooks (lean-ctx, caveman, etc.) are left untouched.

```
Skar-Memory/
  hooks/                 # learn, enforce, inject, heal, detectors, lib, cli
  install.ps1
  install.sh
  config.example.json
  README.md
  LICENSE
  docs/superpowers/specs/
```

## Components

| File | Role |
|------|------|
| `lib.js` | Paths, project-root resolution, JSON IO, load `config.json` |
| `detectors.js` | Failure text → signature + lesson |
| `learn.js` | Hook: record failures; promote at threshold |
| `enforce.js` | Hook: block/warn on known-bad shell patterns |
| `inject.js` | Hook: inject learned lessons into agent context |
| `heal-hooks.js` | Hook: ensure memory hook wiring still present |
| `cli.js` | CLI: list / pending / forget / clear / projects / whereami |

## Data flow

1. Agent shell/tool fails.
2. `learn.js` records an observation under the resolved project slug.
3. When count ≥ promote threshold, lesson is written to `learned.json`.
4. On `sessionStart` / `preCompact`, `inject.js` adds lessons to context.
5. On later matching bad shell, `enforce.js` may stop the repeat.

Project root resolution follows the current logic (conversation id, workspace label, cwd climb). Paths outside `knownWorkParents` are treated as suspicious / `_unscoped` (behavior preserved; parents come from config).

## Install behavior

Cross-platform: `install.ps1` and `install.sh`.

1. Resolve repo root (script directory when run from a clone).
2. Require Node; exit nonzero with a clear message if missing.
3. Link `~/.cursor/hooks/memory` → `<repo>/hooks` (junction on Windows, symlink elsewhere). If a real directory already exists there, backup to `memory.bak-<timestamp>`, then link.
4. Ensure `~/.cursor/memory/` exists; **never delete or overwrite** existing lesson data.
5. If `config.json` is missing, write defaults from `config.example.json` (OS-appropriate `knownWorkParents` under the user home).
6. Merge memory hook entries into `~/.cursor/hooks.json` idempotently (upsert by stable path/id). Backup `hooks.json` before write. Do not remove non-memory hooks. Point commands at `node ~/.cursor/hooks/memory/<file>.js ...`.
7. Print `cli.js whereami` and instruct to restart Cursor / start a new agent chat.

**Uninstall:** remove memory hook entries and the link; keep `~/.cursor/memory` unless `--purge-data`.

## Configuration

`~/.cursor/memory/config.json` (example shipped as `config.example.json`):

- `knownWorkParents`: string[] of absolute directories that count as real work roots (default: `~/Documents/GitHub`, `~/Projects`).

Missing or invalid config → fall back to example defaults and warn on stderr; hooks still run (fail-open for agent sessions).

## Error handling

- **Hooks:** fail-open — exit 0 and emit valid JSON when Cursor expects it; never crash the agent session.
- **Install:** fail-closed — nonzero on missing Node, link failure, or unreadable `hooks.json`.
- **Backups:** real `hooks/memory` dir and `hooks.json` before destructive install steps.

## Testing (v1)

- Unit tests for detectors, promote threshold, config load, and project resolve.
- Hook merge fixture test: sample `hooks.json` in → expected memory entries out.
- Manual README checklist for a human running Cursor (not automated e2e in CI).

Automated live Cursor e2e is **out of scope** for v1.

## Reference-repo phase (this commit series)

Create `Skar-Memory` with a **copy** of the current hook sources and this design. Do **not**:

- modify `~/.cursor/memory` data
- replace or delete the live `~/.cursor/hooks/memory` tree
- rewrite the author's live `hooks.json`

Install scripts and live cutover happen only after this design is approved and an implementation plan is written.

## Future (explicitly later)

- Optional MCP server for inspect/edit of lessons
- npm distribution if demand exists
