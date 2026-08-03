'use strict';

/**
 * Record one observation hit and promote into learned when count >= promoteAt.
 * Mutates observations/learned in place (same as prior learn.js behavior).
 *
 * @param {object} observations
 * @param {object} learned
 * @param {string} key
 * @param {{ lesson: string, event?: string, now?: number }} observation
 * @param {{ promoteAt?: number, maxLearned?: number, pruneByRecency?: Function }} opts
 * @returns {{ observations: object, learned: object, promoted: boolean, wasKnown: boolean, entry: object }}
 */
function promoteLesson(observations, learned, key, observation, opts) {
  const promoteAt = (opts && opts.promoteAt) || 2;
  const now = (observation && observation.now) || Date.now();
  const lesson = observation && observation.lesson;
  const event = observation && observation.event;

  const entry = observations[key] || { count: 0, firstSeen: now };
  entry.count += 1;
  entry.lastSeen = now;
  entry.lesson = lesson;
  if (event) entry.event = event;
  observations[key] = entry;

  if (entry.count < promoteAt) {
    return { observations, learned, promoted: false, wasKnown: false, entry };
  }

  const wasKnown = Boolean(learned[key]);
  learned[key] = {
    lesson: lesson,
    count: entry.count,
    lastSeen: now,
    promotedAt: wasKnown ? learned[key].promotedAt : now,
  };

  if (opts && typeof opts.pruneByRecency === 'function' && opts.maxLearned) {
    opts.pruneByRecency(learned, opts.maxLearned);
  }

  return { observations, learned, promoted: true, wasKnown, entry };
}

module.exports = { promoteLesson };
