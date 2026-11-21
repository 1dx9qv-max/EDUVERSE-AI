import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  AtSign,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Globe,
  GraduationCap,
  Languages,
  Loader2,
  MapPin,
  Target,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  AVAILABLE_SUBJECTS_BY_GRADE,
  CLASS_GRADES,
  INDIAN_BOARDS,
  INDIAN_STATES,
  POPULAR_LEARNING_GOALS,
} from '../../utils/curriculum';
import {
  DEFAULT_AVATAR_ID,
  normalizeUsername,
  STUDENT_AVATAR_PRESETS,
  validateUsernameFormat,
} from '../../utils/usernameValidation';
import { ClassGrade, IndianBoard, PreferredLanguage } from '../../types/auth';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';

export const OnboardingWizard: React.FC = () => {
  const { user, completeOnboarding, checkUsernameAvailability } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [usernameInput, setUsernameInput] = useState(user?.username || '');
  const [avatarId, setAvatarId] = useState(user?.avatarId || DEFAULT_AVATAR_ID);
  const [usernameStatus, setUsernameStatus] = useState<{
    state: 'idle' | 'checking' | 'available' | 'invalid' | 'taken';
    message?: string;
    normalized?: string;
  }>({ state: 'idle' });

  const [board, setBoard] = useState<IndianBoard>(user?.board || 'CBSE');
  const [state, setState] = useState(user?.state || 'Delhi (NCT)');
  const [classGrade, setClassGrade] = useState<ClassGrade>(user?.classGrade || 'Class 10');
  const [language, setLanguage] = useState<PreferredLanguage>(
    user?.language === 'Bilingual' ? 'Hinglish' : user?.language || 'English'
  );
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(() =>
    user?.subjects && user.subjects.length > 0
      ? user.subjects
      : (AVAILABLE_SUBJECTS_BY_GRADE[user?.classGrade || 'Class 10'] || []).slice(0, 4)
  );
  const [selectedGoals, setSelectedGoals] = useState<string[]>(() =>
    user?.learningGoals && user.learningGoals.length > 0
      ? user.learningGoals
      : [POPULAR_LEARNING_GOALS[0], POPULAR_LEARNING_GOALS[1]]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = usernameInput.trim();
    if (!raw) {
      setUsernameStatus({ state: 'idle' });
      return;
    }

    const format = validateUsernameFormat(raw);
    if (!format.valid) {
      setUsernameStatus({
        state: 'invalid',
        message: format.error,
        normalized: format.normalized,
      });
      return;
    }

    let cancelled = false;
    setUsernameStatus({
      state: 'checking',
      message: `Checking availability for @${format.normalized}...`,
      normalized: format.normalized,
    });

    const timer = window.setTimeout(async () => {
      try {
        const res = await checkUsernameAvailability(format.normalized);
        if (cancelled) return;
        if (!res.valid) {
          setUsernameStatus({ state: 'invalid', message: res.error, normalized: res.normalized });
        } else if (!res.available) {
          setUsernameStatus({
            state: 'taken',
            message: res.error || `@${res.normalized} is already taken.`,
            normalized: res.normalized,
          });
        } else {
          setUsernameStatus({
            state: 'available',
            message: `@${res.normalized} is available and ready to claim.`,
            normalized: res.normalized,
          });
        }
      } catch {
        if (!cancelled) {
          setUsernameStatus({
            state: 'invalid',
            message: 'Unable to check username availability right now. Please retry.',
          });
        }
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [usernameInput, checkUsernameAvailability]);

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

  const handleGradeChange = (grade: ClassGrade) => {
    setClassGrade(grade);
    const available = AVAILABLE_SUBJECTS_BY_GRADE[grade] || [];
    setSelectedSubjects(available.slice(0, 4));
  };

  const handleNext = async () => {
    setError(null);
    if (step === 1) {
      if (!displayName.trim()) {
        setError('Please enter your display name.');
        return;
      }
      const format = validateUsernameFormat(usernameInput);
      if (!format.valid) {
        setError(format.error || 'Please choose a valid unique username.');
        return;
      }
      if (usernameStatus.state === 'taken' || usernameStatus.state === 'invalid') {
        setError(usernameStatus.message || 'Please choose an available username.');
        return;
      }
      if (usernameStatus.state !== 'available') {
        const check = await checkUsernameAvailability(format.normalized);
        if (!check.valid || !check.available) {
          setError(check.error || 'That username is already taken.');
          return;
        }
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      if (selectedSubjects.length === 0) {
        setError('Please select at least one subject to personalize your exam workspace.');
        return;
      }
      setStep(4);
    }
  };

  const handleBack = () => {
    setError(null);
    if (step > 1) {
      setStep((step - 1) as 1 | 2 | 3 | 4);
    }
  };

  const handleSubmit = async () => {
    if (selectedGoals.length === 0) {
      setError('Please choose at least one exam preparation goal.');
      return;
    }
    const cleanUsername = normalizeUsername(usernameInput);
    const format = validateUsernameFormat(cleanUsername);
    if (!format.valid) {
      setError(format.error || 'Invalid username.');
      setStep(1);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await completeOnboarding({
        displayName: displayName.trim(),
        username: format.normalized,
        avatarId,
        board,
        state,
        classGrade,
        language,
        subjects: selectedSubjects,
        learningGoals: selectedGoals,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving onboarding profile');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-6 sm:py-10 px-4">
      <div className="text-center space-y-3 mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          <CalendarDays className="w-4 h-4" />
          <span>Student Setup • Step {step} of 4</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Personalize Your Exam Preparation Profile
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-lg mx-auto">
          Claim your @username, choose your avatar, and align EDUVERSE AI with your board, class,
          and exam subjects.
        </p>

        <div className="flex items-center justify-center gap-2 max-w-xs mx-auto pt-2">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                s <= step ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-slate-200 dark:bg-slate-800'
              }`}
            />
          ))}
        </div>
      </div>

      <Card className="p-6 sm:p-8 space-y-6">
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1 */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Identity, Handle &amp; Board
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Set your display name, claim a unique @username, and select your educational board.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Display Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your full or preferred name"
                  className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Unique Username <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) =>
                      setUsernameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                    }
                    placeholder="e.g. rohan_cbse10"
                    maxLength={24}
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
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
                {usernameStatus.state === 'idle' && (
                  <p className="text-[11px] text-slate-500">
                    3–24 chars: lowercase letters, numbers, underscores.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
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
                        className={`w-9 h-9 rounded-full bg-gradient-to-tr ${preset.gradient} flex items-center justify-center text-xs font-extrabold text-white shadow-xs`}
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

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                Educational Board <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {INDIAN_BOARDS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBoard(b.id)}
                    className={`p-3.5 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between ${
                      board === b.id
                        ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-slate-900 dark:text-white'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">
                        {b.label}
                      </span>
                      {board === b.id && (
                        <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                      {b.full}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                Home State / UT
              </label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {INDIAN_STATES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Select Your Class &amp; Preferred Medium
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Eduverse AI defaults datesheet parsing and upcoming modules to your grade and
                study medium.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                Class / Grade (6 to 12) <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {CLASS_GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => handleGradeChange(g)}
                    className={`py-3 px-3 rounded-xl border text-center font-bold text-sm transition-all cursor-pointer ${
                      classGrade === g
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Languages className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                Preferred Study Medium
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    id: 'English',
                    label: 'English Medium',
                    desc: 'Standard NCERT English terminology',
                  },
                  {
                    id: 'Hindi',
                    label: 'हिन्दी माध्यम',
                    desc: 'Complete Hindi study terminology',
                  },
                  {
                    id: 'Hinglish',
                    label: 'Hinglish (Bilingual)',
                    desc: 'Conversational Hindi + English mix',
                  },
                ].map((lang) => (
                  <button
                    key={lang.id}
                    type="button"
                    onClick={() => setLanguage(lang.id as PreferredLanguage)}
                    className={`p-3.5 rounded-xl text-left border transition-all cursor-pointer ${
                      language === lang.id
                        ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-slate-900 dark:text-white'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">
                        {lang.label}
                      </span>
                      {language === lang.id && (
                        <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {lang.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Globe className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Your Exam Subjects for {classGrade}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Select the subjects appearing in your school or board exams.
                </p>
              </div>
              <Badge variant="purple" size="sm">
                {board}
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(AVAILABLE_SUBJECTS_BY_GRADE[classGrade] || []).map((sub) => {
                const isChecked = selectedSubjects.includes(sub);
                return (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => toggleSubject(sub)}
                    className={`p-3.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                      isChecked
                        ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-slate-900 dark:text-white'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center border text-xs font-bold ${
                          isChecked
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-transparent'
                        }`}
                      >
                        ✓
                      </div>
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        {sub}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 pt-1">
              <span>{selectedSubjects.length} subjects selected</span>
              <button
                type="button"
                onClick={() => setSelectedSubjects(AVAILABLE_SUBJECTS_BY_GRADE[classGrade] || [])}
                className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium cursor-pointer"
              >
                Select All Subjects
              </button>
            </div>
          </div>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Exam Preparation Priorities
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Choose the exam outcomes you want your EDUVERSE AI workspace focused on.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                Primary Exam Goals <span className="text-rose-500">*</span>
              </label>
              <div className="space-y-2">
                {POPULAR_LEARNING_GOALS.map((goal) => {
                  const isChecked = selectedGoals.includes(goal);
                  return (
                    <button
                      key={goal}
                      type="button"
                      onClick={() => toggleGoal(goal)}
                      className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer ${
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
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handleBack}
              icon={<ArrowLeft className="w-4 h-4" />}
            >
              Back
            </Button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleNext}
              icon={<ArrowRight className="w-4 h-4" />}
            >
              Next Step
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="lg"
              loading={isSubmitting}
              onClick={handleSubmit}
              icon={<CheckCircle2 className="w-4 h-4" />}
            >
              Complete Setup &amp; Enter Dashboard
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};
