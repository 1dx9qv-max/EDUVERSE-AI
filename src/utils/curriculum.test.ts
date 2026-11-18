import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  calculateXpGain, 
  updateStreak, 
  hasRoleAccess, 
  getSampleCurriculum, 
  INDIAN_BOARDS, 
  CLASS_GRADES,
  INDIAN_STATES,
  AVAILABLE_SUBJECTS_BY_GRADE,
  POPULAR_LEARNING_GOALS
} from './curriculum';

test('XP calculation handles zero and negative base points', () => {
  assert.equal(calculateXpGain(0, 0.8), 0);
  assert.equal(calculateXpGain(-10, 1.0), 0);
});

test('XP calculation awards accuracy bonus correctly', () => {
  assert.equal(calculateXpGain(100, 1.0, 1), 150);
  assert.equal(calculateXpGain(100, 0.5, 1), 125);
  assert.equal(calculateXpGain(100, 0.0, 1), 100);
});

test('XP calculation applies streak multiplier', () => {
  assert.equal(calculateXpGain(100, 1.0, 2), 300);
});

test('updateStreak handles fresh user or broken streak', () => {
  const result = updateStreak(null);
  assert.equal(result.newStreak, 1);
  assert.equal(result.maintained, true);

  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  const broken = updateStreak(threeDaysAgo);
  assert.equal(broken.newStreak, 1);
  assert.equal(broken.maintained, false);
});

test('hasRoleAccess checks roles correctly', () => {
  assert.equal(hasRoleAccess('student', ['student', 'teacher']), true);
  assert.equal(hasRoleAccess('guardian', ['student', 'teacher']), false);
  assert.equal(hasRoleAccess('admin', ['student']), true);
  assert.equal(hasRoleAccess('student', undefined), true);
});

test('curriculum lookup and onboarding datasets validate', () => {
  const highSchool = getSampleCurriculum('CBSE', 'Class 12');
  assert.ok(highSchool.length >= 3);
  assert.ok(highSchool.some(s => s.id === 'physics'));

  const class10 = getSampleCurriculum('CBSE', 'Class 10');
  assert.ok(class10.length >= 3);
  assert.ok(class10.some(s => s.id === 'science'));

  assert.ok(INDIAN_BOARDS.length >= 5);
  assert.equal(CLASS_GRADES.length, 7);
  assert.ok(INDIAN_STATES.length >= 25);
  assert.ok(POPULAR_LEARNING_GOALS.length >= 5);

  const subjectsClass10 = AVAILABLE_SUBJECTS_BY_GRADE['Class 10'];
  assert.ok(subjectsClass10.includes('Science'));
  assert.ok(subjectsClass10.some(s => s.includes('Mathematics')));
});
