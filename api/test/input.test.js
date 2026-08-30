import test from 'node:test';
import assert from 'node:assert/strict';
import { intakeOf } from '../coach/input.js';

test('intake is bounded and normalised before a paid job is queued', () => {
  const intake = intakeOf({
    goal: 'muscle', experience: 'regular', daysPerWeek: 3, sessionMin: 45,
    preferredDays: [1, 1, 3, 99], equipment: ['dumbbell', 'dumbbell', 42],
    limitations: 'x'.repeat(1000), likes: 'y'.repeat(500)
  });
  assert.deepEqual(intake.preferredDays, [1, 3]);
  assert.deepEqual(intake.equipment, ['dumbbell']);
  assert.equal(intake.limitations.length, 600);
  assert.equal(intake.likes.length, 300);
});

test('malformed intake and unknown enums fail before queueing', () => {
  assert.throws(() => intakeOf('not-an-object'), /object/);
  assert.throws(() => intakeOf({ goal: 'become-a-unicorn' }), /goal/);
});
