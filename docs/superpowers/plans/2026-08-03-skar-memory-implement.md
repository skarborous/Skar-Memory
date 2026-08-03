# Skar-Memory Install + Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship cross-platform install/uninstall for Skar-Memory (link hooks, merge Cursor `hooks.json`, write `config.json` defaults) and make `knownWorkParents` configurable, with unit + merge fixture tests — without wiping existing `~/.cursor/memory` lesson data.

**Architecture:** Thin `install.ps1` / `install.sh` wrappers call one Node `scripts/install-core.js`. Hook merge is driven by `hooks/hooks-manifest.json`. `hooks/lib.js` loads `~/.cursor/memory/config.json` (fallback to defaults). Tests use Node's built-in `node --test` runner (no extra deps).

**Tech Stack:** Node.js (CommonJS, same as existing hooks), PowerShell + POSIX sh wrappers, `node --test`.

## Global Constraints

- Hooks-first; MCP out of v1
- Never delete/overwrite existing lesson JSON under `~/.cursor/memory/projects/`
- Install fail-closed; hooks remain fail-open
- Windows: directory junction for `~/.cursor/hooks/memory` → `<repo>/hooks`; Unix: symlink
- Merge only Skar-Memory hook entries; leave lean-ctx/caveman/other hooks alone
- Backup real `hooks/memory` dir and `hooks.json` before replace/merge
- No live Cursor e2e in CI
- Do not force-cut over the author's machine during implementation of pure library/tests; install script may be run only when user explicitly requests live cutover (Task 6 notes this)

## File Structure

| Path | Responsibility |
|------|----------------|
| `hooks/lib.js` | Add config load (`expandHome`, `loadConfig`, `getKnownWorkParents`); use parents from config everywhere `KNOWN_WORK_PARENTS` is used today |
| `hooks/promote.js` | Pure `promoteLesson(...)` extracted for unit tests (learn.js calls it) |
| `hooks/hooks-manifest.json` | Declarative list of memory hook entries (events, args, timeout, matcher) |
| `hooks/learn.js` | Call `promoteLesson` instead of inline promote |
| `scripts/install-core.js` | `install` / `uninstall`: link, ensure data dir, write config if missing, merge/unmerge hooks.json, backups |
| `scripts/merge-hooks.js` | Pure merge/unmerge helpers (testable) |
| `install.ps1` | Windows wrapper → `node scripts/install-core.js` |
| `install.sh` | Unix wrapper → `node scripts/install-core.js` |
| `tests/config.test.js` | Config load + `~` expand + fallback |
| `tests/detectors.test.js` | Detector signatures |
| `tests/promote.test.js` | Promote-at-threshold |
| `tests/merge-hooks.test.js` | Idempotent merge + foreign-hook preserve |
| `package.json` | `"test": "node --test"` |
| `LICENSE` | MIT |
| `README.md` | Install / uninstall / config / manual checklist |
| `config.example.json` | Already exists; keep in sync with defaults in lib |

---

### Task 1: Test runner + detector unit tests

**Files:**
- Create: `package.json`
- Create: `tests/detectors.test.js`
- Modify: none (detectors already export `detect`)

**Interfaces:**
- Consumes: `detect(command, text)` from `hooks/detectors.js` → `{ signature, lesson } | null`-ish shape as today
- Produces: green `npm test` for detectors only

- [ ] **Step 1: Write package.json**

```json
{
  "name": "skar-memory",
  "version": "0.1.0",
  "private": true,
  "description": "Cursor agent memory hooks — learn repeated shell/tool mistakes",
  "scripts": {
    "test": "node --test tests/**/*.test.js"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Write failing detector tests**

Create `tests/detectors.test.js`:

```js
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { detect } = require('../hooks/detectors');

