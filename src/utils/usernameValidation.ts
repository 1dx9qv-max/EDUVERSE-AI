export interface AvatarPreset {
  id: string;
  label: string;
  gradient: string;
  badgeText: string;
}

export const STUDENT_AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: 'scholar-indigo',
    label: 'Indigo Prism',
    gradient: 'from-indigo-600 via-blue-600 to-cyan-500',
    badgeText: 'Scholar',
  },
  {
    id: 'scholar-emerald',
    label: 'Emerald Compass',
    gradient: 'from-emerald-600 via-teal-500 to-cyan-500',
    badgeText: 'Explorer',
  },
  {
    id: 'scholar-amber',
    label: 'Solaris Gold',
    gradient: 'from-amber-500 via-orange-500 to-rose-500',
    badgeText: 'Achiever',
  },
  {
    id: 'scholar-violet',
    label: 'Violet Nebula',
    gradient: 'from-violet-600 via-purple-600 to-fuchsia-500',
    badgeText: 'Innovator',
  },
  {
    id: 'scholar-crimson',
    label: 'Crimson Orbit',
    gradient: 'from-rose-600 via-pink-600 to-orange-500',
    badgeText: 'Pioneer',
  },
  {
    id: 'scholar-slate',
    label: 'Midnight Steel',
    gradient: 'from-slate-600 via-indigo-700 to-slate-800',
    badgeText: 'Analyst',
  },
];

export const DEFAULT_AVATAR_ID = 'scholar-indigo';

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'help',
  'eduverse',
  'eduverseai',
  'official',
  'moderator',
  'mod',
  'staff',
  'teacher',
  'guardian',
  'student',
  'api',
  'auth',
  'login',
  'signup',
  'dashboard',
  'settings',
  'null',
  'undefined',
  'anonymous',
  'guest',
  'demo',
]);

export function normalizeUsername(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

export interface UsernameValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

export function validateUsernameFormat(raw: string): UsernameValidationResult {
  const normalized = normalizeUsername(raw);

  if (!normalized) {
    return {
      valid: false,
      normalized,
      error: 'Please choose a unique username (3–24 characters).',
    };
  }
  if (normalized.length < 3 || normalized.length > 24) {
    return {
      valid: false,
      normalized,
      error: 'Username must be between 3 and 24 characters long.',
    };
  }
  if (!/^[a-z]/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Username must start with a lowercase letter (a–z).',
    };
  }
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Use only lowercase letters, numbers, and underscores (_).',
    };
  }
  if (normalized.endsWith('_') || normalized.includes('__')) {
    return {
      valid: false,
      normalized,
      error: 'Username cannot end with an underscore or contain double underscores (__).',
    };
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'This username is reserved by the platform. Please choose another.',
    };
  }

  return { valid: true, normalized };
}

export function getAvatarPreset(avatarId?: string): AvatarPreset {
  return (
    STUDENT_AVATAR_PRESETS.find((preset) => preset.id === avatarId) ||
    STUDENT_AVATAR_PRESETS[0]
  );
}
