import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileText,
  HelpCircle,
  History,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  PenTool,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AiApiClientError, solveSmartDoubt } from '../api/client';
import {
  deleteDoubtTicket,
  dispatchVerifiedLearningEvent,
  fetchDoubtHistory,
  saveDoubtTicket,
} from '../lib/firestoreService';
import {
  AVAILABLE_SUBJECTS_BY_GRADE,
  CLASS_GRADES,
  INDIAN_BOARDS,
} from '../utils/curriculum';
import {
  TUTOR_LANGUAGES,
  formatAttachmentLabel,
  getTutorLanguageLabel,
  normalizeLanguageForTutor,
  sanitizeFirestoreId,
  stripDataUrlPrefix,
  validateAttachmentMetadata,
} from '../utils/aiValidation';
import {
  DoubtAttachmentInput,
  DoubtInputMode,
  DoubtTicket,
  SmartDoubtResponse,
  TutorLanguage,
} from '../types/ai';
import { ClassGrade, IndianBoard } from '../types/auth';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';

const INPUT_MODES: Array<{
  id: DoubtInputMode;
  label: string;
  helper: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'typed', label: 'Typed Question', helper: 'Type equations or concepts directly', icon: HelpCircle },
  { id: 'image', label: 'Image / Photo', helper: 'Textbook photo or diagram (PNG/JPG/WEBP)', icon: ImageIcon },
  { id: 'handwritten', label: 'Handwritten Note', helper: 'Notebook attempt or rough work photo', icon: PenTool },
  { id: 'pdf', label: 'PDF Material', helper: 'Study sheet or question page (PDF)', icon: FileText },
  { id: 'worksheet', label: 'Worksheet', helper: 'Extract & solve multiple questions', icon: Layers },
];

const SAMPLE_DOUBTS = [
  {
    label: 'Class 10 Math • Irrationality Proof',
    subject: 'Mathematics',
    question: 'Prove why √5 is irrational using contradiction, and show where students usually slip up.',
  },
  {
    label: 'Class 10 Science • Mirror Formula',
    subject: 'Science',
    question: 'An object 4 cm tall is placed 15 cm in front of a concave mirror of focal length 10 cm. Find the image position, nature, and height.',
  },
  {
    label: 'Class 12 Chemistry • Nernst Equation',
    subject: 'Chemistry',
    question: 'Why does EMF of a Daniel cell decrease as Zn2+ concentration increases? Explain with the Nernst equation.',
  },
];

