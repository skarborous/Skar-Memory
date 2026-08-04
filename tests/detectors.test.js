'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  detect,
  isJunkFailureText,
  isPromotableSignature,
  hasPowerShellAndOperator,
  parseLeanCtxExit,
  looksLikeExecutionFailure,
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

describe('hasPowerShellAndOperator', () => {
  it('flags real PowerShell && separators', () => {
    assert.equal(hasPowerShellAndOperator('npm test && npm build'), true);
    assert.equal(hasPowerShellAndOperator('cd foo; bar && baz'), true);
  });

  it('ignores && inside quoted payloads (python -c, etc.)', () => {
    assert.equal(hasPowerShellAndOperator('python -c "if (a && b) { pass }"'), false);
    assert.equal(hasPowerShellAndOperator("python -c 'order_coin_margined && price'"), false);
  });
});

describe('lean-ctx EXIT / execution failures', () => {
  it('parses EXIT N — message', () => {
    const p = parseLeanCtxExit('EXIT 9009 — Python was not found; run without arguments');
    assert.ok(p);
    assert.equal(p.code, 9009);
    assert.match(p.message, /Python was not found/);
  });

  it('parses [exit:N] and Command failed with exit code', () => {
    assert.equal(parseLeanCtxExit('[exit:1] boom').code, 1);
    assert.equal(parseLeanCtxExit('Command failed with exit code 127').code, 127);
  });

  it('detects Windows python store alias', () => {
    const text =
      'EXIT 9009 — Python was not found; run without arguments to install from the Microsoft Store, ' +
      'or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.\n[python | 450 ms]';
    const r = detect('python script.py', text);
    assert.ok(r);
    assert.equal(r.key, 'win-python-store-alias');
  });

  it('detects generic EXIT 9009 as missing-binary', () => {
    const r = detect('foo.exe', 'EXIT 9009 — The system cannot find the file specified.');
    assert.ok(r);
    assert.equal(r.key, 'missing-binary:foo.exe');
  });

  it('marks lean-ctx EXIT as execution failure', () => {
    assert.equal(looksLikeExecutionFailure('EXIT 1 — build failed'), true);
    assert.equal(looksLikeExecutionFailure('ok done'), false);
  });
});

describe('lean-ctx MCP / tool errors', () => {
  it('detects MCP -32602 task is required', () => {
    const r = detect('CallMcpTool', JSON.stringify({ error: 'MCP error -32602: task is required' }));
    assert.ok(r);
    assert.equal(r.key, 'lean-ctx-required:task');
  });

  it('detects pattern is required', () => {
    const r = detect('ctx_glob', 'MCP error -32602: pattern is required');
    assert.ok(r);
    assert.equal(r.key, 'lean-ctx-required:pattern');
  });

  it('detects Invalid arguments Required fields', () => {
    const r = detect('CallMcpTool', 'Error: Tool execution error. Invalid arguments:\nserver: Required\ntoolName: Required');
    assert.ok(r);
    assert.equal(r.key, 'lean-ctx-required:server');
  });

  it('detects refusing to scan privacy path', () => {
    const r = detect('ctx_search', "ERROR: refusing to scan 'C:/Users/x' — it resolves to a broad or privacy-protected directory");
    assert.ok(r);
    assert.equal(r.key, 'lean-ctx-path-scope');
  });

  it('detects [BLOCKED] and patch CONFLICT', () => {
    assert.equal(detect('ctx_shell', '[BLOCKED] file write').key, 'lean-ctx-shell-blocked');
    assert.equal(detect('ctx_patch', 'CONFLICT: stale anchor').key, 'lean-ctx-patch-stale');
    assert.equal(detect('ctx_edit', 'ERROR: old_string not found in file.js').key, 'lean-ctx-patch-stale');
  });

  it('marks MCP errors as execution failures', () => {
    assert.equal(looksLikeExecutionFailure(JSON.stringify({ error: 'MCP error -32602: task is required' })), true);
    assert.equal(looksLikeExecutionFailure('[BLOCKED] nope'), true);
  });
});
