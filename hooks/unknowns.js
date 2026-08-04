'use strict';

const { normalize, commandHead, isJunkFailureText } = require('./detectors');

const MAX_KEY = 160;
const MIN_LESSON = 12;
const MAX_LESSON = 300;

function pickErrorLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  const scored = lines.find((l) =>
    /error|exception|failed|denied|invalid|cannot|unable|not found|rejected|fatal|traceback/i.test(l)
  );
  return normalize(scored || lines[0]).slice(0, 160);
}

/**
 * Stable fingerprint for an unknown failure. Returns null if junk / empty.
 * Never auto-promotes — agent must supply a lesson via cli promote.
 */
function fingerprintUnknown(command, text, exitCode) {
  if (isJunkFailureText(text)) return null;
  const hint = pickErrorLine(text);
  if (!hint || hint.length < 8) return null;

  const head = commandHead(command);
  const fp = hint
    .replace(/["'`][^"'`]*["'`]/g, '?')
    .replace(/[A-Za-z]:\\[^\s]+/g, '?path?')
    .replace(/\d+/g, 'N')
    .slice(0, 80);

  let key = 'unknown:' + head + ':' + fp;
  if (key.length > MAX_KEY) key = key.slice(0, MAX_KEY);

  return {
    key,
    hint: hint.slice(0, 140),
    commandHead: head,
    exitCode: typeof exitCode === 'number' ? exitCode : null,
  };
}

function recordUnknown(unknowns, finger, opts) {
  const now = (opts && opts.now) || Date.now();
  const event = opts && opts.event;
  const entry = unknowns[finger.key] || { count: 0, firstSeen: now, kind: 'unknown' };
  entry.count += 1;
  entry.lastSeen = now;
  entry.hint = finger.hint;
  entry.commandHead = finger.commandHead;
  if (finger.exitCode != null) entry.exitCode = finger.exitCode;
  if (event) entry.event = event;
  entry.kind = 'unknown';
  unknowns[finger.key] = entry;
  return entry;
}

function validateLesson(lesson) {
  const s = String(lesson || '').trim();
  if (s.length < MIN_LESSON) return { ok: false, error: 'lesson too short (min ' + MIN_LESSON + ' chars)' };
  if (s.length > MAX_LESSON) return { ok: false, error: 'lesson too long (max ' + MAX_LESSON + ' chars)' };
  if (isJunkFailureText(s)) return { ok: false, error: 'lesson looks like junk/secret dump' };
  if (/^unknown:/i.test(s)) return { ok: false, error: 'lesson must be a fix, not the key' };
  return { ok: true, lesson: s };
}

/**
 * Agent-assisted promote: explicit lesson required. Moves unknown → learned.
 */
function promoteUnknown(unknowns, learned, key, lesson, opts) {
  const v = validateLesson(lesson);
  if (!v.ok) return { ok: false, error: v.error };

  const entry = unknowns[key];
  if (!entry) return { ok: false, error: 'unknown key not found: ' + key };

  const now = (opts && opts.now) || Date.now();
  const wasKnown = Boolean(learned[key]);
  learned[key] = {
    lesson: v.lesson,
    count: entry.count || 1,
    lastSeen: now,
    promotedAt: wasKnown ? learned[key].promotedAt : now,
    source: 'agent-assisted',
    hint: entry.hint,
  };

  delete unknowns[key];

  if (opts && typeof opts.pruneByRecency === 'function' && opts.maxLearned) {
    opts.pruneByRecency(learned, opts.maxLearned);
  }

  return { ok: true, wasKnown, entry: learned[key] };
}

function buildUnknownNudge(finger, entry) {
  const count = entry && entry.count ? entry.count : 1;
  return [
    '## Unknown failure (NOT binding yet)',
    'Seen ' + count + 'x — key: `' + finger.key + '`',
    'Hint: ' + (finger.hint || (entry && entry.hint) || ''),
    'If you found a working fix, record it (one line):',
    '  node ~/.cursor/hooks/memory/cli.js promote "' + finger.key + '" -- "One-line workaround"',
    'Do NOT invent a binding lesson from the raw dump. Until promoted, treat this as a pending unknown only.',
  ].join('\n');
}

module.exports = {
  fingerprintUnknown,
  recordUnknown,
  promoteUnknown,
  validateLesson,
  buildUnknownNudge,
  pickErrorLine,
  MIN_LESSON,
  MAX_LESSON,
};
