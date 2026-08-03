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
    assert.match(r.key, /missing-binary|ps-unix-tool|CommandNotFound|not recognized/i);
    assert.ok(r.lesson && r.lesson.length > 10);
  });

  it('detects bash command not found', () => {
    const r = detect('foo', 'foo: command not found');
    assert.ok(r);
    assert.ok(r.lesson);
  });

  it('returns null/empty for boring success text', () => {
    const r = detect('ls', 'file1.txt\nfile2.txt');
    assert.ok(!r || !r.key || r.key.startsWith('generic:'));
  });
});
