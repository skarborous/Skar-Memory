'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// test override; unset in production
const DIR = process.env.SKAR_MEMORY_DIR
  ? path.resolve(process.env.SKAR_MEMORY_DIR)
  : path.join(os.homedir(), '.cursor', 'memory');
const PROJECTS_DIR = path.join(DIR, 'projects');
const SAMPLES = path.join(DIR, '_payload-samples.json');
const SCOPE_WARNINGS = path.join(DIR, 'scope-warnings.json');
const CONFIG_PATH = path.join(DIR, 'config.json');

// Real work lives under these parents. Anything a lesson resolves to outside
// of them (or straight to the home dir) is almost certainly a cwd-resolution
// miss, not a real project - flag it instead of silently filing it away.
// Overridable via ~/.cursor/memory/config.json ({ knownWorkParents: [...] }).
const DEFAULT_KNOWN_WORK_PARENTS = [
  path.join(os.homedir(), 'Documents', 'GitHub'),
  path.join(os.homedir(), 'Projects'),
];

function expandHome(p) {
  if (typeof p !== 'string' || !p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

let _configCache = null;

function clearConfigCache() {
  _configCache = null;
}

function loadConfig() {
  if (_configCache) return _configCache;
  const raw = readJson(CONFIG_PATH, null);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.knownWorkParents) || !raw.knownWorkParents.length) {
    if (raw !== null) {
      try { process.stderr.write('skar-memory: invalid config.json, using defaults\n'); } catch { /* ignore */ }
    }
    _configCache = { knownWorkParents: DEFAULT_KNOWN_WORK_PARENTS.slice() };
    return _configCache;
  }
  _configCache = {
    knownWorkParents: raw.knownWorkParents.map(expandHome).map((p) => path.resolve(p)),
  };
  return _configCache;
}

function getKnownWorkParents() {
  return loadConfig().knownWorkParents;
}

// A signature must repeat this many times before it becomes an injected lesson.
// No decay, no expiry: once learned, a lesson stays until explicitly forgotten.
const PROMOTE_AT = 2;
const MAX_LEARNED = 25;
const MAX_OBSERVATIONS = 200;

const CURSOR_CONFIG_DIR = path.join(os.homedir(), '.cursor');
const AUDIT_LOG = path.join(DIR, 'audit.jsonl');

function isCursorConfigPath(p) {
  const norm = normalizePath(p);
  const cfg = normalizePath(CURSOR_CONFIG_DIR);
  return norm === cfg || norm.startsWith(cfg + path.sep);
}

