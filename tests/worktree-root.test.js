'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../hooks/lib');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

describe('canonicalizeProjectRoot (worktrees)', () => {
  let base;

  before(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'skar-wt-'));
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('maps linked git worktree to main repo root', () => {
    const main = path.join(base, 'main-repo');
    const wt = path.join(base, 'linked-wt');
    fs.mkdirSync(path.join(main, '.git', 'worktrees', 'linked-wt'), { recursive: true });
    fs.mkdirSync(wt, { recursive: true });
    write(
      path.join(wt, '.git'),
      'gitdir: ' + path.join(main, '.git', 'worktrees', 'linked-wt') + '\n'
    );

    const canon = lib.canonicalizeProjectRoot(wt);
    assert.equal(path.resolve(canon), path.resolve(main));

    const paths = lib.projectPaths(wt);
    assert.equal(paths.dir, path.join(path.resolve(main), '.cursor', 'memory'));
  });

  it('maps path under .worktrees/ to outer project', () => {
    const main = path.join(base, 'outer');
    const nested = path.join(main, '.worktrees', 'agent-task');
    fs.mkdirSync(path.join(main, '.git'), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });
    write(path.join(nested, '.git'), 'gitdir: ' + path.join(main, '.git', 'worktrees', 'agent-task') + '\n');
    fs.mkdirSync(path.join(main, '.git', 'worktrees', 'agent-task'), { recursive: true });

    assert.equal(path.resolve(lib.canonicalizeProjectRoot(nested)), path.resolve(main));
  });

  it('leaves normal repo root unchanged', () => {
    const main = path.join(base, 'plain');
    fs.mkdirSync(path.join(main, '.git'), { recursive: true });
    assert.equal(path.resolve(lib.canonicalizeProjectRoot(main)), path.resolve(main));
  });
});
