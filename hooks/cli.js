#!/usr/bin/env node
// Inspect or edit what the agent has learned. Scoped to the current project
// (nearest .git/.cursor ancestor of cwd) unless --all is given.
//   node cli.js list [--all]     show promoted lessons
//   node cli.js pending [--all]  show failures not yet repeated enough to promote
//   node cli.js unknowns [--all] show pending unknown failures (not binding)
//   node cli.js promote <key> -- "lesson"  agent-assisted: unknown -> learned
//   node cli.js forget <key>     current project only
//   node cli.js clear            current project only
//   node cli.js projects         list every project with stored memory
'use strict';

const lib = require('./lib');
const { promoteUnknown } = require('./unknowns');

const args = process.argv.slice(2);
const all = args.includes('--all');
const filtered = args.filter((a) => a !== '--all');
const action = filtered[0] || 'list';
const dash = filtered.indexOf('--');
const target = dash >= 0 ? filtered[1] : filtered[1];
const promoteLessonText = dash >= 0 ? filtered.slice(dash + 1).join(' ').trim() : '';

function show(map, label) {
  const keys = Object.keys(map);
  if (!keys.length) {
    console.log(label + ': empty');
    return;
  }
  console.log(label + ' (' + keys.length + '):');
  keys
    .sort((a, b) => (map[b].count || 0) - (map[a].count || 0))
    .forEach((key) => {
      const e = map[key];
      console.log('  [' + (e.count || 0) + 'x] ' + key);
      const detail = e.lesson || e.hint || '';
      if (detail) console.log('        ' + detail);
    });
}

function forEachProjectPaths(fn) {
  if (all) {
    lib.listProjects().forEach((p) => fn(lib.projectPaths(p.root), p.root));
    return;
  }
  const root = lib.resolveProjectRoot({});
  fn(lib.projectPaths(root), root);
}

switch (action) {
  case 'whereami': {
    const root = lib.resolveProjectRoot({});
    const paths = lib.projectPaths(root);
    console.log('cwd:    ' + process.cwd());
    console.log('root:   ' + root);
    console.log('store:  ' + paths.dir);
    if (lib.isSuspiciousRoot(root)) {
      console.log('WARNING: outside known work folders (' + lib.getKnownWorkParents().join(', ') + ') - likely a scoping miss.');
    }
    break;
  }
  case 'projects':
    lib.listProjects().forEach((p) => console.log(p.root + '  (' + p.slug + ')'));
    break;
  case 'scope-warnings': {
    const warnings = lib.readJson(lib.SCOPE_WARNINGS, {});
    const keys = Object.keys(warnings);
    if (!keys.length) {
      console.log('No suspicious-root warnings recorded.');
      break;
    }
    keys.forEach((k) => {
      const w = warnings[k];
      console.log('[' + (w.count || 0) + 'x, last: ' + w.lastEvent + '] ' + w.root);
      console.log('       cwd was: ' + w.lastCwd);
    });
    break;
  }
  case 'pending':
    forEachProjectPaths((paths, root) => {
      console.log('# ' + root);
      show(lib.readJson(paths.observations, {}), 'Pending observations');
    });
    break;
  case 'unknowns':
    forEachProjectPaths((paths, root) => {
      console.log('# ' + root);
      show(lib.readJson(paths.unknowns, {}), 'Pending unknowns (not binding)');
    });
    break;
  case 'promote': {
    if (!target || !promoteLessonText) {
      console.log('usage: node cli.js promote <key> -- "One-line workaround"');
      break;
    }
    const root = lib.resolveProjectRoot({});
    const paths = lib.projectPaths(root);
    const unknowns = lib.readJson(paths.unknowns, {});
    const learned = lib.readJson(paths.learned, {});
    const result = promoteUnknown(unknowns, learned, target, promoteLessonText, {
      maxLearned: lib.MAX_LEARNED,
      pruneByRecency: lib.pruneByRecency,
    });
    if (!result.ok) {
      console.error('promote failed: ' + result.error);
      process.exitCode = 1;
      break;
    }
    lib.writeJson(paths.unknowns, unknowns);
    lib.writeJson(paths.learned, learned);
    console.log((result.wasKnown ? 'updated' : 'promoted') + ' ' + target + ' in ' + root);
    console.log('  lesson: ' + result.entry.lesson);
    break;
  }
  case 'forget': {
    if (!target) {
      console.log('usage: node cli.js forget <key>');
      break;
    }
    const root = lib.resolveProjectRoot({});
    const paths = lib.projectPaths(root);
    const learned = lib.readJson(paths.learned, {});
    const observations = lib.readJson(paths.observations, {});
    const unknowns = lib.readJson(paths.unknowns, {});
    delete learned[target];
    delete observations[target];
    delete unknowns[target];
    lib.writeJson(paths.learned, learned);
    lib.writeJson(paths.observations, observations);
    lib.writeJson(paths.unknowns, unknowns);
    console.log('forgot ' + target + ' in ' + root);
    break;
  }
  case 'clear': {
    const root = lib.resolveProjectRoot({});
    const paths = lib.projectPaths(root);
    lib.writeJson(paths.learned, {});
    lib.writeJson(paths.observations, {});
    lib.writeJson(paths.unknowns, {});
    console.log('cleared ' + root);
    break;
  }
  default:
    forEachProjectPaths((paths, root) => {
      console.log('# ' + root);
      show(lib.readJson(paths.learned, {}), 'Learned lessons');
    });
}
