import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUsername,
  validateUsernameFormat,
  STUDENT_AVATAR_PRESETS,
} from './usernameValidation.ts';
import {
  isValidEmailFormat,
  mapFirebaseAuthError,
  normalizeEmailAddress,
  validateEmailPasswordLoginInput,
  validateEmailPasswordSignupInput,
} from './authValidation.ts';

describe('usernameValidation', () => {
  it('normalizes leading @ and uppercase safely', () => {
    assert.equal(normalizeUsername('  @Student_One  '), 'student_one');
  });

  it('accepts valid student usernames', () => {
    const res = validateUsernameFormat('physics_ace_10');
    assert.equal(res.valid, true);
    assert.equal(res.normalized, 'physics_ace_10');
  });

  it('rejects reserved, malformed, short, and duplicate-underscore usernames', () => {
    assert.equal(validateUsernameFormat('ab').valid, false);
    assert.equal(validateUsernameFormat('123student').valid, false);
    assert.equal(validateUsernameFormat('student__one').valid, false);
    assert.equal(validateUsernameFormat('student_').valid, false);
    assert.equal(validateUsernameFormat('admin').valid, false);
    assert.equal(validateUsernameFormat('eduverse').valid, false);
    assert.equal(validateUsernameFormat('bad-hyphen').valid, false);
  });

  it('exposes non-empty scholar avatar presets', () => {
    assert.ok(STUDENT_AVATAR_PRESETS.length >= 4);
  });
});

describe('Firebase email & password auth validation', () => {
  it('normalizes and validates email addresses', () => {
    assert.equal(normalizeEmailAddress('  Ananya.Iyer@School.Edu.In '), 'ananya.iyer@school.edu.in');
    assert.equal(isValidEmailFormat('scholar@school.edu.in'), true);
    assert.equal(isValidEmailFormat('not-an-email'), false);
    assert.equal(isValidEmailFormat('missing@tld'), false);
  });

  it('enforces signup display name, strong password, and confirmation match', () => {
    assert.equal(
      validateEmailPasswordSignupInput({
        displayName: 'Rohan Verma',
        email: 'rohan@school.edu.in',
        password: 'Study2025!',
        confirmPassword: 'Study2025!',
      }).valid,
      true
    );

    assert.equal(
      validateEmailPasswordSignupInput({
        displayName: 'A',
        email: 'rohan@school.edu.in',
        password: 'Study2025!',
        confirmPassword: 'Study2025!',
      }).valid,
      false
    );

    assert.equal(
      validateEmailPasswordSignupInput({
        displayName: 'Rohan Verma',
        email: 'rohan@school.edu.in',
        password: 'short1',
        confirmPassword: 'short1',
      }).valid,
      false
    );

    assert.equal(
      validateEmailPasswordSignupInput({
        displayName: 'Rohan Verma',
        email: 'rohan@school.edu.in',
        password: 'OnlyLettersPassword',
        confirmPassword: 'OnlyLettersPassword',
      }).valid,
      false
    );

    assert.equal(
      validateEmailPasswordSignupInput({
        displayName: 'Rohan Verma',
        email: 'rohan@school.edu.in',
        password: 'Study2025!',
        confirmPassword: 'Mismatch99!',
      }).valid,
      false
    );
  });

  it('validates login email and non-empty password', () => {
    assert.equal(
      validateEmailPasswordLoginInput({
        email: 'student@example.com',
        password: 'MyPassword1',
      }).valid,
      true
    );
    assert.equal(
      validateEmailPasswordLoginInput({
        email: 'bad-email',
        password: 'MyPassword1',
      }).valid,
      false
    );
    assert.equal(
      validateEmailPasswordLoginInput({
        email: 'student@example.com',
        password: '',
      }).valid,
      false
    );
  });

  it('maps Firebase Authentication error codes to clear user-friendly messages', () => {
    assert.match(
      mapFirebaseAuthError({ code: 'auth/email-already-in-use' }),
      /already exists/i
    );
    assert.match(
      mapFirebaseAuthError({ code: 'auth/invalid-credential' }),
      /incorrect email or password/i
    );
    assert.match(
      mapFirebaseAuthError({ code: 'auth/operation-not-allowed' }),
      /firebase authentication console/i
    );
    assert.match(
      mapFirebaseAuthError({ code: 'auth/requires-recent-login' }),
      /sign out and sign back in/i
    );
  });
});
