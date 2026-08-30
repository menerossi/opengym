import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { extractJSON, validatePlan, validateReview, contractOK, CHANGE_TYPES } = await import('../coach/validate.js');

const PLAN = {
  routines: [{
    id: 'r1', name: 'Full body A',
    ex: [{ id: '0001', sets: 3, reps: 10 }, { id: '0007', sets: 3, sec: 45 }]
  }, { id: 'r2', name: 'Full body B', ex: [{ id: '0009', sets: 3, reps: 8 }] }],
  week: { 1: 'r1', 3: 'r2' }
};
const change = over => ({ id: 'c1', type: 'sets', target: { routineId: 'r1', exId: '0001' }, before: 3, after: 4, why: 'stalled twice', ...over });
const review = changes => validateReview({ coach_contract: 1, summary: 's', changes }, PLAN);

/* ---------------- extraction ---------------- */

test('JSON is recovered from whatever the model wrapped it in', () => {
  assert.deepEqual(extractJSON('{"a":1}').value, { a: 1 });
  assert.deepEqual(extractJSON('```json\n{"a":1}\n```').value, { a: 1 });
  assert.deepEqual(extractJSON('Here you go:\n```\n{"a":1}\n```\nHope that helps!').value, { a: 1 });
  assert.deepEqual(extractJSON('Sure. {"a":1} — let me know.').value, { a: 1 });
  assert.ok(extractJSON('I cannot help with that.').error);
  assert.ok(extractJSON('').error);
});

test('the provider response must declare the exact contract version', () => {
  assert.equal(contractOK({ coach_contract: 1 }), true);
  assert.equal(contractOK({}), false);
  assert.equal(contractOK({ coach_contract: 2 }), false);
});

/* ---------------- created plans ---------------- */

test('a plan referencing an unknown exercise is rejected, not quietly trimmed', () => {
  const r = validatePlan({
    routines: [{ name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }, { id: 'not-a-real-id', sets: 3, reps: 10 }] }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('not-a-real-id')));
});

test('a plan may reference a custom exercise it defines in the same answer', () => {
  const r = validatePlan({
    routines: [{ name: 'A', ex: [{ id: 'cx1', sets: 3, reps: 10 }] }],
    customEx: [{ id: 'cx1', n: 'Sandbag carry', bp: 'back' }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.bundle.customEx[0].n, 'Sandbag carry');
});

test('proposal identifiers must be unique', () => {
  const plan = validatePlan({
    routines: [
      { id: 'same', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] },
      { id: 'same', name: 'B', ex: [{ id: '0009', sets: 3, reps: 10 }] }
    ]
  });
  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some(e => e.includes('unique')));
  const changes = review([change({ id: 'duplicate' }), change({ id: 'duplicate', type: 'reps', after: 12 })]);
  assert.equal(changes.ok, false);
  assert.ok(changes.errors.some(e => e.includes('duplicated')));
});

test('the week may only point at routines the plan actually defines', () => {
  const r = validatePlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }], week: { 1: 'ghost' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('ghost')));
});

test('proposed baselines are capped at what the lifter has actually handled', () => {
  const r = validatePlan(
    { routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10, weight: 100 }] }] },
    { workingWeights: [{ id: '0001', best: 40 }] }
  );
  assert.equal(r.ok, true);
  assert.equal(r.bundle.routines[0].ex[0].weight, 40, 'optimism is clamped to evidence');
});

test('a plan that ignores the requested number of training days is rejected', () => {
  const r = validatePlan(
    { routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }], week: { 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1' } },
    { daysPerWeek: 3 }
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('4 days') && e.includes('3')));
});

test('an unknown progression policy is rejected', () => {
  const r = validatePlan({ routines: [{ name: 'A', prog: 'vibes', ex: [{ id: '0001', sets: 3, reps: 10 }] }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('vibes')));
});

/* ---------------- review change-sets ---------------- */

test('an invented change type does nothing at all', () => {
  const r = review([change({ type: 'delete-all-workouts' })]);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes('not allowed'));
  assert.ok(!CHANGE_TYPES.includes('delete-all-workouts'));
});

test('every change must target something that exists', () => {
  assert.equal(review([change({ target: { routineId: 'ghost', exId: '0001' } })]).ok, false);
  assert.equal(review([change({ target: { routineId: 'r1', exId: '9999' } })]).ok, false, 'exercise not in that routine');
  assert.equal(review([change({ target: { routineId: 'r2', exId: '0001' } })]).ok, false, 'right exercise, wrong routine');
});

test('a change without a rationale is rejected', () => {
  const r = review([change({ why: '' })]);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes('why'));
});

