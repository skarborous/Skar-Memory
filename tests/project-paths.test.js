'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../hooks/lib');

describe('projectPaths', () => {
  it('stores under <project>/.cursor/memory', () => {
    const root = path.join(os.tmpdir(), 'skar-proj-example');
    const paths = lib.projectPaths(root);
    assert.equal(paths.dir, path.join(path.resolve(root), '.cursor', 'memory'));
    assert.equal(paths.learned, path.join(paths.dir, 'learned.json'));
    assert.equal(paths.unknowns, path.join(paths.dir, 'unknowns.json'));
  });

  it('uses global _unscoped for unscoped roots', () => {
    const root = path.join(lib.DIR, '_unscoped');
    const paths = lib.projectPaths(root);
    assert.equal(paths.dir, path.join(lib.DIR, '_unscoped'));
  });

  it('writeJson creates project-local dirs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skar-proj-'));
    const paths = lib.projectPaths(root);
    lib.writeJson(paths.learned, { 'k': { lesson: 'x', count: 1 } });
    assert.ok(fs.existsSync(paths.learned));
    fs.rmSync(root, { recursive: true, force: true });
  });
});