describe('detect', () => {
  it('detects PowerShell CommandNotFoundException', () => {
    const r = detect(
      'foo',
      "foo : The term 'foo' is not recognized as the name of a cmdlet"
    );
    assert.ok(r);
    assert.match(r.signature, /cmd-not-found|CommandNotFound|not recognized/i);
    assert.ok(r.lesson && r.lesson.length > 10);
  });

  it('detects bash command not found', () => {
    const r = detect('foo', 'foo: command not found');
    assert.ok(r);
    assert.ok(r.lesson);
  });

  it('returns null/empty for boring success text', () => {
    const r = detect('ls', 'file1.txt\nfile2.txt');
    assert.ok(!r || !r.signature);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`  
Expected: PASS for detectors (adjust assertions to match actual `detectors.js` signature strings if first run fails — read `hooks/detectors.js` and align expected signature keys; do not invent new detectors).

- [ ] **Step 4: Commit**

```bash
git add package.json tests/detectors.test.js
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "test: add detector unit tests and npm test script"
```

---

### Task 2: Configurable knownWorkParents

**Files:**
- Modify: `hooks/lib.js`
- Modify: `hooks/learn.js` (scope warning uses parents)
- Modify: `hooks/cli.js` if it prints `KNOWN_WORK_PARENTS`
- Create: `tests/config.test.js`
- Keep in sync: `config.example.json`

**Interfaces:**
- Consumes: `~/.cursor/memory/config.json` shape `{ knownWorkParents: string[] }` with `~` allowed
- Produces:
  - `expandHome(p: string): string`
  - `loadConfig(): { knownWorkParents: string[] }`
  - `getKnownWorkParents(): string[]`
  - Export `CONFIG_PATH`, `loadConfig`, `expandHome`, `getKnownWorkParents`
  - Remove reliance on frozen `KNOWN_WORK_PARENTS` const for runtime checks; keep `KNOWN_WORK_PARENTS` export as deprecated alias = `getKnownWorkParents()` result only if needed for one release — prefer updating call sites to `getKnownWorkParents()`

- [ ] **Step 1: Write failing config tests**

Create `tests/config.test.js` using a temp dir via `os.tmpdir()` and env override:

In `lib.js` implementation, honor `process.env.SKAR_MEMORY_DIR` when set (test-only override of `DIR`). Document in comment: "test override; unset in production".

```js
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skar-mem-'));
process.env.SKAR_MEMORY_DIR = tmp;

// Require AFTER env set
const lib = require('../hooks/lib');

describe('loadConfig', () => {
  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.SKAR_MEMORY_DIR;
  });

  it('falls back to defaults when config missing', () => {
    const cfg = lib.loadConfig();
    assert.ok(Array.isArray(cfg.knownWorkParents));
    assert.ok(cfg.knownWorkParents.length >= 1);
    cfg.knownWorkParents.forEach((p) => {
      assert.equal(p.includes('~'), false);
      assert.ok(path.isAbsolute(p));
    });
  });

  it('reads knownWorkParents and expands ~', () => {
    fs.writeFileSync(
      path.join(tmp, 'config.json'),
      JSON.stringify({ knownWorkParents: ['~/Documents/GitHub'] }),
      'utf8'
    );
    // clear any cache if implemented
    if (lib.clearConfigCache) lib.clearConfigCache();
    const parents = lib.getKnownWorkParents();
    assert.equal(parents.length, 1);
    assert.equal(parents[0], path.join(os.homedir(), 'Documents', 'GitHub'));
  });

  it('invalid JSON falls back to defaults', () => {
    fs.writeFileSync(path.join(tmp, 'config.json'), '{not json', 'utf8');
    if (lib.clearConfigCache) lib.clearConfigCache();
    const cfg = lib.loadConfig();
    assert.ok(cfg.knownWorkParents.length >= 1);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `node --test tests/config.test.js`  
Expected: FAIL (`loadConfig` / `getKnownWorkParents` missing)

- [ ] **Step 3: Implement config in lib.js**

Near top of `hooks/lib.js`, replace fixed `DIR` / `KNOWN_WORK_PARENTS` with:

```js
const DIR = process.env.SKAR_MEMORY_DIR
  ? path.resolve(process.env.SKAR_MEMORY_DIR)
  : path.join(os.homedir(), '.cursor', 'memory');
const CONFIG_PATH = path.join(DIR, 'config.json');

const DEFAULT_KNOWN_WORK_PARENTS = [
  path.join(os.homedir(), 'Documents', 'GitHub'),
  path.join(os.homedir(), 'Projects'),
];

function expandHome(p) {
  if (typeof p !== 'string' || !p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

let _configCache = null;

function clearConfigCache() {
  _configCache = null;
}

function loadConfig() {
  if (_configCache) return _configCache;
  const raw = readJson(CONFIG_PATH, null);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.knownWorkParents) || !raw.knownWorkParents.length) {
    if (raw !== null) {
      try { process.stderr.write('skar-memory: invalid config.json, using defaults\n'); } catch { /* ignore */ }
    }
    _configCache = { knownWorkParents: DEFAULT_KNOWN_WORK_PARENTS.slice() };
    return _configCache;
  }
  _configCache = {
    knownWorkParents: raw.knownWorkParents.map(expandHome).map((p) => path.resolve(p)),
  };
  return _configCache;
}

function getKnownWorkParents() {
  return loadConfig().knownWorkParents;
}
```

Replace every internal use of `KNOWN_WORK_PARENTS` with `getKnownWorkParents()`.

Update `module.exports` to include `CONFIG_PATH`, `expandHome`, `loadConfig`, `getKnownWorkParents`, `clearConfigCache`, and set:

```js
// Back-compat: snapshot at require-time is wrong; export getter-backed name for cli/learn
get KNOWN_WORK_PARENTS() { return getKnownWorkParents(); }
```

CommonJS cannot do get in object literal easily — either:

```js
Object.defineProperty(module.exports, 'KNOWN_WORK_PARENTS', {
  enumerable: true,
  get: getKnownWorkParents,
});
```

after assigning the rest, **or** update `learn.js` / `cli.js` to call `getKnownWorkParents()`.

Prefer updating call sites to `lib.getKnownWorkParents()`.

- [ ] **Step 4: Run config tests — expect PASS**

Run: `node --test tests/config.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/lib.js hooks/learn.js hooks/cli.js tests/config.test.js config.example.json
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "feat: load knownWorkParents from ~/.cursor/memory/config.json"
```

---

### Task 3: Extract promoteLesson for unit tests

**Files:**
- Create: `hooks/promote.js`
- Modify: `hooks/learn.js` (use promote helper)
- Create: `tests/promote.test.js`

**Interfaces:**
- Consumes: observation map + learned map + signature key + lesson fields
- Produces:

```js
/**
 * @param {object} observations
 * @param {object} learned
 * @param {string} key
 * @param {{ lesson: string, count?: number, lastSeen?: number, command?: string }} observation
 * @param {{ promoteAt?: number, maxLearned?: number }} opts
 * @returns {{ observations: object, learned: object, promoted: boolean }}
 */
function promoteLesson(observations, learned, key, observation, opts)
```

Behavior: bump/count observation; if `count >= (opts.promoteAt || 2)`, copy into `learned` with lesson text; prune learned to `maxLearned`; return new maps (mutate copies or mutate in place — match learn.js today; prefer in-place like current code for drop-in).

- [ ] **Step 1: Read current promote block in learn.js and write failing tests matching that behavior**

```js
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { promoteLesson } = require('../hooks/promote');

describe('promoteLesson', () => {
  it('does not promote before threshold', () => {
    const observations = {};
    const learned = {};
    const r = promoteLesson(observations, learned, 'sig-a', { lesson: 'do X', count: 1 }, { promoteAt: 2 });
    assert.equal(r.promoted, false);
    assert.ok(!learned['sig-a']);
  });

  it('promotes when count reaches promoteAt', () => {
    const observations = { 'sig-a': { lesson: 'do X', count: 1 } };
    const learned = {};
    // second hit
    const r = promoteLesson(observations, learned, 'sig-a', { lesson: 'do X' }, { promoteAt: 2 });
    assert.equal(r.promoted, true);
    assert.equal(learned['sig-a'].lesson, 'do X');
    assert.ok(learned['sig-a'].count >= 2);
  });
});
```

Align exact count semantics with current `learn.js` (read before coding).

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test tests/promote.test.js`  
Expected: FAIL module not found

- [ ] **Step 3: Implement hooks/promote.js and wire learn.js**

Implement pure helper; in `learn.js` replace inline promote with `require('./promote').promoteLesson(...)`.

- [ ] **Step 4: Run all tests**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/promote.js hooks/learn.js tests/promote.test.js
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "refactor: extract promoteLesson for testability"
```

---

### Task 4: Pure hooks.json merge / unmerge

**Files:**
- Create: `hooks/hooks-manifest.json`
- Create: `scripts/merge-hooks.js`
- Create: `tests/merge-hooks.test.js`
- Create: `tests/fixtures/hooks-with-foreign.json`

**Interfaces:**
- Consumes: Cursor hooks.json object `{ hooks: { [event]: HookEntry[] }, version?: number }`
- Produces:

```js
function memoryCommandNeedle(memoryHooksDir) // normalized substring to detect our entries
function buildMemoryEntries(memoryHooksDir, manifest) // concrete entries with absolute node paths (forward slashes)
function mergeMemoryHooks(hooksJson, memoryHooksDir, manifest) → newHooksJson
function unmergeMemoryHooks(hooksJson, memoryHooksDir) → newHooksJson
function isMemoryHookEntry(entry, memoryHooksDir) → boolean
```

Manifest shape:

```json
{
  "entries": [
    { "event": "afterShellExecution", "script": "learn.js", "args": ["shell"], "timeout": 10 },
    { "event": "beforeSubmitPrompt", "script": "heal-hooks.js", "args": [], "timeout": 5 },
    { "event": "postToolUseFailure", "script": "learn.js", "args": ["tool"], "timeout": 10 },
    { "event": "preCompact", "script": "inject.js", "args": [] },
    { "event": "preToolUse", "script": "enforce.js", "args": [], "matcher": "Shell", "timeout": 5 },
    { "event": "sessionStart", "script": "inject.js", "args": [] },
    { "event": "postToolUse", "script": "learn.js", "args": ["tool"], "matcher": "Shell|CallMcpTool", "timeout": 10 }
  ]
}
```

Built command example: `node C:/Users/You/.cursor/hooks/memory/learn.js shell`

Merge rules:
1. Deep-clone input
2. For each event array, remove entries where `isMemoryHookEntry`
3. Append fresh built memory entries for that event
4. Preserve all non-memory entries and order relative to each other (memory entries appended after remaining, or keep stable positions — **append after non-memory** is fine and simple)
5. Idempotent: running twice yields same memory commands

- [ ] **Step 1: Write fixture + failing tests**

`tests/fixtures/hooks-with-foreign.json`:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "command": "node C:/other/caveman-session-start.js" }
    ],
    "preToolUse": [
      { "command": "C:/other/lean-ctx.exe hook rewrite", "matcher": "Shell" }
    ]
  }
}
```

Test file asserts foreign commands survive and memory commands appear exactly once per event after double merge.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement merge-hooks.js + hooks-manifest.json**

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add hooks/hooks-manifest.json scripts/merge-hooks.js tests/merge-hooks.test.js tests/fixtures
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "feat: idempotent Cursor hooks.json merge for Skar-Memory"
```

---

### Task 5: install-core.js (link, config, merge) + wrappers

**Files:**
- Create: `scripts/install-core.js`
- Create: `install.ps1`
- Create: `install.sh`
- Modify: `README.md` (install section)

**Interfaces:**
- CLI: `node scripts/install-core.js install|uninstall [--purge-data] [--dry-run]`
- `install`:
  1. Resolve `repoRoot` = path.resolve(__dirname, '..')
  2. Require `node` on PATH (already running)
  3. `cursorHooksMemory = path.join(os.homedir(), '.cursor', 'hooks', 'memory')`
  4. `dataDir = path.join(os.homedir(), '.cursor', 'memory')` — mkdir; never wipe projects/
  5. Link: if `cursorHooksMemory` exists and is NOT a link to `repoRoot/hooks`, rename to `memory.bak-<iso>`; create junction (win32) or symlink
  6. If `dataDir/config.json` missing, write expanded defaults from `config.example.json` (`~` → absolute)
  7. Backup `~/.cursor/hooks.json` to `hooks.json.bak-<iso>`; merge via `mergeMemoryHooks`
  8. Print `node <repo>/hooks/cli.js whereami` output + restart message
- `uninstall`: unmerge hooks; remove link (not bak folders); if `--purge-data` then remove `dataDir` (only when flag set)
- `--dry-run`: print actions, no writes

Windows link:

```js
fs.symlinkSync(targetHooks, cursorHooksMemory, 'junction');
```

Unix:

```js
fs.symlinkSync(targetHooks, cursorHooksMemory, 'dir');
```

- [ ] **Step 1: Implement install-core.js with --dry-run support**

Include clear stderr errors and `process.exit(1)` on failure.

- [ ] **Step 2: Wrappers**

`install.ps1`:

```powershell
param([Parameter(ValueFromRemainingArguments=$true)]$Args)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
node "$Root\scripts\install-core.js" @Args
exit $LASTEXITCODE
```

Default action: if no args, pass `install`.

`install.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
ACTION="${1:-install}"
shift || true
exec node "$ROOT/scripts/install-core.js" "$ACTION" "$@"
```

- [ ] **Step 3: Dry-run smoke (no live cutover unless user asked)**

Run: `node scripts/install-core.js install --dry-run`  
Expected: prints planned link/merge/config paths; exit 0; **no** changes to `~/.cursor`

- [ ] **Step 4: Update README with install/uninstall/config/manual checklist**

- [ ] **Step 5: Commit**

```bash
git add scripts/install-core.js install.ps1 install.sh README.md
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "feat: add cross-platform install and uninstall entrypoints"
```

---

### Task 6: LICENSE + README polish + optional live cutover note

**Files:**
- Create: `LICENSE` (MIT, copyright Skarborr / year 2026)
- Modify: `README.md` — badge status “install ready”; warn that running install on author machine will backup existing `~/.cursor/hooks/memory` then junction to repo

- [ ] **Step 1: Add MIT LICENSE**

- [ ] **Step 2: README manual checklist**

```markdown
## Manual verify (Cursor)
1. From repo: `.\install.ps1` or `./install.sh`
2. Restart Cursor / new agent chat
3. `node ~/.cursor/hooks/memory/cli.js whereami`
4. Trigger same failing command twice → `cli.js pending` / `list`
5. Confirm non-memory hooks still present in `~/.cursor/hooks.json`
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`  
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add LICENSE README.md
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "docs: add LICENSE and install verification checklist"
```

- [ ] **Step 5: Stop — do not run live install unless user explicitly says to cut over this machine**

---

## Spec coverage self-check

| Spec item | Task |
|-----------|------|
| Repo layout hooks/install/config/README/LICENSE | 1,5,6 |
| Junction/symlink runtime link | 5 |
| Data in `~/.cursor/memory`, never wipe lessons | 5 |
| config.json knownWorkParents | 2 |
| Merge hooks.json idempotent | 4,5 |
| Uninstall keep data unless purge | 5 |
| Fail-open hooks / fail-closed install | existing hooks + 5 |
| Unit tests detectors/promote/config | 1,2,3 |
| Merge fixture test | 4 |
| Manual README checklist, no e2e CI | 6 |
| MCP / npm publish out of scope | not planned |

## Placeholder scan

No TBD/TODO left in tasks. Exact manifests, function names, and commands provided.

## Type/name consistency

- `getKnownWorkParents` / `loadConfig` / `expandHome` / `clearConfigCache`
- `promoteLesson`
- `mergeMemoryHooks` / `unmergeMemoryHooks` / `buildMemoryEntries`
- CLI: `install` \| `uninstall` with `--purge-data` `--dry-run`
