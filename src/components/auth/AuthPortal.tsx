import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Lock,
  LogOut,
  Mail,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  validateEmailPasswordLoginInput,
  validateEmailPasswordSignupInput,
  isValidEmailFormat,
} from '../../utils/authValidation';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { Input } from '../common/Input';
import { FEATURE_FLAGS } from '../../config/featureFlags';

export type AuthPortalMode = 'login' | 'signup' | 'recovery';

interface AuthPortalProps {
  initialMode?: AuthPortalMode;
}

export const AuthPortal: React.FC<AuthPortalProps> = ({ initialMode = 'login' }) => {
  const {
    pendingVerificationEmail,
    signInWithGoogle,
    signUpWithEmailPassword,
    signInWithEmailPassword,
    resendVerificationEmail,
    refreshEmailVerificationStatus,
    sendPasswordReset,
    signOut,
    error: authError,
    clearError,
  } = useAuth();

  const [mode, setMode] = useState<AuthPortalMode>(initialMode);
  const [emailPanelOpen, setEmailPanelOpen] = useState(true);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
    if (initialMode === 'signup' || initialMode === 'recovery') {
      setEmailPanelOpen(true);
    }
  }, [initialMode]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  const activeError = localError || authError;

  const switchMode = (nextMode: AuthPortalMode) => {
    clearError();
    setLocalError(null);
    setStatusMessage(null);
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setEmailPanelOpen(true);
  };

  const handleGoogleAuth = async () => {
    clearError();
    setLocalError(null);
    setStatusMessage(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch {
      // Handled in AuthContext
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);
    setStatusMessage(null);

    if (mode === 'login') {
      const check = validateEmailPasswordLoginInput({ email, password });
      if (!check.valid) {
        setLocalError(check.error || 'Please check your email and password.');
        return;
      }
      setSubmitting(true);
      try {
        await signInWithEmailPassword({ email, password });
      } catch (err: unknown) {
        setLocalError(err instanceof Error ? err.message : 'Unable to sign in.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (mode === 'signup') {
      const check = validateEmailPasswordSignupInput({
        displayName,
        email,
        password,
        confirmPassword,
      });
      if (!check.valid) {
        setLocalError(check.error || 'Please check your registration details.');
        return;
      }
      setSubmitting(true);
      try {
        await signUpWithEmailPassword({
          displayName: displayName.trim(),
          email,
          password,
        });
        setCooldownSeconds(60);
      } catch (err: unknown) {
        setLocalError(err instanceof Error ? err.message : 'Unable to create account.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Recovery / Password Reset
    if (!isValidEmailFormat(email)) {
      setLocalError('Please enter a valid registered email address.');
      return;
    }
    setSubmitting(true);
    try {
      await sendPasswordReset(email);
      setStatusMessage(
        `Firebase sent a password reset link to ${email.trim().toLowerCase()}. Open the link in your inbox to set a new password, then return here to log in.`
      );
    } catch (err: unknown) {
      setLocalError(
        err instanceof Error ? err.message : 'Unable to send password reset email.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckVerification = async () => {
    clearError();
    setLocalError(null);
    setStatusMessage(null);
    setSubmitting(true);
    try {
      const verified = await refreshEmailVerificationStatus();
      if (!verified) {
        setLocalError(
          'Your email is not verified yet. Please click the verification link sent by Firebase to your inbox, then tap "Check Verification Status" again.'
        );
      }
    } catch (err: unknown) {
      setLocalError(
        err instanceof Error ? err.message : 'Could not verify status right now.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    clearError();
    setLocalError(null);
    setStatusMessage(null);
    setSubmitting(true);
    try {
      await resendVerificationEmail();
      setCooldownSeconds(60);
      setStatusMessage(
        `A fresh Firebase verification link has been sent to ${pendingVerificationEmail}. Please check your inbox and spam folder.`
      );
    } catch (err: unknown) {
      setLocalError(
        err instanceof Error ? err.message : 'Unable to resend verification link.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const modeMeta = {
    login: {
      heading: 'Welcome Back to EDUVERSE AI',
      subtitle: 'Sign in with Google or your email and password to continue your study plan.',
      emailCta: 'Sign In with Email',
    },
    signup: {
      heading: 'Create Your Personal Student Account',
      subtitle:
        'Register with Google or email & password. Firebase will send an email verification link to activate your account.',
      emailCta: 'Create Account & Verify Email',
    },
    recovery: {
      heading: 'Reset Your Password',
      subtitle:
        'Enter your registered email address and Firebase will send a secure password reset link.',
      emailCta: 'Send Password Reset Email',
    },
  }[mode];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between relative overflow-x-hidden selection:bg-indigo-500 selection:text-white">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[780px] h-[420px] bg-gradient-to-tr from-indigo-600/15 via-blue-600/10 to-purple-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Top Brand Header */}
      <header className="relative z-10 w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-lg tracking-tight text-white">EDUVERSE</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  AI
                </span>
              </div>
              <p className="hidden sm:block text-[10px] text-slate-400 uppercase tracking-wider font-medium">
                CBSE • ICSE • State Boards • Class 6 to 12
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="hidden sm:inline">Firebase Verified Accounts Only</span>
          </div>
        </div>
      </header>

      {/* Main Split Auth Portal */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-6 sm:py-12">
        <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* Left Column: EDUVERSE AI Academic Overview */}
          <div className="lg:col-span-6 order-2 lg:order-1 space-y-6 text-left">
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-400">
                Indian School Learning Ecosystem
              </p>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
                Your Personal AI Classroom Across{' '}
                <span className="bg-gradient-to-r from-indigo-400 via-cyan-300 to-purple-400 bg-clip-text text-transparent">
                  Class 6 to 12.
                </span>
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed max-w-xl">
                Every student gets a private, verified workspace synchronized across devices—storing
                syllabus progress, adaptive practice, mind maps, voice sessions, and mock board results.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="p-4 rounded-2xl bg-slate-900/75 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <BookOpen className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>NCERT &amp; Board Grounded</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Tailored to CBSE, ICSE, CISCE, and State Boards in English, Hindi, or Hinglish.
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/75 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>
                    {FEATURE_FLAGS.visualLearningEnabled
                      ? '11 Integrated Study Engines'
                      : '10 Active Study Engines'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {FEATURE_FLAGS.visualLearningEnabled
                    ? 'Socratic Teacher, Doubt Solver, Visual STEM Lab, Exam Simulator & Voice Classroom.'
                    : 'Socratic Teacher, Doubt Solver, Adaptive Practice, Exam Simulator & Voice Classroom.'}
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/75 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Strict Account Isolation</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Zero demo placeholders. All analytics and study pods belong strictly to your verified UID.
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/75 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <KeyRound className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>Unique Student Handle</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Claim a unique @username during onboarding to collaborate safely in private study pods.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Authentication or Email Verification Pending Card */}
          <div className="lg:col-span-6 order-1 lg:order-2 w-full max-w-md mx-auto lg:max-w-none">
            {pendingVerificationEmail !== null ? (
              <Card className="p-6 sm:p-8 bg-slate-900/95 border border-slate-800 shadow-2xl space-y-5">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
                    <MailCheck className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-xl font-extrabold text-white">
                      Verify Your Email Address
                    </h2>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      We sent a Firebase verification link to{' '}
                      <strong className="text-white">{pendingVerificationEmail}</strong>. Open the
                      link in your inbox to unlock onboarding and your personal study dashboard.
                    </p>
                  </div>
                </div>

                {activeError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{activeError}</span>
                  </div>
                )}

                {statusMessage && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{statusMessage}</span>
                  </div>
                )}

                <div className="space-y-3 pt-1">
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="w-full"
                    loading={submitting}
                    onClick={handleCheckVerification}
                    icon={<CheckCircle2 className="w-4 h-4" />}
                  >
                    I Have Verified My Email — Continue
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    className="w-full"
                    disabled={cooldownSeconds > 0 || submitting}
                    onClick={handleResendVerification}
                    icon={<RefreshCw className="w-4 h-4" />}
                  >
                    {cooldownSeconds > 0
                      ? `Resend Verification Link (${cooldownSeconds}s)`
                      : 'Resend Verification Link'}
                  </Button>
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                  <span>Wrong email address?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLocalError(null);
                      setStatusMessage(null);
                      signOut();
                    }}
                    className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Use Another Account
                  </button>
                </div>
              </Card>
            ) : (
              <Card className="p-6 sm:p-8 bg-slate-900/95 border border-slate-800 shadow-2xl space-y-5">
                {/* Mode Switcher Tabs */}
                <div
                  className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800"
                  role="tablist"
                  aria-label="Authentication mode"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'login'}
                    onClick={() => switchMode('login')}
                    className={`py-2 px-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                      mode === 'login'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'signup'}
                    onClick={() => switchMode('signup')}
                    className={`py-2 px-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                      mode === 'signup'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Sign Up
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'recovery'}
                    aria-label="Reset Password"
                    onClick={() => switchMode('recovery')}
                    className={`py-2 px-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                      mode === 'recovery'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Reset
                  </button>
                </div>

                <div className="space-y-1">
                  <h2 className="text-xl font-extrabold text-white">{modeMeta.heading}</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">{modeMeta.subtitle}</p>
                </div>

                {activeError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{activeError}</span>
                  </div>
                )}

                {statusMessage && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{statusMessage}</span>
                  </div>
                )}

                {/* Primary Google OAuth Button */}
                {mode !== 'recovery' && (
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="w-full"
                    loading={googleLoading}
                    onClick={handleGoogleAuth}
                    icon={
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="#ffffff"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#e2e8f0"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#cbd5e1"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        />
                        <path
                          fill="#f8fafc"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        />
                      </svg>
                    }
                  >
                    Continue with Google
                  </Button>
                )}

                {mode !== 'recovery' && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-800" />
                    </div>
                    <div className="relative flex justify-center text-[11px] uppercase">
                      <span className="bg-slate-900 px-3 text-slate-500 font-semibold tracking-wider">
                        Or Continue with Email
                      </span>
                    </div>
                  </div>
                )}

                {emailPanelOpen && (
                  <form onSubmit={handleEmailAuthSubmit} className="space-y-3.5">
                    {mode === 'signup' && (
                      <Input
                        label="Full Name"
                        placeholder="e.g. Rohan Verma"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        icon={<UserPlus className="w-4 h-4" />}
                        required
                      />
                    )}

                    <Input
                      label="Email Address"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      icon={<Mail className="w-4 h-4" />}
                      required
                    />

                    {mode !== 'recovery' && (
                      <div className="space-y-1">
                        <div className="relative">
                          <Input
                            label="Password"
                            type={showPassword ? 'text' : 'password'}
                            placeholder={
                              mode === 'signup'
                                ? 'Min 8 chars (letters & numbers)'
                                : 'Enter your password'
                            }
                            className="pr-10"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            icon={<Lock className="w-4 h-4" />}
                            required
                          />
                          <button
                            type="button"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            onClick={() => setShowPassword((prev) => !prev)}
                            className="absolute right-3 top-[34px] text-slate-400 hover:text-slate-200 cursor-pointer"
                          >
                            {showPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>

                        {mode === 'login' && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => switchMode('recovery')}
                              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                            >
                              Forgot password?
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {mode === 'signup' && (
                      <Input
                        label="Confirm Password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        icon={<Lock className="w-4 h-4" />}
                        required
                      />
                    )}

                    <Button
                      type="submit"
                      variant={mode === 'recovery' ? 'primary' : 'secondary'}
                      size="lg"
                      className="w-full"
                      loading={submitting}
                      icon={<ArrowRight className="w-4 h-4" />}
                    >
                      {modeMeta.emailCta}
                    </Button>
                  </form>
                )}

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    {mode === 'login' ? (
                      <>
                        New student?{' '}
                        <button
                          type="button"
                          onClick={() => switchMode('signup')}
                          className="text-indigo-400 hover:underline font-semibold cursor-pointer"
                        >
                          Create an account
                        </button>
                      </>
                    ) : (
                      <>
                        Already registered?{' '}
                        <button
                          type="button"
                          onClick={() => switchMode('login')}
                          className="text-indigo-400 hover:underline font-semibold cursor-pointer"
                        >
                          Sign in instead
                        </button>
                      </>
                    )}
                  </span>

                  {mode !== 'recovery' && (
                    <button
                      type="button"
                      onClick={() => switchMode('recovery')}
                      className="text-slate-400 hover:text-slate-200 underline cursor-pointer"
                    >
                      Reset password
                    </button>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-slate-800/70 py-4 px-4 sm:px-6 lg:px-8 text-center text-[11px] text-slate-500">
        EDUVERSE AI • Personalized Indian School Curriculum Intelligence • Class 6–12
      </footer>
    </div>
  );
};
