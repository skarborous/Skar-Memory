#!/usr/bin/env node
// preToolUse: blocks Shell commands that match a known-learned lesson BEFORE they run.
// This is the enforcement layer — learning records, this prevents the failure from firing.
// Fail-open: any error → allow (never block on a bug).
'use strict';

const lib = require('./lib');
const { detect } = require('./detectors');

function emit(obj) { process.stdout.write(JSON.stringify(obj || {})); process.exit(0); }

// Map a lesson's detector signature back to a command-pattern check.
// Each lesson key prefix maps to a function that returns true if the command
// would trigger that known failure.
const BLOCKERS = {
  'ps-unix-tool:': (key, command) => {
    const tool = key.split(':')[1];
    // Block bare invocation of the unix tool name as the first token.
    const head = String(command || '').trim().split(/[\s;|]/)[0].toLowerCase();
    return head === tool;
  },
  'ps-no-and-operator': (_key, command) => /(^|\s)&&(\s|$)/.test(String(command || '')),
  'ps-curl-alias': (_key, command) => /^curl(\s|$)/.test(String(command || '').trim()) && !/^curl\.exe(\s|$)/.test(String(command || '').trim()),
  'ps-encoding-utf8nobom': (_key, command) => /utf8NoBOM/i.test(String(command || '')),
  'lean-ctx-shadow-mode': (_key, command) => false, // informational only — no command pattern to block
  'ctx-shell-no-writes': (_key, command) => /(^|\s)(>\s*|tee\s|curl\s+[^|]*-o\s|wget\s+[^|]*-O\s)/.test(String(command || '')),
};

async function main() {
  const raw = await lib.readStdin();
  let payload = {};
  try { payload = JSON.parse(raw); } catch { return emit({}); }

  const toolName = payload.tool_name || payload.toolName || '';
  if (toolName !== 'Shell' && toolName !== 'ctx_shell' && toolName !== 'CallMcpTool') return emit({});

  const input = payload.tool_input || payload.toolInput || payload.arguments || {};
  const command = input.command || payload.command || '';
  if (!command) return emit({});

  const root = lib.resolveProjectRoot(payload);
  const paths = lib.projectPaths(root);
  const learned = lib.readJson(paths.learned, {});

  let blockLesson = null;
  let blockKey = null;
  for (const key of Object.keys(learned)) {
    const prefix = Object.keys(BLOCKERS).find((p) => key.startsWith(p));
    if (!prefix) continue;
    const blocker = BLOCKERS[prefix];
    try {
      if (blocker(key, command)) {
        blockLesson = learned[key].lesson;
        blockKey = key;
        break;
      }
    } catch { /* fail open */ }
  }

  if (!blockLesson) return emit({});

  lib.appendAudit({
    event: 'preToolUse', action: 'blocked', cwd: process.cwd(), root,
    key: blockKey, command: String(command).slice(0, 80),
  });

  return emit({
    permission: 'deny',
    decision: 'deny',
    user_message: 'BLOCKED by learned constraint (' + blockKey + '): ' + blockLesson +
      '\n\nThis command has failed before in this environment. Use the lesson\'s suggested alternative. Run `node ~/.cursor/hooks/memory/cli.js forget ' + blockKey + '` if this block is wrong.',
  });
}

main().catch(() => emit({}));
