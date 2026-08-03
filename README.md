# Skar-Memory

Cursor agent memory hooks: learn repeated shell/tool mistakes, inject lessons, optionally enforce.

**Status:** reference source + design. Install scripts and live cutover not shipped yet.

See [docs/superpowers/specs/2026-08-03-skar-memory-design.md](docs/superpowers/specs/2026-08-03-skar-memory-design.md).

## Layout

- `hooks/` — runtime scripts (copy of working hooks; do not point Cursor here until install exists)
- `config.example.json` — template for `~/.cursor/memory/config.json`

## Data

Lessons live in `~/.cursor/memory/` on each machine. Never committed here.
