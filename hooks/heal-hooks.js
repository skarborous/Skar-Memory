#!/usr/bin/env node
// beforeSubmitPrompt: self-heals ~/.cursor/hooks.json if `lean-ctx wrap`/`setup`
// stripped the memory-learner hooks. Silent and zero-token when nothing is
// broken - only emits additional_context on the rare occasion it repairs
// something. Surgical merge: adds missing entries, never removes or
// reorders anything else in the file (so it can't fight lean-ctx's own
// hooks or anything else you add later).
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOKS_FILE = path.join(os.homedir(), '.cursor', 'hooks.json');
const MEMORY_DIR = path.resolve(__dirname).replace(/\\/g, '/');

function emit(obj) {
  process.stdout.write(JSON.stringify(obj || {}));
  process.exit(0);
}

const REQUIRED = [
  {
    event: 'sessionStart',
    match: /memory\/inject\.js/,
    entry: { command: 'node ' + MEMORY_DIR + '/inject.js' },
  },
  {
    event: 'afterShellExecution',
    match: /memory\/learn\.js\s+shell/,
    entry: { command: 'node ' + MEMORY_DIR + '/learn.js shell', timeout: 10 },
  },
  {
    event: 'postToolUseFailure',
    match: /memory\/learn\.js\s+tool/,
    entry: { command: 'node ' + MEMORY_DIR + '/learn.js tool', timeout: 10 },
  },
];

try {
  // Drain stdin without processing it; this hook doesn't need the prompt body.
  process.stdin.resume();

  if (!fs.existsSync(HOOKS_FILE)) return emit({});
  const config = JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf8'));
  config.hooks = config.hooks || {};

  let repaired = false;
  for (const req of REQUIRED) {
    const list = config.hooks[req.event] || [];
    const present = list.some((h) => h && typeof h.command === 'string' && req.match.test(h.command));
    if (!present) {
      list.push(req.entry);
      config.hooks[req.event] = list;
      repaired = true;
    }
  }

  if (!repaired) return emit({});

  const tmp = HOOKS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, HOOKS_FILE);

  emit({
    additional_context:
      'Note: the automatic-memory hooks (sessionStart/afterShellExecution/postToolUseFailure) ' +
      'were missing from hooks.json - likely removed by a lean-ctx wrap/setup run - and have been restored. ' +
      'Restart Cursor if learned lessons stop appearing at session start.',
  });
} catch {
  emit({}); // fail open: never block prompt submission over this
}
