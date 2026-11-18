export type PasswordAuthAction = 'login' | 'signup' | 'reset';

export interface AuthValidationResult {
  valid: boolean;
  error?: string;
}

export function normalizeEmailAddress(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmailFormat(email: string): boolean {
  const normalized = normalizeEmailAddress(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized) && normalized.length <= 254;
}

export function validateEmailPasswordSignupInput(params: {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
}): AuthValidationResult {
  const name = String(params.displayName || '').trim();
  if (name.length < 2) {
    return { valid: false, error: 'Please enter your full name (at least 2 characters).' };
  }
  if (name.length > 80) {
    return { valid: false, error: 'Full name must be 80 characters or fewer.' };
  }

  if (!isValidEmailFormat(params.email)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  const password = String(params.password || '');
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return {
      valid: false,
      error: 'Password must include at least one letter and one number.',
    };
  }
  if (password !== String(params.confirmPassword || '')) {
    return { valid: false, error: 'Passwords do not match. Please re-enter carefully.' };
  }

  return { valid: true };
}

export function validateEmailPasswordLoginInput(params: {
  email: string;
  password: string;
}): AuthValidationResult {
  if (!isValidEmailFormat(params.email)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  if (!String(params.password || '')) {
    return { valid: false, error: 'Please enter your password.' };
  }
  return { valid: true };
}

export function mapFirebaseAuthError(err: unknown, fallback = 'Authentication request failed.'): string {
  const code = typeof (err as any)?.code === 'string' ? (err as any).code : '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account already exists with this email. Sign in with your password or Google, or use Reset Password.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 8 characters with letters and numbers.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Double-check your credentials or reset your password.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact your school administrator.';
    case 'auth/too-many-requests':
      return 'Too many attempts in a short period. Please wait a few minutes before trying again.';
    case 'auth/operation-not-allowed':
      return 'Email & Password sign-in is not yet enabled in Firebase Authentication Console for this project.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before finishing.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.';
    case 'auth/requires-recent-login':
      return 'For security, please sign out and sign back in cleanly before permanently deleting your account.';
    case 'auth/network-request-failed':
      return 'Network error communicating with Firebase Authentication. Check your connection and retry.';
    default:
      if (err instanceof Error && err.message) {
        return err.message;
      }
      return fallback;
  }
}
