export type UserRole = 'student' | 'guardian' | 'teacher' | 'admin';

export type IndianBoard = 'CBSE' | 'CISCE' | 'ICSE' | 'ISC' | 'StateBoard' | 'Other';

export type ClassGrade =
  | 'Class 6'
  | 'Class 7'
  | 'Class 8'
  | 'Class 9'
  | 'Class 10'
  | 'Class 11'
  | 'Class 12';

export type PreferredLanguage = 'English' | 'Hindi' | 'Hinglish' | 'Bilingual';

export type AuthProviderKind = 'google' | 'password';

export interface UserProfile {
  uid: string;
  email: string;
  emailVerified?: boolean;
  authProvider?: AuthProviderKind;
  username?: string;
  displayName: string;
  avatarId?: string;
  photoURL?: string;
  role: UserRole;
  board: IndianBoard;
  classGrade: ClassGrade;
  state?: string;
  language: PreferredLanguage;
  subjects?: string[];
  learningGoals?: string[];
  onboardingCompleted?: boolean;
  streakDays: number;
  xpPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthCapabilities {
  googleOAuthReady: boolean;
  emailPasswordReady: boolean;
  emailVerificationLinksReady: boolean;
  passwordResetReady: boolean;
}
