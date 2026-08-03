#!/usr/bin/env node
// sessionStart: injects only lessons the agent actually earned by failing twice.
// Resolves workspace via CURSOR_WORKSPACE_LABEL when cwd is ~/.cursor.
'use strict';

const lib = require('./lib');

const MAX_CHARS = 900;
const MAX_ITEMS = 12;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj || {}));
  process.exit(0);
}

async function main() {
  const raw = await lib.readStdin();
  let payload = {};
  try { payload = JSON.parse(raw); } catch { /* keep default */ }

  const root = lib.resolveProjectRoot(payload);
  const paths = lib.projectPaths(root);

  const scope = lib.flagSuspiciousRoot(root, process.cwd(), 'sessionStart');
  // Only warn when we still landed outside known work folders AFTER label
  // resolution Ã¢â‚¬â€ that means something is genuinely wrong.
  const scopeWarning = scope.suspicious
    ? 'Warning: memory this session is scoped to "' + root + '", outside known work folders (' +
      lib.KNOWN_WORK_PARENTS.join(', ') + '). Lessons here may not reach your real project. Run ' +
      '`node ~/.cursor/hooks/memory/cli.js whereami` to check.'
    : '';

  lib.appendAudit({
    event: 'sessionStart', action: 'inject',
    cwd: process.cwd(), root,
    label: process.env.CURSOR_WORKSPACE_LABEL || null,
    suspicious: scope.suspicious,
  });

  const learned = lib.readJson(paths.learned, {});
  const entries = Object.values(learned)
    .filter((e) => e && e.lesson)
    .sort((a, b) => (b.count || 0) - (a.count || 0) || (b.lastSeen || 0) - (a.lastSeen || 0))
    .slice(0, MAX_ITEMS);

  const lines = [];
  let budget = MAX_CHARS;
  for (const entry of entries) {
    const line = '- ' + entry.lesson;
    if (line.length > budget) break;
    lines.push(line);
    budget -= line.length + 1;
  }

  if (!lines.length) return scopeWarning ? emit({ additional_context: scopeWarning }) : emit({});

  return emit({
    additional_context: [
      scopeWarning,
      '## Learned constraints (auto-captured from repeated failures) - BINDING',
      'These came from real errors in this environment. They are NOT suggestions. Every one was promoted because the agent failed the same way at least twice after the lesson was already known. Re-failing the same way will keep incrementing the counter and trigger a louder nudge each time.',
      'Forget a wrong lesson: `node ~/.cursor/hooks/memory/cli.js forget <key>`.',
      ...lines,
    ].filter(Boolean).join('\n'),
  });
}

main().catch(() => emit({}));
