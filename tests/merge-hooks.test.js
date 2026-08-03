'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  mergeMemoryHooks,
  unmergeMemoryHooks,
  isMemoryHookEntry,
  loadManifest,
} = require('../scripts/merge-hooks');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'hooks-with-foreign.json'), 'utf8')
);
const repoRoot = path.join(__dirname, '..');
const manifest = loadManifest(repoRoot);
const memoryDir = 'C:/Users/Someone/.cursor/hooks/memory';

describe('mergeMemoryHooks', () => {
  it('preserves foreign hooks and adds memory entries', () => {
    const merged = mergeMemoryHooks(fixture, memoryDir, manifest);
    assert.ok(merged.hooks.sessionStart.some((e) => e.command.includes('caveman')));
    assert.ok(merged.hooks.preToolUse.some((e) => e.command.includes('lean-ctx')));
    assert.ok(merged.hooks.sessionStart.some((e) => isMemoryHookEntry(e, memoryDir)));
    assert.ok(merged.hooks.afterShellExecution.some((e) => /learn\.js shell/.test(e.command)));
  });

  it('is idempotent', () => {
    const once = mergeMemoryHooks(fixture, memoryDir, manifest);
    const twice = mergeMemoryHooks(once, memoryDir, manifest);
    const countLearn = (h) => (h.hooks.afterShellExecution || [])
      .filter((e) => isMemoryHookEntry(e, memoryDir)).length;
    assert.equal(countLearn(once), 1);
    assert.equal(countLearn(twice), 1);
  });

  it('unmerge removes only memory hooks', () => {
    const merged = mergeMemoryHooks(fixture, memoryDir, manifest);
    const cleaned = unmergeMemoryHooks(merged, memoryDir);
    assert.ok(cleaned.hooks.sessionStart.some((e) => e.command.includes('caveman')));
    assert.ok(!(cleaned.hooks.afterShellExecution || []).some((e) => isMemoryHookEntry(e, memoryDir)));
  });
});
