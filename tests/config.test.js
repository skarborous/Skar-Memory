'use strict';
const { describe, it, after } = require('node:test');
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