// Prefer conversation id over CURSOR_WORKSPACE_LABEL — the label can be stale
// (observed: hooks reported feat-terminal-ui-polish while chat lived in mcp-servers).
function resolveFromConversationId() {
  const cid = (process.env.CURSOR_CONVERSATION_ID || '').trim();
  if (!cid) return null;
  try {
    const projectsRoot = path.join(CURSOR_CONFIG_DIR, 'projects');
    for (const dir of fs.readdirSync(projectsRoot)) {
      const hit = path.join(projectsRoot, dir, 'agent-transcripts', cid);
      if (fs.existsSync(hit) || fs.existsSync(hit + '.jsonl')) {
        return decodeCursorProjectDir(dir);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function encodeCursorProjectDir(absPath) {
  return path.resolve(absPath)
    .replace(/^[A-Za-z]:/, (m) => m[0].toLowerCase())
    .replace(/[:\\/]+/g, '-')
    .replace(/^-/, '')
    .toLowerCase();
}

function decodeCursorProjectDir(dirName) {
  const want = String(dirName || '').toLowerCase();
  // Match by encoding real folders under known parents (handles worktrees too).
  for (const parent of getKnownWorkParents()) {
    if (!fs.existsSync(parent)) continue;
    const stack = [parent];
    let depth = 0;
    while (stack.length && depth < 200) {
      depth += 1;
      const cur = stack.pop();
      let entries;
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.cursor') continue;
        const full = path.join(cur, ent.name);
        if (encodeCursorProjectDir(full) === want) return path.resolve(full);
        // Only recurse into worktrees-like shallow nests
        if (ent.name === 'worktrees' || ent.name === 'Projects' || depth < 6) {
          stack.push(full);
        }
      }
    }
  }
  return null;
}

// Map CURSOR_WORKSPACE_LABEL to a real existing folder. Never invent paths.
function resolveFromWorkspaceLabel() {
  const label = (process.env.CURSOR_WORKSPACE_LABEL || '').trim();
  if (!label) return null;

  for (const parent of getKnownWorkParents()) {
    const candidate = path.join(parent, label);
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }

  // Worktrees / nested clones: search a few levels for a dir named exactly label
  for (const parent of getKnownWorkParents()) {
    const found = findNamedDir(parent, label, 4);
    if (found) return found;
  }

  // Cursor project folder naming: c-Users-...-Projects-mcp-servers
  try {
    const projectsRoot = path.join(CURSOR_CONFIG_DIR, 'projects');
    const dirs = fs.readdirSync(projectsRoot);
    const needle = '-' + label.toLowerCase();
    const matches = dirs.filter((d) => d.toLowerCase().endsWith(needle));
    for (const match of matches) {
      const decoded = match
        .replace(/^([a-z])-/, (_, drive) => drive.toUpperCase() + ':\\')
        .replace(/-/g, '\\');
      if (fs.existsSync(decoded)) return path.resolve(decoded);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function findNamedDir(root, name, maxDepth) {
  const target = name.toLowerCase();
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === '.cursor') continue;
      const full = path.join(dir, ent.name);
      if (ent.name.toLowerCase() === target) return path.resolve(full);
      if (depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}

// Walks up from `start` looking for a project anchor (.git, then project-level
// .cursor). Never treats ~/.cursor itself or the home dir as an anchor.
function findProjectRoot(start) {
  const home = os.homedir();
  let dir = path.resolve(start || process.cwd());
  if (isCursorConfigPath(dir)) return null;
  for (let i = 0; i < 25; i++) {
    if (dir === home || isCursorConfigPath(dir)) break;
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.cursor'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const resolved = path.resolve(start || process.cwd());
  if (isCursorConfigPath(resolved) || normalizePath(resolved) === normalizePath(home)) return null;
  // Only accept unmarked dirs that both sit under a known parent AND exist.
  if (isKnownWorkspaceRoot(resolved) && fs.existsSync(resolved)) return resolved;
  return null;
}

function normalizeWorkspaceRoot(p) {
  if (!p || typeof p !== 'string') return null;
  let s = p.trim();
  // Cursor sends Windows paths as "/C:/Users/..."
  s = s.replace(/^\/([A-Za-z]):[\\/]/, '$1:\\');
  s = s.replace(/\//g, path.sep);
  try { return path.resolve(s); } catch { return null; }
}

function resolveProjectRoot(payload) {
  payload = payload || {};

  // 1) workspace_roots from Cursor hook payload (most reliable)
  const roots = payload.workspace_roots || payload.workspaceRoots || [];
  if (Array.isArray(roots) && roots.length) {
    const n = normalizeWorkspaceRoot(roots[0]);
    if (n && fs.existsSync(n)) return findProjectRoot(n) || n;
  }

  // 2) transcript_path → decode project folder
  const transcript = payload.transcript_path || payload.transcriptPath;
  if (typeof transcript === 'string') {
    const m = transcript.replace(/\\/g, '/').match(/\.cursor\/projects\/([^/]+)\//i);
    if (m) {
      const decoded = decodeCursorProjectDir(m[1]);
      if (decoded) return decoded;
    }
  }

  // 3) explicit cwd / workspace fields on payload or tool_input
  const toolInput = payload.tool_input || payload.toolInput || {};
  const hinted = payload.cwd || toolInput.cwd || payload.workspace || payload.workspace_root ||
    payload.workspaceRoot || payload.working_directory || payload.workingDirectory;
  if (hinted) {
    const n = normalizeWorkspaceRoot(hinted) || path.resolve(String(hinted));
    const fromHint = findProjectRoot(n);
    if (fromHint) return fromHint;
  }

  // 4) process cwd (works for Shell when Cursor inherits workspace cwd)
  const fromCwd = findProjectRoot(process.cwd());
  if (fromCwd) return fromCwd;

  // 5) conversation id from payload (hooks don't get CURSOR_CONVERSATION_ID env)
  const cid = payload.conversation_id || payload.conversationId || process.env.CURSOR_CONVERSATION_ID;
  if (cid) {
    const prev = process.env.CURSOR_CONVERSATION_ID;
    process.env.CURSOR_CONVERSATION_ID = cid;
    const fromConversation = resolveFromConversationId();
    if (prev == null) delete process.env.CURSOR_CONVERSATION_ID;
    else process.env.CURSOR_CONVERSATION_ID = prev;
    if (fromConversation) return findProjectRoot(fromConversation) || fromConversation;
  }

  // 6) workspace label (can be stale — last resort before unscoped)
  const fromLabel = resolveFromWorkspaceLabel();
  if (fromLabel) return findProjectRoot(fromLabel) || fromLabel;

  const fallback = path.resolve(process.cwd());
  if (isCursorConfigPath(fallback) || !fs.existsSync(fallback)) {
    return path.join(DIR, '_unscoped');
  }
  return fallback;
}

function appendAudit(entry) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG, JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry)) + '\n', 'utf8');
  } catch {
    /* fail open */
  }
}

function projectSlug(root) {
  const base = path.basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'root';
  const hash = crypto.createHash('md5').update(root.toLowerCase()).digest('hex').slice(0, 8);
  return base + '-' + hash;
}

function isUnscopedStoreRoot(root) {
  const norm = normalizePath(root);
  const unscoped = normalizePath(path.join(DIR, '_unscoped'));
  return norm === unscoped || norm.endsWith(path.sep + '_unscoped') || path.basename(root) === '_unscoped';
}

// Per-project lessons live in <project>/.cursor/memory/.
// Unscoped / unknown roots still use ~/.cursor/memory/_unscoped.
function projectPaths(root) {
  const resolved = path.resolve(root || path.join(DIR, '_unscoped'));
  const dir = isUnscopedStoreRoot(resolved)
    ? path.join(DIR, '_unscoped')
    : path.join(resolved, '.cursor', 'memory');
  return {
    dir,
    root: resolved,
    observations: path.join(dir, 'observations.json'),
    learned: path.join(dir, 'learned.json'),
    meta: path.join(dir, 'project.json'),
  };
}

function ensureProjectMeta(paths) {
  try {
    fs.mkdirSync(paths.dir, { recursive: true });
    if (!fs.existsSync(paths.meta)) {
      fs.writeFileSync(paths.meta, JSON.stringify({ root: paths.root }, null, 2) + '\n', 'utf8');
    }
  } catch {
    /* fail open */
  }
}

function normalizePath(p) {
  return path.resolve(p).toLowerCase();
}

function isKnownWorkspaceRoot(root) {
  const norm = normalizePath(root);
  return getKnownWorkParents().some((parent) => {
    const p = normalizePath(parent);
    return norm === p || norm.startsWith(p + path.sep);
  });
}

function isSuspiciousRoot(root) {
  const norm = normalizePath(root);
  if (norm === normalizePath(os.homedir())) return true;
  if (norm.includes(path.sep + '_unscoped') || norm.endsWith('_unscoped')) return true;
  if (!fs.existsSync(root)) return true;
  return !isKnownWorkspaceRoot(root);
}

// Flags + records a suspicious root. Returns firstTime=true only the first
// time a given bad root is seen, so callers can warn once instead of on
// every single failure in a broken session.
function flagSuspiciousRoot(root, cwd, event) {
  if (!isSuspiciousRoot(root)) return { suspicious: false, firstTime: false };
  const warnings = readJson(SCOPE_WARNINGS, {});
  const key = normalizePath(root);
  const prior = warnings[key];
  warnings[key] = {
    root,
    lastCwd: cwd,
    lastEvent: event,
    firstSeen: prior ? prior.firstSeen : Date.now(),
    lastSeen: Date.now(),
    count: (prior && prior.count ? prior.count : 0) + 1,
  };
  writeJson(SCOPE_WARNINGS, pruneByRecency(warnings, 40));
  return { suspicious: true, firstTime: !prior };
}

function findProjectMemoryDirs(parent, maxDepth, out) {
  if (!parent || maxDepth < 0 || !fs.existsSync(parent)) return;
  let entries;
  try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const full = path.join(parent, ent.name);
    if (ent.name === '.cursor') {
      const mem = path.join(full, 'memory');
      if (fs.existsSync(path.join(mem, 'learned.json'))
        || fs.existsSync(path.join(mem, 'observations.json'))
        || fs.existsSync(path.join(mem, 'project.json'))) {
        out.push(mem);
      }
      continue;
    }
    if (maxDepth > 0) findProjectMemoryDirs(full, maxDepth - 1, out);
  }
}

function listProjects() {
  const seen = new Set();
  const results = [];

  function add(dir, rootHint) {
    const key = normalizePath(dir);
    if (seen.has(key)) return;
    seen.add(key);
    const meta = readJson(path.join(dir, 'project.json'), {});
    const root = meta.root || rootHint || path.dirname(path.dirname(dir));
    results.push({
      slug: path.basename(root),
      dir,
      root,
    });
  }

  // Project-local stores under known work parents
  for (const parent of getKnownWorkParents()) {
    const found = [];
    findProjectMemoryDirs(parent, 5, found);
    found.forEach((mem) => add(mem, path.dirname(path.dirname(mem))));
  }

  // Global unscoped
  const unscoped = path.join(DIR, '_unscoped');
  if (fs.existsSync(unscoped)) add(unscoped, unscoped);

  // Legacy global project stores (read-only discovery; new writes use project-local)
  try {
    fs.readdirSync(PROJECTS_DIR).forEach((slug) => {
      const dir = path.join(PROJECTS_DIR, slug);
      const meta = readJson(path.join(dir, 'project.json'), {});
      add(dir, meta.root || '(unknown)');
    });
  } catch { /* ignore */ }

  return results;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    /* fail open */
  }
}

function pruneByRecency(map, max) {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  keys
    .sort((a, b) => (map[a].lastSeen || 0) - (map[b].lastSeen || 0))
    .slice(0, keys.length - max)
    .forEach((k) => delete map[k]);
  return map;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const done = (forceEmpty) => {
      if (settled) return;
      settled = true;
      const trimmed = String(data || '').trim();
      // Empty stdin → '{}' so callers can no-op. Non-empty whitespace alone
      // is kept as-is so JSON.parse fails loudly into the audit log.
      resolve(forceEmpty && !trimmed ? '{}' : (trimmed || '{}'));
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('error', () => done(true));
    process.stdin.on('end', () => done(false));
    // Only force-finish if Cursor never closes stdin AND we got nothing.
    // Never cut off a partial JSON body mid-stream.
    setTimeout(() => {
      if (!settled && !data) done(true);
    }, 3000);
  });
}

// Records the shape of the first payload seen per event so hook wiring can be
// verified against real Cursor input rather than assumed field names.
function captureSample(event, payload) {
  try {
    const samples = readJson(SAMPLES, {});
    if (!samples[event]) {
      samples[event] = { keys: Object.keys(payload || {}), at: new Date().toISOString() };
      writeJson(SAMPLES, samples);
    }
    // Always overwrite last-payload so we can inspect live Cursor shapes.
    writeJson(path.join(DIR, '_last-payload.json'), {
      event,
      at: new Date().toISOString(),
      cwd: process.cwd(),
      label: process.env.CURSOR_WORKSPACE_LABEL || null,
      conversationId: process.env.CURSOR_CONVERSATION_ID || null,
      keys: Object.keys(payload || {}),
      payload,
    });
  } catch {
    /* ignore */
  }
}

module.exports = {
  DIR,
  CONFIG_PATH,
  PROJECTS_DIR,
  PROMOTE_AT,
  MAX_LEARNED,
  MAX_OBSERVATIONS,
  readJson,
  writeJson,
  pruneByRecency,
  readStdin,
  captureSample,
  appendAudit,
  AUDIT_LOG,
  resolveProjectRoot,
  projectPaths,
  ensureProjectMeta,
  listProjects,
  expandHome,
  loadConfig,
  getKnownWorkParents,
  clearConfigCache,
  SCOPE_WARNINGS,
  isSuspiciousRoot,
  flagSuspiciousRoot,
  isCursorConfigPath,
};

// Deprecated: snapshot-at-require-time is wrong once config reloads. Prefer
// getKnownWorkParents(). Kept as a getter-backed alias for one release.
Object.defineProperty(module.exports, 'KNOWN_WORK_PARENTS', {
  enumerable: true,
  get: getKnownWorkParents,
});
