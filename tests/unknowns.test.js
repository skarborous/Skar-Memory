'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  fingerprintUnknown,
  recordUnknown,
  promoteUnknown,
  validateLesson,
  buildUnknownNudge,
} = require('../hooks/unknowns');

describe('fingerprintUnknown', () => {
  it('returns null for junk dumps', () => {
    assert.equal(
      fingerprintUnknown('cmake --build .', 'CMake Error at CMakeLists.txt:1\n-- Configuring incomplete', 1),
      null
    );
  });

  it('fingerprints a short actionable error', () => {
    const f = fingerprintUnknown(
      'node scripts/foo.js',
      'Error: ENOENT: no such file or directory, open \'config.json\'',
      1
    );
    assert.ok(f);
    assert.match(f.key, /^unknown:/);
    assert.ok(f.hint.length >= 8);
  });

  it('stabilizes digits and paths in the key', () => {
    const a = fingerprintUnknown('tool', 'failed on C:\\Users\\x\\a\\file.txt line 42', 1);
    const b = fingerprintUnknown('tool', 'failed on C:\\Users\\y\\b\\file.txt line 99', 1);
    assert.ok(a && b);
    assert.equal(a.key, b.key);
  });
});

describe('recordUnknown', () => {
  it('increments count and never writes a lesson', () => {
    const unknowns = {};
    const finger = { key: 'unknown:node:hint', hint: 'something broke badly', commandHead: 'node', exitCode: 1 };
    const e1 = recordUnknown(unknowns, finger, { now: 1000, event: 'shell' });
    assert.equal(e1.count, 1);
    const e2 = recordUnknown(unknowns, finger, { now: 2000, event: 'shell' });
    assert.equal(e2.count, 2);
    assert.ok(!e2.lesson);
    assert.equal(e2.kind, 'unknown');
  });
});

describe('validateLesson / promoteUnknown', () => {
  it('rejects short or junk lessons', () => {
    assert.equal(validateLesson('short').ok, false);
    assert.equal(validateLesson('unknown:foo:bar').ok, false);
  });

  it('promotes unknown into learned and removes pending', () => {
    const unknowns = {
      'unknown:node:hint': { count: 3, hint: 'something broke badly', firstSeen: 1, lastSeen: 2 },
    };
    const learned = {};
    const r = promoteUnknown(unknowns, learned, 'unknown:node:hint', 'Use absolute path to config.json', {
      now: 3000,
      maxLearned: 25,
      pruneByRecency: (m) => m,
    });
    assert.equal(r.ok, true);
    assert.equal(r.wasKnown, false);
    assert.equal(learned['unknown:node:hint'].lesson, 'Use absolute path to config.json');
    assert.equal(learned['unknown:node:hint'].source, 'agent-assisted');
    assert.ok(!unknowns['unknown:node:hint']);
  });

  it('fails when key missing', () => {
    const r = promoteUnknown({}, {}, 'missing', 'A valid one-line workaround here');
    assert.equal(r.ok, false);
  });
});

describe('buildUnknownNudge', () => {
  it('includes promote command and NOT binding marker', () => {
    const finger = { key: 'unknown:node:hint', hint: 'boom' };
    const text = buildUnknownNudge(finger, { count: 2 });
    assert.match(text, /NOT binding/);
    assert.match(text, /cli\.js promote/);
    assert.match(text, /unknown:node:hint/);
  });
});