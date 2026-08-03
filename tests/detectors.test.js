'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  detect,
  isJunkFailureText,
  isPromotableSignature,
} = require('../hooks/detectors');

describe('detect', () => {
  it('detects PowerShell CommandNotFoundException', () => {
    const r = detect(
      'foo',
      "foo : The term 'foo' is not recognized as the name of a cmdlet"
    );
    assert.ok(r);
    assert.match(r.key, /missing-binary:foo|ps-unix-tool:foo/);
    assert.ok(r.lesson && r.lesson.length > 10);
  });

  it('detects bash command not found as named missing-binary', () => {
    const r = detect('foo', 'foo: command not found');
    assert.ok(r);
    assert.equal(r.key, 'missing-binary:foo');
  });

  it('detects && separator', () => {
    const r = detect('a && b', "token '&&' is not a valid statement separator");
    assert.ok(r);
    assert.equal(r.key, 'ps-no-and-operator');
  });

  it('returns null for boring success text (no generic fallback)', () => {
    const r = detect('ls', 'file1.txt\nfile2.txt');
    assert.equal(r, null);
  });

  it('returns null for cmake dumps', () => {
    const r = detect(
      'cmake',
      'CMake Error: The current CMakeCache.txt directory is wrong'
    );
    assert.equal(r, null);
  });

  it('returns null for BLOCKED by learned constraint', () => {
    const r = detect(
      'cd foo && bar',
      'BLOCKED by learned constraint (ps-no-and-operator): PowerShell 5.1 rejects &&'
    );
    assert.equal(r, null);
  });

  it('returns null for pasted jest/vitest into PowerShell', () => {
    const r = detect(
      'python',
      "Unexpected token '}' in expression or statement. toBeInTheDocument()"
    );
    assert.equal(r, null);
  });

  it('returns null for npm notice banners', () => {
    const r = detect('npm test', 'npm notice run skar-memory@0.1.0 test');
    assert.equal(r, null);
  });
});

describe('isJunkFailureText / isPromotableSignature', () => {
  it('marks generic keys unpromotable', () => {
    assert.equal(isPromotableSignature({ key: 'generic:cd:foo', lesson: 'x' }), false);
    assert.equal(isPromotableSignature({ key: 'generic-exit:cd:1', lesson: 'x' }), false);
    assert.equal(isPromotableSignature({ key: 'ps-no-and-operator', lesson: 'x' }), true);
    assert.equal(isPromotableSignature({ key: 'missing-binary:foo', lesson: 'x' }), true);
  });

  it('flags secret-like dumps as junk', () => {
    assert.equal(isJunkFailureText('OPENAI_API_KEY=sk-abcdefghijklmnop'), true);
  });
});
