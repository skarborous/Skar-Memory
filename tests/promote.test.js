'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { promoteLesson } = require('../hooks/promote');

describe('promoteLesson', () => {
  it('does not promote before threshold', () => {
    const observations = {};
    const learned = {};
    const r = promoteLesson(
      observations,
      learned,
      'sig-a',
      { lesson: 'do X', now: 1000 },
      { promoteAt: 2 }
    );
    assert.equal(r.promoted, false);
    assert.equal(observations['sig-a'].count, 1);
    assert.ok(!learned['sig-a']);
  });

  it('promotes when count reaches promoteAt', () => {
    const observations = { 'sig-a': { lesson: 'do X', count: 1, firstSeen: 1 } };
    const learned = {};
    const r = promoteLesson(
      observations,
      learned,
      'sig-a',
      { lesson: 'do X', now: 2000 },
      { promoteAt: 2 }
    );
    assert.equal(r.promoted, true);
    assert.equal(r.wasKnown, false);
    assert.equal(learned['sig-a'].lesson, 'do X');
    assert.equal(learned['sig-a'].count, 2);
    assert.equal(observations['sig-a'].count, 2);
  });

  it('marks wasKnown on subsequent promotes', () => {
    const observations = { 'sig-a': { lesson: 'do X', count: 2, firstSeen: 1 } };
    const learned = { 'sig-a': { lesson: 'do X', count: 2, promotedAt: 50, lastSeen: 50 } };
    const r = promoteLesson(
      observations,
      learned,
      'sig-a',
      { lesson: 'do X', now: 3000 },
      { promoteAt: 2 }
    );
    assert.equal(r.promoted, true);
    assert.equal(r.wasKnown, true);
    assert.equal(learned['sig-a'].promotedAt, 50);
    assert.equal(learned['sig-a'].count, 3);
  });
});