test('values are type-checked per change type', () => {
  assert.equal(review([change({ type: 'sets', after: 'four' })]).ok, false);
  assert.equal(review([change({ type: 'sets', after: 99 })]).ok, false);
  assert.equal(review([change({ type: 'reps', after: 0 })]).ok, false);
  assert.equal(review([change({ type: 'exercise-prog', after: 'linear' })]).ok, true);
  assert.equal(review([change({ type: 'exercise-prog', after: 'vibes' })]).ok, false);
  assert.equal(review([change({ type: 'inc', after: -5 })]).ok, false);
});

test('adding an exercise requires a real library id', () => {
  const ok = review([change({ type: 'add-exercise', target: { routineId: 'r1' }, after: { id: '0009', sets: 3, reps: 12 } })]);
  assert.equal(ok.ok, true);
  assert.equal(ok.proposal.changes[0].after.name, 'assisted chest dip (kneeling)');
  assert.equal(review([change({ type: 'add-exercise', target: { routineId: 'r1' }, after: { id: 'made-up' } })]).ok, false);
});

test('a reorder must be a permutation of what is already there', () => {
  assert.equal(review([change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0007', '0001'] })]).ok, true);
  assert.equal(review([change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0007'] })]).ok, false, 'dropping one is not a reorder');
  assert.equal(review([change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0007', '0009'] })]).ok, false, 'nor is smuggling one in');
});

test('a week change may only schedule a routine that exists, rest, or nothing', () => {
  assert.equal(review([change({ type: 'week', target: { weekday: 6 }, after: 'r2' })]).ok, true);
  assert.equal(review([change({ type: 'week', target: { weekday: 6 }, after: 'rest' })]).ok, true);
  assert.equal(review([change({ type: 'week', target: { weekday: 6 }, after: null })]).ok, true);
  assert.equal(review([change({ type: 'week', target: { weekday: 9 }, after: 'r1' })]).ok, false);
  assert.equal(review([change({ type: 'week', target: { weekday: 6 }, after: 'ghost' })]).ok, false);
});

test('"nothing to change" is a first-class answer, and so is an empty change list', () => {
  const a = validateReview({ nochange: true, reading: 'Plan is working.' }, PLAN);
  assert.equal(a.nochange, true);
  assert.equal(a.reading, 'Plan is working.');
  const b = review([]);
  assert.equal(b.nochange, true, 'no changes and "no changes" are the same outcome');
});

test('advice-only notes survive but carry no change', () => {
  const r = validateReview({ summary: 's', changes: [change()], notes: ['Body weight is flat — eat more.'] }, PLAN);
  assert.equal(r.proposal.notes.length, 1);
  assert.equal(r.proposal.changes.length, 1);
});

test('one bad change fails the whole set — nothing is ever half-applied', () => {
  const r = review([change(), change({ id: 'c2', type: 'not-a-type' })]);
  assert.equal(r.ok, false);
});

test('every allowed change type has a validator that accepts a well-formed instance', () => {
  const good = {
    'add-exercise': change({ type: 'add-exercise', target: { routineId: 'r1' }, after: { id: '0009', sets: 3, reps: 10 } }),
    'remove-exercise': change({ type: 'remove-exercise' }),
    'swap-exercise': change({ type: 'swap-exercise', after: { id: '0009' } }),
    sets: change({ type: 'sets', after: 4 }),
    reps: change({ type: 'reps', after: 12 }),
    repsMin: change({ type: 'repsMin', after: 8 }),
    sec: change({ type: 'sec', target: { routineId: 'r1', exId: '0007' }, after: 60 }),
    cardio: change({ type: 'cardio', after: { min: 25, speed: 9 } }),
    reorder: change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0007', '0001'] }),
    superset: change({ type: 'superset', after: { link: true, with: '0007' } }),
    'routine-prog': change({ type: 'routine-prog', target: { routineId: 'r1' }, after: 'double' }),
    'exercise-prog': change({ type: 'exercise-prog', after: 'greyskull' }),
    inc: change({ type: 'inc', after: 2.5 }),
    'add-routine': change({ type: 'add-routine', target: {}, after: { name: 'C', ex: [{ id: '0001', sets: 3, reps: 10 }] } }),
    'remove-routine': change({ type: 'remove-routine', target: { routineId: 'r2' } }),
    'rename-routine': change({ type: 'rename-routine', target: { routineId: 'r1' }, after: 'Upper' }),
    week: change({ type: 'week', target: { weekday: 2 }, after: 'r1' })
  };
  for (const type of CHANGE_TYPES) {
    assert.ok(good[type], `no fixture for change type "${type}" — add one`);
    const r = review([good[type]]);
    assert.equal(r.ok, true, `${type} should validate: ${JSON.stringify(r.errors)}`);
  }
});