export const DoubtSolverPage: React.FC = () => {
  const { user } = useAuth();
  const userId = user?.uid || '';

  const [classGrade, setClassGrade] = useState<ClassGrade>(user?.classGrade || 'Class 10');
  const [board, setBoard] = useState<IndianBoard>(user?.board || 'CBSE');
  const [language, setLanguage] = useState<TutorLanguage>(() =>
    normalizeLanguageForTutor(user?.language)
  );
  const [subjectHint, setSubjectHint] = useState<string>('Auto-detect');
  const [inputMode, setInputMode] = useState<DoubtInputMode>('typed');
  const [isWorksheet, setIsWorksheet] = useState<boolean>(false);
  const [questionText, setQuestionText] = useState<string>('');

  const [attachment, setAttachment] = useState<DoubtAttachmentInput | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [solving, setSolving] = useState<boolean>(false);
  const [simplifying, setSimplifying] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [solution, setSolution] = useState<SmartDoubtResponse | null>(null);
  const [activeWorksheetIdx, setActiveWorksheetIdx] = useState<number>(0);
  const [showEasierBox, setShowEasierBox] = useState<boolean>(false);
  const [selectedPracticeOption, setSelectedPracticeOption] = useState<string | null>(null);
  const [showPracticeHint, setShowPracticeHint] = useState<boolean>(false);
  const [showPracticeAnswer, setShowPracticeAnswer] = useState<boolean>(false);

  const [history, setHistory] = useState<DoubtTicket[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setClassGrade(user.classGrade || 'Class 10');
      setBoard(user.board || 'CBSE');
      setLanguage(normalizeLanguageForTutor(user.language));
    }
  }, [user?.uid, user?.classGrade, user?.board, user?.language]);

  useEffect(() => {
    if (!userId) {
      setHistoryLoading(false);
      return;
    }
    let active = true;
    setHistoryLoading(true);
    fetchDoubtHistory(userId)
      .then((tickets) => {
        if (active) setHistory(tickets);
      })
      .catch((err) => {
        console.warn('Failed to load doubt history:', err);
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const subjectChoices = useMemo(() => {
    const gradeSubjects = AVAILABLE_SUBJECTS_BY_GRADE[classGrade] || [];
    return Array.from(
      new Set(['Auto-detect', ...(user?.subjects || []), ...gradeSubjects, 'Physics', 'Chemistry', 'Mathematics', 'Biology', 'Social Science', 'English', 'Hindi'])
    );
  }, [classGrade, user?.subjects]);

  const resetInteractiveSolutionUi = () => {
    setActiveWorksheetIdx(0);
    setShowEasierBox(false);
    setSelectedPracticeOption(null);
    setShowPracticeHint(false);
    setShowPracticeAnswer(false);
  };

  const clearAttachment = () => {
    setAttachment(null);
    setPreviewDataUrl(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelected = (file: File | null | undefined) => {
    setUploadError(null);
    if (!file) return;

    const metaCheck = validateAttachmentMetadata({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });

    if (!metaCheck.valid) {
      setUploadError(metaCheck.error || 'Invalid file selected.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      setUploadError(`Could not read "${file.name}". Please ensure the file is not corrupted and try again.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const cleanBase64 = stripDataUrlPrefix(result);
      const fullCheck = validateAttachmentMetadata({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        dataBase64: cleanBase64,
      });

      if (!fullCheck.valid) {
        setUploadError(fullCheck.error || 'Could not validate file contents.');
        return;
      }

      setAttachment({
        fileName: file.name,
        mimeType: file.type.toLowerCase(),
        sizeBytes: fullCheck.decodedBytes ?? file.size,
        dataBase64: fullCheck.normalizedBase64 || cleanBase64,
      });

      if (file.type.startsWith('image/')) {
        setPreviewDataUrl(result);
      } else {
        setPreviewDataUrl(null);
      }

      if (file.type === 'application/pdf' && inputMode === 'typed') {
        setInputMode('pdf');
      } else if (file.type.startsWith('image/') && inputMode === 'typed') {
        setInputMode('image');
      }
    };
    reader.readAsDataURL(file);
  };

  const runSolve = async (simplerRequested = false) => {
    if (!questionText.trim() && !attachment) {
      setApiError('Please type a question or attach an image, handwritten note, or PDF worksheet.');
      return;
    }

    setApiError(null);
    if (simplerRequested) {
      setSimplifying(true);
    } else {
      setSolving(true);
      resetInteractiveSolutionUi();
    }

    try {
      const result = await solveSmartDoubt({
        question: questionText.trim(),
        subjectHint: subjectHint === 'Auto-detect' ? undefined : subjectHint,
        classGrade,
        board,
        language,
        inputMode,
        simplerRequested,
        isWorksheet: isWorksheet || inputMode === 'worksheet',
        attachment,
      });

      setSolution(result);
      if (simplerRequested) {
        setShowEasierBox(true);
      }

      // Persist structured doubt WITHOUT raw document bytes/base64
      const now = new Date().toISOString();
      const ticketId = activeTicketId || sanitizeFirestoreId(`doubt_${Date.now()}`);
      const attachmentLabel = attachment
        ? formatAttachmentLabel(attachment.fileName, attachment.mimeType, attachment.sizeBytes)
        : undefined;

      const ticketToSave: DoubtTicket = {
        id: ticketId,
        userId,
        title: (result.understoodQuestion || questionText || attachment?.fileName || 'Academic Doubt').slice(0, 200),
        subject: result.identifiedSubject,
        topic: result.identifiedTopic,
        classGrade,
        board,
        inputMode,
        attachmentLabel,
        questionText:
          questionText.trim() ||
          result.understoodQuestion ||
          `Question from ${attachmentLabel || 'uploaded study material'}`,
        language,
        status: 'answered',
        aiAnswer: result.stepByStepSolution.join('\n'),
        structuredSolution: result,
        createdAt: now,
        updatedAt: now,
      };

      const saved = await saveDoubtTicket(ticketToSave);
      setActiveTicketId(saved.id);
      setHistory((prev) => [saved, ...prev.filter((h) => h.id !== saved.id)]);

      if (user && !simplerRequested) {
        void dispatchVerifiedLearningEvent({
          eventType: 'doubt_submitted',
          subject: result.identifiedSubject,
          topic: result.identifiedTopic,
          sourceModule: 'doubt-solver',
          idempotencyKey: `doubt_${saved.id}`,
          title: `Solved Doubt: ${result.identifiedTopic}`,
          description: `${result.identifiedSubject} (${classGrade} ${board})`,
        });
      }
    } catch (err) {
      const msg =
        err instanceof AiApiClientError || err instanceof Error
          ? err.message
          : 'Unable to solve this doubt right now. Please retry.';
      setApiError(msg);
    } finally {
      setSolving(false);
      setSimplifying(false);
    }
  };

  const loadHistoryTicket = (ticket: DoubtTicket) => {
    setActiveTicketId(ticket.id);
    setQuestionText(ticket.questionText);
    if (ticket.inputMode) setInputMode(ticket.inputMode);
    if (ticket.subject) setSubjectHint(ticket.subject);
    clearAttachment();
    resetInteractiveSolutionUi();
    setApiError(null);
    if (ticket.structuredSolution) {
      setSolution(ticket.structuredSolution);
    } else {
      setSolution({
        identifiedSubject: ticket.subject,
        identifiedTopic: ticket.topic || 'General Topic',
        understoodQuestion: ticket.questionText,
        stepByStepSolution: ticket.aiAnswer ? ticket.aiAnswer.split('\n').filter(Boolean) : [],
        whyItWorks: 'Saved summary from earlier doubt resolution.',
        commonMisconceptions: [],
        similarPracticeQuestion: {
          question: 'Create a slight variation of this problem and verify your steps.',
          options: [],
          hint: 'Re-check the core principle used above.',
          answer: '',
        },
        easierExplanation: '',
        syllabusDisclaimer: `General ${ticket.classGrade} study guidance.`,
        isWorksheet: false,
        worksheetQuestions: [],
      });
    }
  };

  const handleDeleteTicket = async (doubtId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (!userId) return;
      await deleteDoubtTicket(userId, doubtId);
      setHistory((prev) => prev.filter((t) => t.id !== doubtId));
      if (activeTicketId === doubtId) {
        setActiveTicketId(null);
      }
    } catch (err) {
      console.warn('Failed to delete doubt ticket:', err);
    }
  };

  const activeWorksheetItem =
    solution?.isWorksheet && solution.worksheetQuestions.length > 0
      ? solution.worksheetQuestions[activeWorksheetIdx] || solution.worksheetQuestions[0]
      : null;

  const displayedTopic = activeWorksheetItem?.identifiedTopic || solution?.identifiedTopic || '';
  const displayedQuestion = activeWorksheetItem?.understoodQuestion || solution?.understoodQuestion || '';
  const displayedSteps = activeWorksheetItem?.stepByStepSolution || solution?.stepByStepSolution || [];
  const displayedWhyItWorks = activeWorksheetItem?.whyItWorks || solution?.whyItWorks || '';
  const displayedMisconceptions =
    activeWorksheetItem?.commonMisconceptions || solution?.commonMisconceptions || [];
  const displayedPractice =
    activeWorksheetItem?.similarPracticeQuestion || solution?.similarPracticeQuestion;
  const displayedEasier = activeWorksheetItem?.easierExplanation || solution?.easierExplanation || '';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-cyan-400 font-semibold">
            <Sparkles className="w-4 h-4" />
            <span>Multimodal Smart Doubt Solver • {board} • {classGrade}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Step-by-Step Doubt & Worksheet Resolution
          </h1>
          <p className="text-xs text-slate-400">
            Type a problem, upload textbook photos, handwritten notes, or PDF worksheets for structured derivations, misconceptions, and practice questions.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 shrink-0">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Uploaded files are processed transiently and never stored</span>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Composer & History */}
        <div className="lg:col-span-5 space-y-5">
          <Card className="p-4 sm:p-5 space-y-4">
            {/* Input Mode Tabs */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                Input Format
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {INPUT_MODES.map((m) => {
                  const Icon = m.icon;
                  const active = inputMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setInputMode(m.id);
                        if (m.id === 'worksheet') setIsWorksheet(true);
                      }}
                      className={`px-2.5 py-2 rounded-xl border text-left transition-all flex items-center gap-2 cursor-pointer ${
                        active
                          ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-xs font-semibold truncate">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Context Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Subject
                </span>
                <select
                  aria-label="Subject hint"
                  value={subjectHint}
                  onChange={(e) => setSubjectHint(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {subjectChoices.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Class
                </span>
                <select
                  aria-label="Doubt class grade"
                  value={classGrade}
                  onChange={(e) => setClassGrade(e.target.value as ClassGrade)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {CLASS_GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Board
                </span>
                <select
                  aria-label="Doubt board"
                  value={board}
                  onChange={(e) => setBoard(e.target.value as IndianBoard)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {INDIAN_BOARDS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Language Selector */}
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                Explanation Language
              </span>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-950 p-1 border border-slate-800">
                {TUTOR_LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setLanguage(lang)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      language === lang
                        ? 'bg-cyan-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {getTutorLanguageLabel(lang)}
                  </button>
                ))}
              </div>
            </div>

            {/* Upload Dropzone / Picker */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="doubt-file-upload"
                  className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                >
                  Attach Image, Handwritten Note, or PDF (Max 4 MB)
                </label>
                {attachment && (
                  <button
                    type="button"
                    onClick={clearAttachment}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 hover:underline cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    Remove
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                id="doubt-file-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => handleFileSelected(e.target.files?.[0])}
                className="sr-only"
              />

              {!attachment ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleFileSelected(e.dataTransfer.files?.[0]);
                  }}
                  className="w-full rounded-xl border border-dashed border-slate-700 hover:border-cyan-500/60 bg-slate-950/70 p-4 text-center space-y-1.5 transition-colors cursor-pointer"
                >
                  <Upload className="w-5 h-5 text-cyan-400 mx-auto" />
                  <p className="text-xs font-semibold text-slate-200">
                    Click to upload or drag & drop study material
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Supports PNG, JPEG, WEBP photos, handwritten notes, or PDF worksheets up to 4 MB
                  </p>
                </button>
              ) : (
                <div className="rounded-xl bg-slate-950 border border-cyan-500/35 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {attachment.mimeType === 'application/pdf' ? (
                        <FileText className="w-4 h-4 text-rose-400 shrink-0" />
                      ) : (
                        <ImageIcon className="w-4 h-4 text-cyan-400 shrink-0" />
                      )}
                      <span className="text-xs font-semibold text-slate-100 truncate">
                        {formatAttachmentLabel(
                          attachment.fileName,
                          attachment.mimeType,
                          attachment.sizeBytes
                        )}
                      </span>
                    </div>
                  </div>
                  {previewDataUrl && (
                    <img
                      src={previewDataUrl}
                      alt="Uploaded doubt preview"
                      className="max-h-40 rounded-lg border border-slate-800 object-contain mx-auto"
                    />
                  )}
                </div>
              )}

              {uploadError && (
                <div
                  role="alert"
                  className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-2.5 flex items-start gap-2 text-xs text-rose-200"
                >
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}
            </div>

            {/* Question Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="doubt-question-input"
                className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block"
              >
                Question or Extra Instructions
              </label>
              <textarea
                id="doubt-question-input"
                rows={4}
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                maxLength={3000}
                placeholder={
                  attachment
                    ? 'Optional: Add context like "Solve question 2 and 3" or "Check where my handwritten step went wrong"...'
                    : 'Type your math proof, physics numerical, chemical equation, or paste multiple worksheet questions...'
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-y"
              />
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isWorksheet}
                    onChange={(e) => setIsWorksheet(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-cyan-500"
                  />
                  <span>Worksheet mode (solve multiple questions)</span>
                </label>
                <span className="font-mono tabular-nums">{questionText.length}/3000</span>
              </div>
            </div>

            {apiError && (
              <div
                role="alert"
                className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-3 flex items-start gap-2 text-xs text-rose-200"
              >
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p>{apiError}</p>
                </div>
              </div>
            )}

            <Button
              type="button"
              size="lg"
              variant="primary"
              loading={solving}
              disabled={solving || simplifying || (!questionText.trim() && !attachment)}
              onClick={() => runSolve(false)}
              icon={<Sparkles className="w-4 h-4" />}
              className="w-full"
            >
              {solving ? 'Analyzing Doubt...' : 'Solve Doubt Step-by-Step'}
            </Button>
          </Card>

          {/* Saved Doubt History */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-cyan-400" />
                Recent Doubt History
              </h2>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                {history.length}
              </span>
            </div>

            {historyLoading ? (
              <div className="space-y-2">
                <div className="h-12 rounded-xl bg-slate-950 animate-pulse border border-slate-800/60" />
                <div className="h-12 rounded-xl bg-slate-950 animate-pulse border border-slate-800/60" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-xs text-slate-500 p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                Solved doubts are archived here cleanly (metadata and AI solutions only — raw files are never stored).
              </p>
            ) : (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {history.map((ticket) => (
                  <div
                    key={ticket.id}
                    className={`flex items-start justify-between gap-2 p-3 rounded-xl border transition-colors ${
                      activeTicketId === ticket.id
                        ? 'bg-cyan-500/10 border-cyan-500/40'
                        : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => loadHistoryTicket(ticket)}
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <p className="text-xs font-semibold text-slate-100 truncate">
                        {ticket.title}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {ticket.subject}
                        {ticket.topic ? ` • ${ticket.topic}` : ''}
                      </p>
                      {ticket.attachmentLabel && (
                        <p className="text-[10px] text-cyan-400 truncate mt-0.5">
                          Source: {ticket.attachmentLabel}
                        </p>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete doubt ${ticket.title}`}
                      onClick={(e) => handleDeleteTicket(ticket.id, e)}
                      className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Structured 7-Part Doubt Solution */}
        <div className="lg:col-span-7 space-y-4">
          {solving ? (
            <Card className="p-6 space-y-4 animate-pulse">
              <div className="h-5 w-52 bg-slate-800 rounded" />
              <div className="h-14 w-full bg-slate-950 rounded-xl border border-slate-800" />
              <div className="space-y-2">
                <div className="h-10 bg-slate-950 rounded-xl border border-slate-800" />
                <div className="h-10 bg-slate-950 rounded-xl border border-slate-800" />
                <div className="h-10 bg-slate-950 rounded-xl border border-slate-800" />
              </div>
              <div className="h-20 bg-slate-950 rounded-xl border border-slate-800" />
            </Card>
          ) : !solution ? (
            <Card className="p-6 space-y-6">
              <div className="space-y-2">
                <h2 className="text-base font-bold text-white">
                  What Every Smart Doubt Resolution Includes
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Every typed problem, photo, handwritten attempt, or PDF worksheet receives a complete 7-step conceptual breakdown rather than just a final answer.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {[
                  { num: '01', title: 'Subject & Topic Detection', desc: 'Automatically tags the exact academic topic.' },
                  { num: '02', title: 'Question Restatement', desc: 'Confirms handwritten or PDF text was read accurately.' },
                  { num: '03', title: 'Step-by-Step Solution', desc: 'Numbered logical steps with clear formulas.' },
                  { num: '04', title: 'Why the Solution Works', desc: 'Explains the underlying principle behind each step.' },
                  { num: '05', title: 'Common Misconceptions', desc: 'Flags frequent exam traps before you make them.' },
                  { num: '06', title: 'Similar Practice Question', desc: 'Interactive question + hint + answer to test mastery.' },
                  { num: '07', title: 'Easier Explanation Mode', desc: 'One-click intuitive breakdown when steps feel dense.' },
                ].map((item) => (
                  <div
                    key={item.num}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-start gap-2.5"
                  >
                    <span className="font-mono text-[11px] font-bold text-cyan-400 tabular-nums mt-0.5">
                      {item.num}
                    </span>
                    <div>
                      <p className="font-semibold text-slate-100">{item.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                  Load a Sample Doubt Prompt
                </span>
                <div className="flex flex-wrap gap-2">
                  {SAMPLE_DOUBTS.map((sample) => (
                    <button
                      key={sample.label}
                      type="button"
                      onClick={() => {
                        setInputMode('typed');
                        setSubjectHint(sample.subject);
                        setQuestionText(sample.question);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-cyan-500/40 text-xs font-medium text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
                    >
                      {sample.label}
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-5 sm:p-6 space-y-5">
              {/* 1. Identified Subject & Topic + Worksheet Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="px-2.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                      {solution.identifiedSubject}
                    </span>
                    <span className="text-slate-300">{displayedTopic}</span>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  loading={simplifying}
                  onClick={() => {
                    if (!showEasierBox && displayedEasier) {
                      setShowEasierBox(true);
                    } else {
                      runSolve(true);
                    }
                  }}
                  icon={<Lightbulb className="w-3.5 h-3.5" />}
                  className="whitespace-nowrap shrink-0"
                >
                  {showEasierBox ? 'Simplify Even More' : 'Explain Simpler'}
                </Button>
              </div>

              {/* Multi-Question Worksheet Selector */}
              {solution.isWorksheet && solution.worksheetQuestions.length > 0 && (
                <div className="space-y-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                    Worksheet Questions Detected ({solution.worksheetQuestions.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {solution.worksheetQuestions.map((wq, idx) => (
                      <button
                        key={wq.questionNumber}
                        type="button"
                        onClick={() => {
                          setActiveWorksheetIdx(idx);
                          setSelectedPracticeOption(null);
                          setShowPracticeHint(false);
                          setShowPracticeAnswer(false);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono tabular-nums cursor-pointer ${
                          activeWorksheetIdx === idx
                            ? 'bg-cyan-600 text-white'
                            : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        Q{wq.questionNumber}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 2. Question Understood */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 space-y-1">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Question Understood
                </h2>
                <p className="text-sm text-white leading-relaxed">{displayedQuestion}</p>
              </div>

              {/* 3. Step-by-Step Solution */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
                  Step-by-Step Solution
                </h3>
                <ol className="space-y-2">
                  {displayedSteps.map((step, idx) => (
                    <li
                      key={idx}
                      className="rounded-xl bg-slate-950/90 border border-slate-800 p-3.5 flex items-start gap-3"
                    >
                      <span className="w-6 h-6 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-mono text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">
                        {idx + 1}
                      </span>
                      <p className="text-xs sm:text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">
                        {step}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>

              {/* 4. Why This Solution Works & 5. Common Misconceptions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 space-y-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Why This Solution Works
                  </h3>
                  <p className="text-xs text-slate-200 leading-relaxed">{displayedWhyItWorks}</p>
                </div>

                <div className="rounded-xl bg-slate-950 border border-amber-500/25 p-4 space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Common Misconceptions
                  </h3>
                  {displayedMisconceptions.length > 0 ? (
                    <ul className="space-y-1.5 text-xs text-slate-200">
                      {displayedMisconceptions.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-amber-400 font-mono">•</span>
                          <span className="leading-relaxed">{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-400">
                      Always verify units, sign conventions, and assumptions before final substitution.
                    </p>
                  )}
                </div>
              </div>

              {/* 7. Easier Explanation Box (toggled or refreshed on demand) */}
              {showEasierBox && displayedEasier && (
                <div className="rounded-xl bg-indigo-950/35 border border-indigo-500/35 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                      <Lightbulb className="w-3.5 h-3.5" />
                      Simpler Intuitive Explanation
                    </h3>
                    <button
                      type="button"
                      onClick={() => runSolve(true)}
                      disabled={simplifying}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-300 hover:underline cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Generate Gentler Breakdown
                    </button>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">
                    {displayedEasier}
                  </p>
                </div>
              )}

              {/* 6. Similar Practice Question */}
              {displayedPractice && displayedPractice.question && (
                <div className="rounded-xl bg-slate-950 border border-cyan-500/30 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                      Similar Practice Question
                    </h3>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setShowPracticeHint((v) => !v)}
                        className="text-[11px] font-semibold text-amber-300 hover:underline cursor-pointer"
                      >
                        {showPracticeHint ? 'Hide Hint' : 'Show Hint'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPracticeAnswer((v) => !v)}
                        className="text-[11px] font-semibold text-emerald-300 hover:underline cursor-pointer"
                      >
                        {showPracticeAnswer ? 'Hide Answer' : 'Check Answer'}
                      </button>
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm font-medium text-white leading-relaxed">
                    {displayedPractice.question}
                  </p>

                  {displayedPractice.options && displayedPractice.options.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {displayedPractice.options.map((opt, idx) => {
                        const selected = selectedPracticeOption === opt;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setSelectedPracticeOption(opt);
                              setShowPracticeAnswer(true);
                            }}
                            className={`px-3 py-2 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                              selected
                                ? 'bg-cyan-500/15 border-cyan-500/60 text-white font-semibold'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {showPracticeHint && displayedPractice.hint && (
                    <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      Hint: {displayedPractice.hint}
                    </p>
                  )}

                  {showPracticeAnswer && displayedPractice.answer && (
                    <p className="text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                      Solution Check: {displayedPractice.answer}
                    </p>
                  )}
                </div>
              )}

              {/* Honest Curriculum Disclaimer */}
              <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-800/60">
                Syllabus Note: {solution.syllabusDisclaimer}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
