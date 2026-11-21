import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Compass,
  Eye,
  EyeOff,
  FileText,
  Lock,
  LogOut,
  Mail,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  isValidEmailFormat,
  validateEmailPasswordLoginInput,
  validateEmailPasswordSignupInput,
} from '../../utils/authValidation';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { Input } from '../common/Input';

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

    if (!isValidEmailFormat(email)) {
      setLocalError('Please enter a valid registered email address.');
      return;
    }
    setSubmitting(true);
    try {
      await sendPasswordReset(email);
      setStatusMessage(
        `Firebase sent a password reset link to ${email.trim().toLowerCase()}. Open the link in your inbox to set a new password, then return here to sign in.`
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
      heading: 'Sign In to EDUVERSE AI',
      subtitle:
        'Access your verified exam datesheets, countdowns, and preparation workspace across devices.',
      emailCta: 'Sign In with Email',
    },
    signup: {
      heading: 'Create Student Account',
      subtitle:
        'Register with Google or email and password. Firebase sends a verification link to activate your account.',
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between relative overflow-x-hidden selection:bg-indigo-600 selection:text-white">
      <header className="relative z-10 w-full border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-slate-950/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-sm shadow-indigo-600/20 shrink-0">
              <CalendarDays className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-lg tracking-tight text-slate-900 dark:text-white">
                  EDUVERSE
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30">
                  AI
                </span>
              </div>
              <p className="hidden sm:block text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                Exam Preparation &amp; Practice Platform
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="hidden sm:inline">Firebase Verified Student Accounts</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* Left Column: Honest Platform Overview */}
          <div className="lg:col-span-6 order-2 lg:order-1 space-y-6 text-left">
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                Class 6–12 • CBSE • ICSE • CISCE • State Boards
              </p>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
                Organize Your Exam Schedule. Prepare With Clarity.
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                EDUVERSE AI is a focused exam preparation workspace built around your real exam
                datesheet. Upload official PDF or image schedules, verify every paper, track live
                countdowns, and follow upcoming practice modules as they launch.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900/80 border border-indigo-200 dark:border-indigo-500/30 space-y-1.5 shadow-xs dark:shadow-none">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                    <CalendarDays className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>Datesheet Analyzer</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Active
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Upload PDF or photo datesheets, check weekday mismatches &amp; clashes, confirm
                  your timeline, and inspect prep gaps.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-1.5 shadow-xs dark:shadow-none">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Private UID Sync</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Verified
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Zero sample progress or demo accounts. Every saved schedule is bound strictly to
                  your authenticated student UID.
                </p>
              </div>

              <div className="sm:col-span-2 p-4 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs dark:shadow-none">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Upcoming 5-Module Exam Suite
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Modules 2–5 Coming Soon
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">Study Planner</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">Sample Papers</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">Exam Mode</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">Advisor</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Auth Form */}
          <div className="lg:col-span-6 order-1 lg:order-2 w-full max-w-md mx-auto lg:max-w-none">
            {pendingVerificationEmail !== null ? (
              <Card className="p-6 sm:p-8 shadow-xl space-y-5">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-center shrink-0">
                    <MailCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                      Verify Your Email Address
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      We sent a Firebase verification link to{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {pendingVerificationEmail}
                      </strong>
                      . Open the link in your inbox to unlock onboarding and your exam dashboard.
                    </p>
                  </div>
                </div>

                {activeError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{activeError}</span>
                  </div>
                )}

                {statusMessage && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
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

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Wrong email address?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLocalError(null);
                      setStatusMessage(null);
                      signOut();
                    }}
                    className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Use Another Account
                  </button>
                </div>
              </Card>
            ) : (
              <Card className="p-6 sm:p-8 shadow-xl space-y-5">
                <div
                  className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
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
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Reset
                  </button>
                </div>

                <div className="space-y-1">
                  <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                    {modeMeta.heading}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {modeMeta.subtitle}
                  </p>
                </div>

                {activeError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{activeError}</span>
                  </div>
                )}

                {statusMessage && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{statusMessage}</span>
                  </div>
                )}

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
                      <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                    </div>
                    <div className="relative flex justify-center text-[11px] uppercase">
                      <span className="bg-white dark:bg-slate-900 px-3 text-slate-400 dark:text-slate-500 font-semibold tracking-wider">
                        Or Continue with Email
                      </span>
                    </div>
                  </div>
                )}

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
                          className="absolute right-3 top-[34px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
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
                            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-medium cursor-pointer"
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

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>
                    {mode === 'login' ? (
                      <>
                        New student?{' '}
                        <button
                          type="button"
                          onClick={() => switchMode('signup')}
                          className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
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
                          className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
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
                      className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 underline cursor-pointer"
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

      <footer className="relative z-10 border-t border-slate-200 dark:border-slate-800/70 py-4 px-4 sm:px-6 lg:px-8 text-center text-[11px] text-slate-500">
        EDUVERSE AI • Exam Preparation &amp; Practice Platform • Class 6–12
      </footer>
    </div>
  );
};
