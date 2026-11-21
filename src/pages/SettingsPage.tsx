import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AtSign,
  BookOpen,
  Check,
  CheckCircle2,
  Database,
  Loader2,
  LogOut,
  Moon,
  Save,
  Sun,
  Target,
  Trash2,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Input } from '../components/common/Input';
import { Select } from '../components/common/Select';
import { Badge } from '../components/common/Badge';
import {
  AVAILABLE_SUBJECTS_BY_GRADE,
  CLASS_GRADES,
  INDIAN_BOARDS,
  INDIAN_STATES,
  POPULAR_LEARNING_GOALS,
} from '../utils/curriculum';
import {
  DEFAULT_AVATAR_ID,
  normalizeUsername,
  STUDENT_AVATAR_PRESETS,
  validateUsernameFormat,
} from '../utils/usernameValidation';
import { ClassGrade, IndianBoard, PreferredLanguage } from '../types/auth';

export const SettingsPage: React.FC = () => {
  const { user, updateProfileSettings, checkUsernameAvailability, deleteAccount, signOut } =
    useAuth();
  const { theme, setTheme } = useTheme();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [usernameInput, setUsernameInput] = useState(user?.username || '');
  const [avatarId, setAvatarId] = useState(user?.avatarId || DEFAULT_AVATAR_ID);
  const [board, setBoard] = useState<IndianBoard>(user?.board || 'CBSE');
  const [classGrade, setClassGrade] = useState<ClassGrade>(user?.classGrade || 'Class 10');
  const [state, setState] = useState(user?.state || 'Delhi (NCT)');
  const [language, setLanguage] = useState<PreferredLanguage>(
    user?.language === 'Bilingual' ? 'Hinglish' : user?.language || 'English'
  );
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(user?.subjects || []);
  const [selectedGoals, setSelectedGoals] = useState<string[]>(user?.learningGoals || []);

  const [usernameStatus, setUsernameStatus] = useState<{
    state: 'idle' | 'unchanged' | 'checking' | 'available' | 'invalid' | 'taken';
    message?: string;
  }>({ state: 'unchanged' });

  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deletePanelOpen, setDeletePanelOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName || '');
    setUsernameInput(user.username || '');
    setAvatarId(user.avatarId || DEFAULT_AVATAR_ID);
    setBoard(user.board || 'CBSE');
    setClassGrade(user.classGrade || 'Class 10');
    setState(user.state || 'Delhi (NCT)');
    setLanguage(user.language === 'Bilingual' ? 'Hinglish' : user.language || 'English');
    setSelectedSubjects(user.subjects || []);
    setSelectedGoals(user.learningGoals || []);
    setUsernameStatus({ state: 'unchanged' });
  }, [user]);

  useEffect(() => {
    const cleanCurrent = user?.username ? normalizeUsername(user.username) : '';
    const cleanNext = normalizeUsername(usernameInput);

    if (!cleanNext) {
      setUsernameStatus({ state: 'invalid', message: 'Username cannot be empty.' });
      return;
    }

    if (cleanNext === cleanCurrent) {
      setUsernameStatus({ state: 'unchanged' });
      return;
    }

    const format = validateUsernameFormat(cleanNext);
    if (!format.valid) {
      setUsernameStatus({ state: 'invalid', message: format.error });
      return;
    }

    let cancelled = false;
    setUsernameStatus({ state: 'checking', message: `Checking @${format.normalized}...` });
    const timer = window.setTimeout(async () => {
      try {
        const res = await checkUsernameAvailability(format.normalized);
        if (cancelled) return;
        if (!res.valid) {
          setUsernameStatus({ state: 'invalid', message: res.error });
        } else if (!res.available) {
          setUsernameStatus({
            state: 'taken',
            message: res.error || `@${res.normalized} is already taken.`,
          });
        } else {
          setUsernameStatus({
            state: 'available',
            message: `@${res.normalized} is available.`,
          });
        }
      } catch {
        if (!cancelled) {
          setUsernameStatus({
            state: 'invalid',
            message: 'Could not verify username availability.',
          });
        }
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [usernameInput, user?.username, checkUsernameAvailability]);

  const toggleSubject = (sub: string) => {
    setSelectedSubjects((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub]
    );
  };

  const toggleGoal = (goal: string) => {
    setSelectedGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setIsSaved(false);

    if (!displayName.trim()) {
      setSaveError('Display name is required.');
      return;
    }

    const cleanNext = normalizeUsername(usernameInput);
    const format = validateUsernameFormat(cleanNext);
    if (!format.valid) {
      setSaveError(format.error || 'Please choose a valid unique username.');
      return;
    }
    if (usernameStatus.state === 'taken' || usernameStatus.state === 'invalid') {
      setSaveError(usernameStatus.message || 'Please choose an available username.');
      return;
    }

    setSaving(true);
    try {
      await updateProfileSettings({
        displayName: displayName.trim(),
        username: format.normalized,
        avatarId,
        board,
        classGrade,
        state,
        language,
        subjects: selectedSubjects,
        learningGoals: selectedGoals,
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save profile settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setDeleteError('Type DELETE in all caps to confirm permanent account removal.');
      return;
    }
    setDeleteError(null);
    setDeletingAccount(true);
    try {
      await deleteAccount();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account cleanly.');
      setDeletingAccount(false);
    }
  };

  const authProviderLabel =
    user?.authProvider === 'password'
      ? 'Email & Password (Firebase Auth)'
      : 'Google OAuth (Firebase Auth)';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="purple" size="sm">
              ACCOUNT &amp; PREFERENCES
            </Badge>
            {user?.emailVerified && (
              <Badge variant="success" size="sm">
                Verified Account
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
            Student Profile &amp; Account Settings
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage your unique @username, avatar, board, class grade, preferred medium, theme, and
            account lifecycle.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => signOut()}
          icon={<LogOut className="w-3.5 h-3.5" />}
        >
          Sign Out
        </Button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {saveError && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        {/* Personal Identity Card */}
        <Card className="space-y-5">
          <h2 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
            <User className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Personal Identity &amp; Academic Profile
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
            <Input
              label="Verified Email"
              value={user?.email || ''}
              disabled
              hint="Locked to your authenticated sign-in identity"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
              Unique Username Handle
            </label>
            <div className="relative">
              <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={usernameInput}
                onChange={(e) =>
                  setUsernameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                }
                maxLength={24}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {usernameStatus.state === 'checking' && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                {usernameStatus.message}
              </p>
            )}
            {usernameStatus.state === 'available' && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                {usernameStatus.message}
              </p>
            )}
            {(usernameStatus.state === 'invalid' || usernameStatus.state === 'taken') && (
              <p className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {usernameStatus.message}
              </p>
            )}
            {usernameStatus.state === 'unchanged' && user?.username && (
              <p className="text-[11px] text-slate-500">
                Active handle:{' '}
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                  @{user.username}
                </span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
              Profile Avatar Badge
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
              {STUDENT_AVATAR_PRESETS.map((preset) => {
                const selected = avatarId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setAvatarId(preset.id)}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                      selected
                        ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 ring-1 ring-indigo-500'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full bg-gradient-to-tr ${preset.gradient} flex items-center justify-center text-xs font-extrabold text-white`}
                    >
                      {(displayName.trim() || 'S').charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[10px] font-medium text-slate-700 dark:text-slate-300 truncate max-w-full">
                      {preset.label.split(' ')[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select
              label="Educational Board"
              value={board}
              onChange={(e) => setBoard(e.target.value as IndianBoard)}
              options={INDIAN_BOARDS.map((b) => ({ value: b.id, label: b.label }))}
            />
            <Select
              label="Class / Grade"
              value={classGrade}
              onChange={(e) => setClassGrade(e.target.value as ClassGrade)}
              options={CLASS_GRADES.map((g) => ({ value: g, label: g }))}
            />
            <Select
              label="Home State / UT"
              value={state}
              onChange={(e) => setState(e.target.value)}
              options={INDIAN_STATES.map((st) => ({ value: st, label: st }))}
            />
          </div>

          <Select
            label="Preferred Study Medium"
            value={language}
            onChange={(e) => setLanguage(e.target.value as PreferredLanguage)}
            options={[
              { value: 'English', label: 'English Medium' },
              { value: 'Hindi', label: 'हिन्दी माध्यम (Hindi Medium)' },
              { value: 'Hinglish', label: 'Hinglish (Conversational Bilingual Mix)' },
            ]}
          />
        </Card>

        {/* Subjects Enrolled */}
        <Card className="space-y-4">
          <h2 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
            <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Enrolled Subjects for {classGrade}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {(AVAILABLE_SUBJECTS_BY_GRADE[classGrade] || []).map((sub) => {
              const isChecked = selectedSubjects.includes(sub);
              return (
                <button
                  key={sub}
                  type="button"
                  onClick={() => toggleSubject(sub)}
                  className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                    isChecked
                      ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-slate-900 dark:text-white'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">
                    {sub}
                  </span>
                  <div
                    className={`w-4 h-4 rounded-md flex items-center justify-center border text-[10px] font-bold ${
                      isChecked
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-transparent'
                    }`}
                  >
                    ✓
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Goals */}
        <Card className="space-y-4">
          <h2 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
            <Target className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Exam Preparation Priorities
          </h2>

          <div className="space-y-2">
            {POPULAR_LEARNING_GOALS.map((goal) => {
              const isChecked = selectedGoals.includes(goal);
              return (
                <button
                  key={goal}
                  type="button"
                  onClick={() => toggleGoal(goal)}
                  className={`w-full p-3 rounded-xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer ${
                    isChecked
                      ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-slate-900 dark:text-white'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                    {goal}
                  </span>
                  <div
                    className={`w-4 h-4 rounded-md flex items-center justify-center border text-[10px] font-bold shrink-0 ${
                      isChecked
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-transparent'
                    }`}
                  >
                    ✓
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Theme & Display */}
        <Card className="space-y-4">
          <h2 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
            <Sun className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Appearance &amp; Visual Theme
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`p-4 rounded-2xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                theme === 'dark'
                  ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-slate-900 dark:text-white'
                  : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-indigo-600 dark:text-indigo-400">
                <Moon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">
                  Deep Navy &amp; Indigo
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Focused dark study theme (Default)
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`p-4 rounded-2xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                theme === 'light'
                  ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-slate-900 dark:text-white'
                  : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-amber-500 dark:text-amber-400">
                <Sun className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">Light Mode</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  High-contrast daytime reading
                </p>
              </div>
            </button>
          </div>
        </Card>

        {/* Security & Identity Summary */}
        <Card className="space-y-3">
          <h2 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
            <Database className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Account Identity &amp; Isolation
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 block text-[10px] font-bold uppercase">
                Auth Provider
              </span>
              <span className="text-slate-900 dark:text-white font-medium">
                {authProviderLabel}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 block text-[10px] font-bold uppercase">
                Account Role
              </span>
              <span className="text-indigo-600 dark:text-indigo-400 font-bold capitalize">
                {user?.role || 'student'}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 block text-[10px] font-bold uppercase">
                Data Ownership
              </span>
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                Strict UID Isolation
              </span>
            </div>
          </div>
        </Card>

        {/* Save Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          {isSaved ? (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
              <Check className="w-4 h-4" /> Settings updated successfully
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              Changes sync immediately across your personal profile and saved exam schedules.
            </span>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={saving}
            icon={<Save className="w-4 h-4" />}
          >
            Save Changes
          </Button>
        </div>
      </form>

      {/* Permanent Account Deletion Zone */}
      <Card className="border-rose-200 dark:border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/10 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <Trash2 className="w-4 h-4" />
              Delete Account &amp; Personal Data
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Permanently remove your profile, unique @username reservation, saved exam datesheets,
              and sign-in record. This action cannot be undone.
            </p>
          </div>
          {!deletePanelOpen && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="whitespace-nowrap shrink-0"
              onClick={() => setDeletePanelOpen(true)}
            >
              Delete Account
            </Button>
          )}
        </div>

        {deletePanelOpen && (
          <div className="pt-3 border-t border-rose-200 dark:border-rose-500/20 space-y-3">
            {deleteError && (
              <div className="p-2.5 rounded-xl bg-rose-100 dark:bg-rose-500/15 border border-rose-300 dark:border-rose-500/30 text-xs text-rose-800 dark:text-rose-200">
                {deleteError}
              </div>
            )}
            <Input
              label="Type DELETE to confirm permanent account deletion"
              placeholder="DELETE"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeletePanelOpen(false);
                  setDeleteConfirmText('');
                  setDeleteError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                loading={deletingAccount}
                onClick={handleDeleteAccount}
                icon={<Trash2 className="w-3.5 h-3.5" />}
              >
                Permanently Delete My Account
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
