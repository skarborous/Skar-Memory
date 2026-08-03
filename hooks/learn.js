#!/usr/bin/env node
// Records failing shell commands and tool calls, and promotes any failure that
// repeats into a durable lesson. Fail-open: always prints JSON, always exit 0.
// Usage: node learn.js <shell|tool>
//
// shell  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ afterShellExecution (native Shell tool only)
// tool   ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ postToolUseFailure AND postToolUse (catches ctx_shell MCP failures
//          that never hit afterShellExecution because lean-ctx routes Shell
//          through MCP)
'use strict';

const lib = require('./lib');
const { detect } = require('./detectors');
const { promoteLesson } = require('./promote');

const EVENT = process.argv[2] === 'tool' ? 'tool' : 'shell';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj || {}));
  process.exit(0);
}

function firstString(source, keys) {
  for (const key of keys) {
    const value = source && source[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function firstNumber(source, keys) {
  for (const key of keys) {
    const value = source && source[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value);
  }
  return null;
}

function extract(payload) {
  const input = payload.tool_input || payload.toolInput || payload.arguments || {};
  const output = payload.tool_output || payload.toolOutput || payload.result || payload.response || {};

  const toolName = firstString(payload, ['tool_name', 'toolName', 'name', 'tool']);

  const command = firstString(payload, ['command'])
    || firstString(input, ['command'])
    || toolName
    || EVENT;

  // Flatten nested MCP / tool result bodies into searchable text.
  let nested = '';
  try {
    if (output && typeof output === 'object') nested = JSON.stringify(output);
    else if (typeof output === 'string') nested = output;
  } catch { nested = ''; }

  const text = [
    firstString(payload, ['stderr', 'error', 'error_message', 'errorMessage', 'message']),
    firstString(output, ['stderr', 'error', 'error_message', 'message', 'output', 'text', 'content']),
    firstString(payload, ['output', 'aggregated_output', 'aggregatedOutput', 'stdout', 'text', 'content']),
    nested,
  ].filter(Boolean).join('\n');

  const exitCode = firstNumber(payload, ['exit_code', 'exitCode', 'code', 'status']);
  return { command, text, exitCode, toolName };
}

function looksFailed(exitCode, text, toolName, payload) {
  const hookEvent = payload && (payload.hook_event_name || payload.hookEventName || '');
  // postToolUseFailure is authoritative ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Cursor already classified it as a failure.
  if (hookEvent === 'postToolUseFailure') return true;
  if (payload && (payload.failure_type || payload.error_message || payload.errorMessage)) return true;
  if (typeof exitCode === 'number') return exitCode !== 0;
  // postToolUse / afterShellExecution successes: only learn if the body clearly
  // looks like an error. Never treat ordinary stdout (file contents, listings) as failure.
  return /CommandNotFoundException|is not recognized as the name|FullyQualifiedErrorId|\bBLOCKED\b|\[exit:\s*[1-9]|token '&&' is not a valid|lean-ctx replace mode is active|ctx_shell detected a/i.test(text || '');
}

function isNoiseLesson(signature, exitCode, text) {
  if (!signature) return true;
  // Generic fingerprints of successful command output (file contents, empty JSON, etc.)
  if (signature.key.indexOf('generic:') === 0) {
    if (exitCode === 0) return true;
    if (!/CommandNotFoundException|is not recognized|FullyQualifiedErrorId|Exception|\bERROR\b|\bBLOCKED\b|Cannot find path|Unable to find/i.test(text || '')) {
      return true;
    }
  }
  return false;
}

function fallbackSignature(command, exitCode) {
  const head = String(command || '').trim().split(/[\s;|]/)[0].toLowerCase().slice(0, 40) || 'unknown';
  return {
    key: 'generic-exit:' + head + ':' + (exitCode == null ? 'err' : exitCode),
    lesson: head + (exitCode == null
      ? ' keeps failing in this environment; treat it as a broken command.'
      : ' exits with code ' + exitCode + ' in this environment; treat it as a failing command.'),
  };
}

function buildEnforcementNudge(signature, count) {
  // Escalating severity by repeat count. Post-promote failures are NOT gentle reminders.
  // No preToolUse block exists; the only enforcement is the agent choosing to obey.
  const base = signature.lesson;
  if (count <= 2) return "Learned constraint (repeat failure): " + base;
  if (count <= 5) return "STOP. You have failed this exact way " + count + " times after the lesson was already known. " + base + " Do NOT attempt it again this session.";
  if (count <= 10) return "HARD STOP. " + count + " repeat failures of: " + base + " This is a binding environment constraint. Do not retry, do not work around, ask the user if stuck.";
  return "CRITICAL: " + count + " repeat failures and counting. The lesson below is being ignored. " + base + " Stop attempting this. If you believe the lesson is wrong, run `node ~/.cursor/hooks/memory/cli.js forget <key>` with its key — do not silently ignore it.";
}

function buildScopeWarning(root, scope) {
  if (!scope.suspicious || !scope.firstTime) return '';
  return 'Warning: a lesson was scoped to "' + root + '", which is outside known work folders (' +
    lib.getKnownWorkParents().join(', ') + '). Run `node ~/.cursor/hooks/memory/cli.js whereami` to check.';
}

async function main() {
  const raw = await lib.readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    lib.appendAudit({
      event: EVENT,
      skip: 'bad-json',
      cwd: process.cwd(),
      label: process.env.CURSOR_WORKSPACE_LABEL || null,
      rawLen: (raw || '').length,
      rawHead: String(raw || '').slice(0, 200),
      envKeys: Object.keys(process.env).filter((k) => /^CURSOR|^VSCODE_CWD|^PWD/i.test(k)),
    });
    return emit({});
  }

  lib.captureSample(EVENT, payload);

  const { command, text, exitCode, toolName } = extract(payload);
  const failed = looksFailed(exitCode, text, toolName, payload);

  if (!failed) {
    lib.appendAudit({
      event: EVENT, skip: 'not-failed', cwd: process.cwd(),
      command: String(command).slice(0, 80), exitCode, toolName,
      textLen: (text || '').length,
    });
    return emit({});
  }

  const signature = detect(command, text) || (typeof exitCode === 'number' || text
    ? fallbackSignature(command, exitCode)
    : null);

  if (!signature || isNoiseLesson(signature, exitCode, text)) {
    lib.appendAudit({
      event: EVENT, skip: signature ? 'noise' : 'no-signature', cwd: process.cwd(),
      command: String(command).slice(0, 80), exitCode,
      key: signature && signature.key, textHead: String(text).slice(0, 120),
    });
    return emit({});
  }

  const root = lib.resolveProjectRoot(payload);
  const scope = lib.flagSuspiciousRoot(root, process.cwd(), EVENT);
  const scopeWarning = buildScopeWarning(root, scope);
  const finish = (line) => {
    const lines = [scopeWarning, line].filter(Boolean);
    return lines.length ? emit({ additional_context: lines.join('\n') }) : emit({});
  };

  const paths = lib.projectPaths(root);
  lib.ensureProjectMeta(paths);

  const now = Date.now();
  const observations = lib.readJson(paths.observations, {});
  const learned = lib.readJson(paths.learned, {});
  const result = promoteLesson(
    observations,
    learned,
    signature.key,
    { lesson: signature.lesson, event: EVENT, now },
    {
      promoteAt: lib.PROMOTE_AT,
      maxLearned: lib.MAX_LEARNED,
      pruneByRecency: lib.pruneByRecency,
    }
  );
  lib.writeJson(paths.observations, lib.pruneByRecency(observations, lib.MAX_OBSERVATIONS));

  lib.appendAudit({
    event: EVENT, action: 'recorded', cwd: process.cwd(), root,
    label: process.env.CURSOR_WORKSPACE_LABEL || null,
    conversationId: process.env.CURSOR_CONVERSATION_ID || null,
    key: signature.key, count: result.entry.count, command: String(command).slice(0, 80),
    exitCode, toolName, suspicious: scope.suspicious,
  });

  if (!result.promoted) return finish(null);

  lib.writeJson(paths.learned, learned);

  lib.appendAudit({ event: EVENT, action: result.wasKnown ? 'nudge' : 'promoted', key: signature.key, root });

  return finish(result.wasKnown ? buildEnforcementNudge(signature, result.entry.count) : null);
}

main().catch((err) => {
  lib.appendAudit({ event: EVENT, skip: 'crash', error: String(err && err.message || err) });
  emit({});
});
