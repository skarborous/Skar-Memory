'use strict';

const fs = require('fs');
const path = require('path');

function normalizeSlashes(p) {
  return String(p).replace(/\\/g, '/');
}

function memoryCommandNeedle(memoryHooksDir) {
  return normalizeSlashes(path.resolve(memoryHooksDir)).toLowerCase();
}

function isMemoryHookEntry(entry, memoryHooksDir) {
  if (!entry || typeof entry.command !== 'string') return false;
  const cmd = normalizeSlashes(entry.command).toLowerCase();
  const needle = memoryCommandNeedle(memoryHooksDir);
  if (cmd.includes(needle)) return true;
  // Also match legacy / portable path segments
  return /[/\\]hooks[/\\]memory[/\\]/i.test(entry.command)
    || /\.cursor[/\\]hooks[/\\]memory[/\\]/i.test(entry.command);
}

function buildMemoryEntries(memoryHooksDir, manifest) {
  const base = normalizeSlashes(path.resolve(memoryHooksDir));
  const entries = (manifest && manifest.entries) || [];
  return entries.map((e) => {
    const args = Array.isArray(e.args) ? e.args : [];
    const scriptPath = base + '/' + e.script;
    const command = ['node', scriptPath].concat(args).join(' ');
    const out = { command };
    if (e.matcher) out.matcher = e.matcher;
    if (typeof e.timeout === 'number') out.timeout = e.timeout;
    return { event: e.event, entry: out };
  });
}

function cloneHooksJson(hooksJson) {
  return JSON.parse(JSON.stringify(hooksJson || { hooks: {} }));
}

function mergeMemoryHooks(hooksJson, memoryHooksDir, manifest) {
  const out = cloneHooksJson(hooksJson);
  if (!out.hooks || typeof out.hooks !== 'object') out.hooks = {};

  // Strip existing memory entries from all events
  Object.keys(out.hooks).forEach((event) => {
    const list = out.hooks[event];
    if (!Array.isArray(list)) return;
    out.hooks[event] = list.filter((e) => !isMemoryHookEntry(e, memoryHooksDir));
  });

  const built = buildMemoryEntries(memoryHooksDir, manifest);
  built.forEach(({ event, entry }) => {
    if (!Array.isArray(out.hooks[event])) out.hooks[event] = [];
    out.hooks[event].push(entry);
  });

  return out;
}

function unmergeMemoryHooks(hooksJson, memoryHooksDir) {
  const out = cloneHooksJson(hooksJson);
  if (!out.hooks || typeof out.hooks !== 'object') return out;
  Object.keys(out.hooks).forEach((event) => {
    const list = out.hooks[event];
    if (!Array.isArray(list)) return;
    out.hooks[event] = list.filter((e) => !isMemoryHookEntry(e, memoryHooksDir));
    if (!out.hooks[event].length) delete out.hooks[event];
  });
  return out;
}

function loadManifest(repoRoot) {
  const p = path.join(repoRoot, 'hooks', 'hooks-manifest.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

module.exports = {
  normalizeSlashes,
  memoryCommandNeedle,
  isMemoryHookEntry,
  buildMemoryEntries,
  mergeMemoryHooks,
  unmergeMemoryHooks,
  loadManifest,
};
