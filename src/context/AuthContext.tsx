import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  User,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  GoogleAuthProvider,
  signOut as fbSignOut,
  onAuthStateChanged,
  deleteUser as fbDeleteUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  AuthProviderKind,
  ClassGrade,
  IndianBoard,
  PreferredLanguage,
  UserProfile,
  UserRole,
} from '../types/auth';
import { LearningProfile } from '../types/curriculum';
import {
  deleteAccountOnServer,
  fetchServerProfile,
  updateServerProfile,
} from '../api/client';
import {
  claimUsernameAtomicFirestore,
  deleteAllStudentFirestoreData,
  isUsernameAvailableFirestore,
} from '../lib/firestoreService';
import { DEFAULT_AVATAR_ID, normalizeUsername } from '../utils/usernameValidation';
import { mapFirebaseAuthError, normalizeEmailAddress } from '../utils/authValidation';

interface AuthContextType {
  user: UserProfile | null;
  firebaseUser: User | null;
  pendingVerificationEmail: string | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmailPassword: (params: {
    displayName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  signInWithEmailPassword: (params: {
    email: string;
    password: string;
  }) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshEmailVerificationStatus: () => Promise<boolean>;
  sendPasswordReset: (email: string) => Promise<void>;
  checkUsernameAvailability: (username: string) => Promise<{
    valid: boolean;
    available: boolean;
    normalized: string;
    error?: string;
  }>;
  updateProfileSettings: (updates: Partial<UserProfile>) => Promise<void>;
  completeOnboarding: (onboardingData: Partial<UserProfile> & { username: string }) => Promise<void>;
  deleteAccount: () => Promise<{ firebaseAuthDeleted: boolean }>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LEGACY_STORAGE_KEYS = [
  'eduverse_user_session',
  'eduverse_firebase_session_active',
];

function detectAuthProvider(fbUser: User): AuthProviderKind {
  const isGoogle = fbUser.providerData.some((p) => p.providerId === 'google.com');
  return isGoogle ? 'google' : 'password';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const hydrateVerifiedUserProfile = useCallback(async (fbUser: User) => {
    const userDocRef = doc(db, 'users', fbUser.uid);
    const detectedProvider = detectAuthProvider(fbUser);

    const [snapshot, serverProfile] = await Promise.all([
      getDoc(userDocRef).catch(() => null),
      fetchServerProfile().catch(() => null),
    ]);

    if (snapshot && snapshot.exists()) {
      const fsData = snapshot.data() as UserProfile;
      const resolvedRole: UserRole = serverProfile?.role || fsData.role || 'student';
      const rawProvider = fsData.authProvider || (serverProfile?.authProvider as string | undefined);
      const normalizedProvider: AuthProviderKind =
        rawProvider === 'google' || rawProvider === 'password'
          ? rawProvider
          : detectedProvider;

      const merged: UserProfile = {
        ...fsData,
        uid: fbUser.uid,
        email: fbUser.email || fsData.email || serverProfile?.email || '',
        emailVerified: Boolean(fbUser.emailVerified || fsData.emailVerified),
        authProvider: normalizedProvider,
        username: fsData.username || serverProfile?.username,
        avatarId: fsData.avatarId || serverProfile?.avatarId || DEFAULT_AVATAR_ID,
        photoURL: fbUser.photoURL || fsData.photoURL,
        role: resolvedRole,
        streakDays: (fsData.xpPoints || 0) === 0 ? 0 : (fsData.streakDays || 0),
      };

      if (merged.username && (!serverProfile?.username || !serverProfile?.onboardingCompleted)) {
        updateServerProfile({
          displayName: merged.displayName,
          username: merged.username,
          avatarId: merged.avatarId,
          board: merged.board,
          classGrade: merged.classGrade,
          state: merged.state,
          language: merged.language,
          onboardingCompleted: merged.onboardingCompleted,
        }).catch(() => {});
      }

      setUser(merged);
      setPendingVerificationEmail(null);
      return;
    }

    const isBootstrapAdmin =
      fbUser.emailVerified && fbUser.email?.toLowerCase() === 'a40332177@gmail.com';
    const initialRole: UserRole =
      serverProfile?.role || (isBootstrapAdmin ? 'admin' : 'student');
    const now = new Date().toISOString();

    const newProfile: UserProfile = {
      uid: fbUser.uid,
      email: fbUser.email || serverProfile?.email || '',
      emailVerified: Boolean(fbUser.emailVerified),
      authProvider: detectedProvider,
      displayName:
        fbUser.displayName?.trim() ||
        (serverProfile?.displayName && serverProfile.displayName !== 'Eduverse Student'
          ? serverProfile.displayName
          : '') ||
        fbUser.email?.split('@')[0] ||
        'Eduverse Student',
      avatarId: serverProfile?.avatarId || DEFAULT_AVATAR_ID,
      photoURL: fbUser.photoURL || undefined,
      role: initialRole,
      board: (serverProfile?.board || 'CBSE') as IndianBoard,
      classGrade: (serverProfile?.classGrade || 'Class 10') as ClassGrade,
      state: serverProfile?.state || 'Delhi (NCT)',
      language: (serverProfile?.language || 'English') as PreferredLanguage,
      subjects: [],
      learningGoals: [],
      onboardingCompleted: Boolean(serverProfile?.onboardingCompleted && serverProfile?.username),
      username: serverProfile?.username,
      streakDays: 0,
      xpPoints: 0,
      createdAt: now,
      updatedAt: now,
    };

    const docPayload = { ...newProfile } as Record<string, unknown>;
    for (const key of Object.keys(docPayload)) {
      if (docPayload[key] === undefined) {
        delete docPayload[key];
      }
    }

    try {
      await setDoc(userDocRef, docPayload);
    } catch (fsErr) {
      console.warn('[Auth] Initial Firestore profile creation deferred:', fsErr);
    }
    setUser(newProfile);
    setPendingVerificationEmail(null);
  }, []);

  useEffect(() => {
    for (const key of LEGACY_STORAGE_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore storage cleanup errors
      }
    }

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (!fbUser) {
        setUser(null);
        setPendingVerificationEmail(null);
        setLoading(false);
        return;
      }

      if (!fbUser.emailVerified) {
        setUser(null);
        setPendingVerificationEmail(fbUser.email || '');
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        await hydrateVerifiedUserProfile(fbUser);
      } catch (err) {
        console.error('[Auth] Failed resolving authenticated profile:', err);
        setError('Unable to load your personal profile cleanly. Please refresh or sign in again.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [hydrateVerifiedUserProfile]);

  const signInWithGoogle = async () => {
    try {
      setError(null);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      const message = mapFirebaseAuthError(err, 'Failed to sign in with Google.');
      setError(message);
      throw new Error(message);
    }
  };

  const signUpWithEmailPassword = async (params: {
    displayName: string;
    email: string;
    password: string;
  }) => {
    try {
      setError(null);
      const cleanEmail = normalizeEmailAddress(params.email);
      const cleanName = params.displayName.trim();
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
      if (cleanName) {
        await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
      }
      await sendEmailVerification(cred.user);
      setPendingVerificationEmail(cred.user.email || cleanEmail);
    } catch (err: unknown) {
      const message = mapFirebaseAuthError(err, 'Unable to create your account.');
      setError(message);
      throw new Error(message);
    }
  };

  const signInWithEmailPassword = async (params: {
    email: string;
    password: string;
  }) => {
    try {
      setError(null);
      const cleanEmail = normalizeEmailAddress(params.email);
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, params.password);
      if (!cred.user.emailVerified) {
        setPendingVerificationEmail(cred.user.email || cleanEmail);
      }
    } catch (err: unknown) {
      const message = mapFirebaseAuthError(err, 'Unable to sign in with email and password.');
      setError(message);
      throw new Error(message);
    }
  };

  const resendVerificationEmail = async () => {
    const current = auth.currentUser;
    if (!current) {
      throw new Error('Please sign in first to resend the verification email.');
    }
    try {
      setError(null);
      await sendEmailVerification(current);
    } catch (err: unknown) {
      const message = mapFirebaseAuthError(err, 'Unable to resend verification email right now.');
      setError(message);
      throw new Error(message);
    }
  };

  const refreshEmailVerificationStatus = async (): Promise<boolean> => {
    const current = auth.currentUser;
    if (!current) return false;
    try {
      setError(null);
      await current.reload();
      const refreshed = auth.currentUser;
      if (!refreshed || !refreshed.emailVerified) {
        return false;
      }
      await refreshed.getIdToken(true);
      setLoading(true);
      try {
        await hydrateVerifiedUserProfile(refreshed);
      } finally {
        setLoading(false);
      }
      return true;
    } catch (err: unknown) {
      const message = mapFirebaseAuthError(err, 'Unable to refresh verification status.');
      setError(message);
      throw new Error(message);
    }
  };

  const sendPasswordReset = async (email: string) => {
    try {
      setError(null);
      await sendPasswordResetEmail(auth, normalizeEmailAddress(email));
    } catch (err: unknown) {
      const message = mapFirebaseAuthError(err, 'Unable to send password reset email.');
      setError(message);
      throw new Error(message);
    }
  };

  const checkUsernameAvailability = async (username: string) => {
    return isUsernameAvailableFirestore(username, firebaseUser?.uid || user?.uid);
  };

  const updateProfileSettings = async (updates: Partial<UserProfile>) => {
    if (!firebaseUser || !user) {
      throw new Error('Authentication is required to update profile settings.');
    }

    const sanitizedUpdates = { ...updates } as Record<string, unknown>;
    delete sanitizedUpdates.role;
    delete sanitizedUpdates.uid;
    delete sanitizedUpdates.streakDays;
    delete sanitizedUpdates.xpPoints;
    for (const key of Object.keys(sanitizedUpdates)) {
      if (sanitizedUpdates[key] === undefined) {
        delete sanitizedUpdates[key];
      }
    }

    const nextUsername =
      typeof updates.username === 'string' && updates.username.trim()
        ? normalizeUsername(updates.username)
        : undefined;
    const prevUsername = user.username ? normalizeUsername(user.username) : undefined;

    if (nextUsername && nextUsername !== prevUsername) {
      await claimUsernameAtomicFirestore({
        uid: firebaseUser.uid,
        nextUsername,
        previousUsername: prevUsername,
        profileUpdates: sanitizedUpdates as Partial<UserProfile>,
      });
    } else {
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      try {
        await updateDoc(userDocRef, {
          ...sanitizedUpdates,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    }

    const serverUpdated = await updateServerProfile({
      displayName: updates.displayName,
      username: nextUsername,
      avatarId: updates.avatarId,
      board: updates.board,
      classGrade: updates.classGrade,
      state: updates.state,
      language: updates.language,
      onboardingCompleted: updates.onboardingCompleted,
    }).catch(() => null);

    setUser((prev) =>
      prev
        ? {
            ...prev,
            ...updates,
            username: nextUsername || prev.username,
            role: serverUpdated?.role || prev.role,
            updatedAt: new Date().toISOString(),
          }
        : prev
    );
  };

  const completeOnboarding = async (
    onboardingData: Partial<UserProfile> & { username: string }
  ) => {
    if (!firebaseUser || !user) {
      throw new Error('Authentication is required to complete onboarding.');
    }

    const normalizedHandle = normalizeUsername(onboardingData.username);
    const now = new Date().toISOString();

    const safeProfileUpdates: Partial<UserProfile> = {
      displayName: onboardingData.displayName?.trim() || user.displayName,
      avatarId: onboardingData.avatarId || user.avatarId || DEFAULT_AVATAR_ID,
      board: onboardingData.board || user.board || 'CBSE',
      classGrade: onboardingData.classGrade || user.classGrade || 'Class 10',
      state: onboardingData.state || user.state || 'Delhi (NCT)',
      language: onboardingData.language || user.language || 'English',
      subjects: onboardingData.subjects || [],
      learningGoals: onboardingData.learningGoals || [],
      onboardingCompleted: true,
    };

    await claimUsernameAtomicFirestore({
      uid: firebaseUser.uid,
      nextUsername: normalizedHandle,
      previousUsername: user.username,
      profileUpdates: {
        ...user,
        ...safeProfileUpdates,
        username: normalizedHandle,
        onboardingCompleted: true,
        updatedAt: now,
      },
    });

    await updateServerProfile({
      displayName: safeProfileUpdates.displayName,
      username: normalizedHandle,
      avatarId: safeProfileUpdates.avatarId,
      board: safeProfileUpdates.board,
      classGrade: safeProfileUpdates.classGrade,
      state: safeProfileUpdates.state,
      language: safeProfileUpdates.language,
      onboardingCompleted: true,
    });

    try {
      const learningProfileRef = doc(db, 'learning_profiles', firebaseUser.uid);
      const lpData: LearningProfile = {
        id: firebaseUser.uid,
        userId: firebaseUser.uid,
        preferredPace: 'steady',
        strengths: [],
        weaknesses: [],
        dailyGoalMinutes: 45,
        dailyQuestionsTarget: 10,
        lastActiveDate: now,
        updatedAt: now,
      };
      await setDoc(learningProfileRef, lpData, { merge: true });
    } catch (err) {
      console.warn('[Auth] Onboarding auxiliary setup warning:', err);
    }

    setUser((prev) =>
      prev
        ? {
            ...prev,
            ...safeProfileUpdates,
            username: normalizedHandle,
            onboardingCompleted: true,
            updatedAt: now,
          }
        : prev
    );
  };

  const deleteAccount = async () => {
    if (!firebaseUser || !user) {
      throw new Error('You must be signed in to delete your account.');
    }

    await deleteAllStudentFirestoreData(firebaseUser.uid, user.username);
    await deleteAccountOnServer();

    let firebaseAuthDeleted = false;
    try {
      await fbDeleteUser(firebaseUser);
      firebaseAuthDeleted = true;
    } catch {
      firebaseAuthDeleted = false;
    }

    try {
      await fbSignOut(auth);
    } catch {
      // User already deleted on Firebase Auth
    }

    setUser(null);
    setFirebaseUser(null);
    setPendingVerificationEmail(null);
    return { firebaseAuthDeleted };
  };

  const signOut = async () => {
    try {
      await fbSignOut(auth);
      setUser(null);
      setFirebaseUser(null);
      setPendingVerificationEmail(null);
    } catch (err: unknown) {
      console.error('Sign out error:', err);
      setError(mapFirebaseAuthError(err, 'Error signing out'));
    }
  };

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        pendingVerificationEmail,
        loading,
        error,
        signInWithGoogle,
        signUpWithEmailPassword,
        signInWithEmailPassword,
        resendVerificationEmail,
        refreshEmailVerificationStatus,
        sendPasswordReset,
        checkUsernameAvailability,
        updateProfileSettings,
        completeOnboarding,
        deleteAccount,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
