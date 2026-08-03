#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  mergeMemoryHooks,
  unmergeMemoryHooks,
  loadManifest,
} = require('./merge-hooks');

const repoRoot = path.resolve(__dirname, '..');
const hooksSrc = path.join(repoRoot, 'hooks');
const cursorDir = path.join(os.homedir(), '.cursor');
const hooksJsonPath = path.join(cursorDir, 'hooks.json');
const memoryLink = path.join(cursorDir, 'hooks', 'memory');
const dataDir = path.join(cursorDir, 'memory');
const configPath = path.join(dataDir, 'config.json');
const exampleConfig = path.join(repoRoot, 'config.example.json');

function die(msg) {
  process.stderr.write('skar-memory install: ' + msg + '\n');
  process.exit(1);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function expandHomeInConfig(obj) {
  const home = os.homedir();
  const parents = (obj.knownWorkParents || []).map((p) => {
    if (p === '~') return home;
    if (typeof p === 'string' && (p.startsWith('~/') || p.startsWith('~\\'))) {
      return path.join(home, p.slice(2));
    }
    return path.resolve(p);
  });
  return { knownWorkParents: parents };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function isSymlinkOrJunction(p) {
  try {
    return Boolean(fs.lstatSync(p).isSymbolicLink());
  } catch {
    return false;
  }
}

function linkHooks(dryRun) {
  fs.mkdirSync(path.dirname(memoryLink), { recursive: true });
  if (fs.existsSync(memoryLink) || isSymlinkOrJunction(memoryLink)) {
    let same = false;
    try {
      same = path.resolve(fs.realpathSync(memoryLink)) === path.resolve(hooksSrc);
    } catch { /* ignore */ }
    if (same) {
      console.log('hooks link already points at repo hooks/');
      return;
    }
    const bak = memoryLink + '.bak-' + stamp();
    console.log((dryRun ? '[dry-run] ' : '') + 'backup existing hooks/memory -> ' + bak);
    if (!dryRun) {
      if (isSymlinkOrJunction(memoryLink)) fs.unlinkSync(memoryLink);
      else fs.renameSync(memoryLink, bak);
    }
  }
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  console.log((dryRun ? '[dry-run] ' : '') + 'link ' + memoryLink + ' -> ' + hooksSrc + ' (' + type + ')');
  if (!dryRun) fs.symlinkSync(hooksSrc, memoryLink, type);
}

function ensureDataAndConfig(dryRun) {
  console.log((dryRun ? '[dry-run] ' : '') + 'ensure data dir ' + dataDir);
  if (!dryRun) fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(configPath)) {
    console.log('config exists: ' + configPath);
    return;
  }
  const raw = readJson(exampleConfig, { knownWorkParents: ['~/Documents/GitHub', '~/Projects'] });
  const expanded = expandHomeInConfig(raw);
  console.log((dryRun ? '[dry-run] ' : '') + 'write ' + configPath);
  if (!dryRun) writeJson(configPath, expanded);
}

function mergeHooksFile(dryRun, uninstall) {
  const manifest = loadManifest(repoRoot);
  let current = { version: 1, hooks: {} };
  if (fs.existsSync(hooksJsonPath)) {
    current = readJson(hooksJsonPath, null);
    if (!current || typeof current !== 'object') die('unreadable hooks.json: ' + hooksJsonPath);
  }
  const next = uninstall
    ? unmergeMemoryHooks(current, memoryLink)
    : mergeMemoryHooks(current, memoryLink, manifest);
  const bak = hooksJsonPath + '.bak-' + stamp();
  console.log((dryRun ? '[dry-run] ' : '') + (uninstall ? 'unmerge' : 'merge') + ' ' + hooksJsonPath);
  if (!dryRun) {
    if (fs.existsSync(hooksJsonPath)) fs.copyFileSync(hooksJsonPath, bak);
    writeJson(hooksJsonPath, next);
    console.log('backup: ' + bak);
  }
}

function removeLink(dryRun) {
  if (!fs.existsSync(memoryLink) && !isSymlinkOrJunction(memoryLink)) {
    console.log('no hooks/memory link to remove');
    return;
  }
  console.log((dryRun ? '[dry-run] ' : '') + 'remove link ' + memoryLink);
  if (!dryRun) {
    if (isSymlinkOrJunction(memoryLink)) fs.unlinkSync(memoryLink);
    else die('hooks/memory is a real directory; refuse to delete. Backup/remove manually.');
  }
}

function purgeData(dryRun) {
  console.log((dryRun ? '[dry-run] ' : '') + 'PURGE data dir ' + dataDir);
  if (!dryRun) fs.rmSync(dataDir, { recursive: true, force: true });
}

function printWhereami() {
  const cli = path.join(hooksSrc, 'cli.js');
  const r = spawnSync(process.execPath, [cli, 'whereami'], { encoding: 'utf8' });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const purge = args.includes('--purge-data');
  const action = args.find((a) => a === 'install' || a === 'uninstall') || 'install';

  if (!fs.existsSync(hooksSrc)) die('missing hooks/ in repo: ' + hooksSrc);

  if (action === 'install') {
    linkHooks(dryRun);
    ensureDataAndConfig(dryRun);
    mergeHooksFile(dryRun, false);
    if (!dryRun) {
      console.log('\n--- whereami ---');
      printWhereami();
    }
    console.log('\nDone. Restart Cursor / start a new agent chat.');
    console.log('Project lessons store in <project>/.cursor/memory/ (not wiped by install).');
    return;
  }

  if (action === 'uninstall') {
    mergeHooksFile(dryRun, true);
    removeLink(dryRun);
    if (purge) purgeData(dryRun);
    else console.log('kept data dir ' + dataDir + ' (pass --purge-data to delete)');
    console.log('Uninstall complete.');
    return;
  }

  die('usage: node scripts/install-core.js [install|uninstall] [--dry-run] [--purge-data]');
}

main();
