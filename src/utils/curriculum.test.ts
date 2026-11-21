import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVAILABLE_SUBJECTS_BY_GRADE,
  CLASS_GRADES,
  INDIAN_BOARDS,
  INDIAN_STATES,
  POPULAR_LEARNING_GOALS,
  hasRoleAccess,
} from './curriculum.ts';

test('hasRoleAccess checks roles correctly', () => {
  assert.equal(hasRoleAccess('student', ['student']), true);
  assert.equal(hasRoleAccess('student', ['admin']), false);
  assert.equal(hasRoleAccess('admin', ['student']), true);
  assert.equal(hasRoleAccess('student', undefined), true);
});

test('Indian board, class grade, state, and exam goal datasets validate', () => {
  assert.ok(INDIAN_BOARDS.length >= 5);
  assert.equal(CLASS_GRADES.length, 7);
  assert.ok(INDIAN_STATES.length >= 25);
  assert.ok(POPULAR_LEARNING_GOALS.length >= 4);

  const subjectsClass10 = AVAILABLE_SUBJECTS_BY_GRADE['Class 10'];
  assert.ok(subjectsClass10.includes('Science'));
  assert.ok(subjectsClass10.some((s) => s.includes('Mathematics')));
});
