# Skar-Memory

Cursor agent memory hooks: learn repeated shell/tool mistakes, inject lessons, optionally enforce.

## Install

Requires Node 18+.

```powershell
# Windows
.\install.ps1
# or dry-run
.\install.ps1 install --dry-run
```

```bash
# macOS / Linux
./install.sh
./install.sh install --dry-run
```

Install will:

1. Junction/symlink `~/.cursor/hooks/memory` → this repo's `hooks/`
2. Ensure `~/.cursor/memory/` exists (global config + unscoped + audit only)
3. Write `~/.cursor/memory/config.json` **only if missing**
4. Merge Skar-Memory entries into `~/.cursor/hooks.json` (backs up first; leaves other hooks alone)

Uninstall:

```powershell
.\install.ps1 uninstall
# optional: also delete ~/.cursor/memory (global only)
.\install.ps1 uninstall --purge-data
```

## Where lessons live

| Kind | Path |
|------|------|
| Per project | `<project>/.cursor/memory/{learned,observations,project}.json` |
| Unscoped / unknown | `~/.cursor/memory/_unscoped/` |
| Config (`knownWorkParents`) | `~/.cursor/memory/config.json` |

Install **never** deletes project lesson files. Legacy stores under `~/.cursor/memory/projects/` are still listed by `cli.js projects` but new writes go project-local.

Tip: add `.cursor/memory/` to a project's `.gitignore` if you do not want lessons committed.

## CLI

```bash
node hooks/cli.js whereami
node hooks/cli.js list
node hooks/cli.js pending
node hooks/cli.js forget <key>
node hooks/cli.js projects
```

After install, same via `node ~/.cursor/hooks/memory/cli.js ...`.

## Manual verify (Cursor)

1. `.\install.ps1` or `./install.sh`
2. Restart Cursor / new agent chat
3. `node ~/.cursor/hooks/memory/cli.js whereami` — `store` should be `<project>/.cursor/memory`
4. Fail the same command twice → `pending` / `list`
5. Confirm non-memory hooks still in `~/.cursor/hooks.json`

## Dev

```bash
npm test
```

Design: [docs/superpowers/specs/2026-08-03-skar-memory-design.md](docs/superpowers/specs/2026-08-03-skar-memory-design.md)
