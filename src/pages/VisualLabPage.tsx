import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  Eye,
  EyeOff,
  History,
  Info,
  Languages,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../router/Router';
import { AiApiClientError, generateVisualLabExperience } from '../api/client';
import {
  deleteVisualExploration,
  dispatchVerifiedLearningEvent,
  fetchLessonProgress,
  fetchTopicMasteryList,
  fetchVerifiedSyllabus,
  fetchVisualExplorations,
  saveVisualExploration,
  toggleSaveVisualExploration,
} from '../lib/firestoreService';
import { getCurriculumForStudent } from '../utils/curriculum';
import { computeChapterProgressList } from '../utils/recommendationEngine';
import { computePersonalizedVisualSuggestions } from '../utils/visualLabEngine';
import type { ClassGrade, IndianBoard } from '../types/auth';
import type { ChapterNode } from '../types/curriculum';
import type { LessonProgressRecord } from '../types/learning';
import type { TopicMasteryRecord } from '../types/phase4';
import type {
  GeneratedVisualSpec,
  PersonalizedVisualSuggestion,
  VisualLanguage,
  VisualRendererType,
} from '../types/phase3';
import {
  BohrAtomRenderer,
  CircuitNetworkRenderer,
  KinematicsProjectileRenderer,
  MolecularGeometryRenderer,
  OpticsRayRenderer,
  WaveOscillationRenderer,
} from '../components/visual-lab/ParametricSimRenderers';
import {
  CoordinateGeometryRenderer,
  MathFunctionPlotRenderer,
} from '../components/visual-lab/MathGraphRenderers';
import { AnnotatedDiagramRenderer } from '../components/visual-lab/AnnotatedDiagramRenderer';
import { IllustratedConceptView } from '../components/visual-lab/IllustratedConceptView';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { FEATURE_FLAGS } from '../config/featureFlags';
import { VisualLearningComingSoonCard } from '../components/visual-lab/VisualLearningComingSoonCard';

const BOARD_OPTIONS: IndianBoard[] = ['CBSE', 'CISCE', 'ICSE', 'ISC', 'StateBoard', 'Other'];
const CLASS_OPTIONS: ClassGrade[] = [
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
];

function getModalityBadge(rendererType: VisualRendererType, isHi: boolean) {
  if (rendererType === 'illustrated-concept') {
    return {
      label: isHi ? 'संरचित विजुअल व्याख्या' : 'Illustrated Explanation',
      classes: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      icon: <Sparkles className="w-3.5 h-3.5" />,
    };
  }
  if (rendererType === 'annotated-diagram') {
    return {
      label: isHi ? 'इंटरैक्टिव लेबल आरेख' : 'Interactive Diagram',
      classes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      icon: <Compass className="w-3.5 h-3.5" />,
    };
  }
  return {
    label: isHi ? 'लाइव कंप्यूटेड मॉडल' : 'Computed Interactive Model',
    classes: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    icon: <SlidersHorizontal className="w-3.5 h-3.5" />,
  };
}

const VisualLabWorkspace: React.FC = () => {
  const { user } = useAuth();
  const { searchParams } = useRouter();
  const formId = useId();

  const paramSubject = (searchParams.get('subject') || '').trim();
  const paramChapter = (searchParams.get('chapter') || '').trim();
  const paramTopic = (searchParams.get('topic') || '').trim();
  const paramRecId = (searchParams.get('recId') || '').trim();

  const [selectedBoard, setSelectedBoard] = useState<IndianBoard>(user?.board || 'CBSE');
  const [selectedClass, setSelectedClass] = useState<ClassGrade>(user?.classGrade || 'Class 10');
  const [language, setLanguage] = useState<VisualLanguage>(
    user?.language === 'Hindi' ? 'Hindi' : 'English'
  );
  const [showLabels, setShowLabels] = useState(true);

  const [subjectInput, setSubjectInput] = useState(paramSubject || user?.subjects?.[0] || 'Physics');
  const [customSubjectMode, setCustomSubjectMode] = useState(false);
  const [chapterInput, setChapterInput] = useState(paramChapter || '');
  const [customChapterMode, setCustomChapterMode] = useState(Boolean(paramChapter));
  const [topicInput, setTopicInput] = useState(paramTopic || '');
  const [customPromptInput, setCustomPromptInput] = useState('');

  const [verifiedNodes, setVerifiedNodes] = useState<ChapterNode[]>([]);
  const [topicMastery, setTopicMastery] = useState<TopicMasteryRecord[]>([]);
  const [lessonProgress, setLessonProgress] = useState<LessonProgressRecord[]>([]);
  const [explorations, setExplorations] = useState<GeneratedVisualSpec[]>([]);
  const [libraryFilter, setLibraryFilter] = useState<'recent' | 'saved'>('recent');

  const [activeVisual, setActiveVisual] = useState<GeneratedVisualSpec | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [presetTrigger, setPresetTrigger] = useState<Record<string, number | string> | null>(null);
  const [checkedObservations, setCheckedObservations] = useState<Record<number, boolean>>({});
  const [completedVisualIds, setCompletedVisualIds] = useState<Record<string, boolean>>({});

  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isHi = language === 'Hindi';

  // Sync user profile defaults cleanly
  useEffect(() => {
    if (user?.board) setSelectedBoard(user.board);
    if (user?.classGrade) setSelectedClass(user.classGrade);
    if (user?.language === 'Hindi') setLanguage('Hindi');
    if (!paramSubject && user?.subjects?.[0]) {
      setSubjectInput(user.subjects[0]);
    }
  }, [user?.board, user?.classGrade, user?.language, user?.subjects, paramSubject]);

  // Apply URL query parameters WITHOUT auto-generating AI calls
  useEffect(() => {
    if (paramSubject) {
      setSubjectInput(paramSubject);
      setCustomSubjectMode(false);
    }
    if (paramChapter) {
      setChapterInput(paramChapter);
      setCustomChapterMode(true);
    }
    if (paramTopic) {
      setTopicInput(paramTopic);
    }
  }, [paramSubject, paramChapter, paramTopic]);

  // Load persisted explorations, mastery, lesson progress, and verified syllabus
  useEffect(() => {
    if (!user?.uid) return;
    let active = true;
    const subjSlug = (subjectInput || 'science').toLowerCase().split(' ')[0];

    Promise.all([
      fetchVisualExplorations(user.uid).catch(() => []),
      fetchTopicMasteryList(user.uid).catch(() => []),
      fetchLessonProgress(user.uid).catch(() => []),
      fetchVerifiedSyllabus(selectedBoard, selectedClass, subjSlug).catch(() => []),
    ]).then(([visList, masteryList, progressList, nodes]) => {
      if (!active) return;
      setExplorations(visList);
      setTopicMastery(masteryList);
      setLessonProgress(progressList);
      setVerifiedNodes(nodes);
    });

    return () => {
      active = false;
    };
  }, [user?.uid, selectedBoard, selectedClass, subjectInput]);

  // Dynamic subjects and chapters from curriculum + verified nodes + user profile
  const curriculumSubjects = useMemo(
    () =>
      getCurriculumForStudent(
        selectedBoard,
        selectedClass,
        user?.subjects || [],
        verifiedNodes
      ),
    [selectedBoard, selectedClass, user?.subjects, verifiedNodes]
  );

  const subjectChoices = useMemo(() => {
    const names = new Set<string>(curriculumSubjects.map((s) => s.name));
    for (const s of user?.subjects || []) {
      if (s.trim()) names.add(s.trim());
    }
    if (subjectInput.trim()) names.add(subjectInput.trim());
    return Array.from(names);
  }, [curriculumSubjects, user?.subjects, subjectInput]);

  const activeSubjectChapters = useMemo(() => {
    const match = curriculumSubjects.find(
      (s) => s.name.toLowerCase() === subjectInput.trim().toLowerCase()
    );
    return match ? match.chapters : [];
  }, [curriculumSubjects, subjectInput]);

  useEffect(() => {
    if (!customChapterMode && activeSubjectChapters.length > 0) {
      const exists = activeSubjectChapters.some((ch) => ch.title === chapterInput);
      if (!exists) {
        setChapterInput(activeSubjectChapters[0].title);
      }
    }
  }, [activeSubjectChapters, chapterInput, customChapterMode]);

  const activeChapterTopics = useMemo(() => {
    const ch = activeSubjectChapters.find((c) => c.title === chapterInput);
    return ch ? ch.keyTopics : [];
  }, [activeSubjectChapters, chapterInput]);

  // Personalized prompts computed from student's real mastery & active progress
  const chapterProgressList = useMemo(
    () =>
      computeChapterProgressList({
        curriculum: curriculumSubjects,
        lessonProgress,
        verifiedEvents: [],
        topicMastery,
      }),
    [curriculumSubjects, lessonProgress, topicMastery]
  );

  const personalizedSuggestions = useMemo(
    () =>
      computePersonalizedVisualSuggestions({
        board: selectedBoard,
        classGrade: selectedClass,
        subjects: user?.subjects || subjectChoices,
        learningGoals: user?.learningGoals,
        topicMastery,
        chapterProgress: chapterProgressList,
        verifiedNodes,
        previousVisuals: explorations,
        language,
      }),
    [
      selectedBoard,
      selectedClass,
      user?.subjects,
      user?.learningGoals,
      subjectChoices,
      topicMastery,
      chapterProgressList,
      verifiedNodes,
      explorations,
      language,
    ]
  );

  // Check if current topic already has a saved/recent visual in Firestore (zero AI cost to reopen)
  const matchingExistingVisual = useMemo(() => {
    const t = topicInput.trim().toLowerCase();
    if (!t) return null;
    return (
      explorations.find(
        (v) =>
          v.topic.toLowerCase() === t &&
          v.subject.toLowerCase() === subjectInput.trim().toLowerCase() &&
          v.language === language
      ) || null
    );
  }, [explorations, topicInput, subjectInput, language]);

  const filteredLibrary = useMemo(() => {
    if (libraryFilter === 'saved') {
      return explorations.filter((v) => v.saved);
    }
    return explorations;
  }, [explorations, libraryFilter]);

  const openExploration = (spec: GeneratedVisualSpec) => {
    setActiveVisual(spec);
    setActiveStepIndex(0);
    setCheckedObservations({});
    const firstStep = spec.steps[0];
    setPresetTrigger(
      firstStep
        ? {
            ...(firstStep.presetParams || {}),
            ...(firstStep.highlightTarget ? { highlightTarget: firstStep.highlightTarget } : {}),
            _ts: Date.now(),
          }
        : null
    );
    setErrorMsg(null);
  };

  const runVisualGeneration = async (overrides?: {
    subject?: string;
    chapter?: string;
    topic?: string;
    customPrompt?: string;
    forceRegenerate?: boolean;
  }) => {
    const finalSubject = (overrides?.subject ?? subjectInput).trim();
    const finalChapter = (overrides?.chapter ?? chapterInput).trim();
    const finalTopic = (overrides?.topic ?? topicInput).trim();
    const finalPrompt = (overrides?.customPrompt ?? customPromptInput).trim();

    if (!finalSubject || !finalTopic) {
      setErrorMsg(
        isHi
          ? 'कृपया विजुअल जनरेट करने से पहले विषय और अवधारणा (Topic) दर्ज करें।'
          : 'Please enter both a Subject and a Topic / Concept before generating.'
      );
      return;
    }

    setErrorMsg(null);
    setGenerating(true);
    try {
      const requestPayload = {
        board: selectedBoard,
        classGrade: selectedClass,
        subject: finalSubject,
        chapter: finalChapter || finalSubject,
        topic: finalTopic,
        customPrompt: finalPrompt || undefined,
        language,
        forceRegenerate: overrides?.forceRegenerate,
      };

      let generated: GeneratedVisualSpec;
      try {
        generated = await generateVisualLabExperience(requestPayload);
      } catch (firstErr) {
        if (firstErr instanceof AiApiClientError && firstErr.retryable) {
          await new Promise((resolve) => setTimeout(resolve, 1400));
          generated = await generateVisualLabExperience(requestPayload);
        } else {
          throw firstErr;
        }
      }

      let stored = generated;
      if (user?.uid) {
        stored = await saveVisualExploration(generated).catch(() => generated);
        setExplorations((prev) => [stored, ...prev.filter((v) => v.id !== stored.id)].slice(0, 40));
        void dispatchVerifiedLearningEvent({
          eventType: 'lesson_started',
          subject: stored.subject,
          chapter: stored.chapter,
          topic: stored.topic,
          sourceModule: 'visual-lab',
          idempotencyKey: `visuallab_start_${stored.cacheKey}`,
          title: `Generated Visual Lab: ${stored.title}`,
        });
      }

      openExploration(stored);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not generate this visualization right now. Please try again.';
      setErrorMsg(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleApplySuggestion = (sug: PersonalizedVisualSuggestion, generateImmediately: boolean) => {
    setSubjectInput(sug.subject);
    setCustomSubjectMode(false);
    setChapterInput(sug.chapter);
    setCustomChapterMode(true);
    setTopicInput(sug.topic);
    setCustomPromptInput(sug.prompt);
    if (generateImmediately) {
      void runVisualGeneration({
        subject: sug.subject,
        chapter: sug.chapter,
        topic: sug.topic,
        customPrompt: sug.prompt,
      });
    }
  };

  const handleToggleSave = async () => {
    if (!activeVisual || !user?.uid) return;
    const nextSaved = !activeVisual.saved;
    const updated = { ...activeVisual, saved: nextSaved };
    setActiveVisual(updated);
    setExplorations((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    await toggleSaveVisualExploration(user.uid, updated.id, nextSaved).catch(() => {});
  };

  const handleDeleteVisual = async (visualId: string) => {
    if (!user?.uid) return;
    setExplorations((prev) => prev.filter((v) => v.id !== visualId));
    if (activeVisual?.id === visualId) {
      setActiveVisual(null);
    }
    await deleteVisualExploration(user.uid, visualId).catch(() => {});
  };

  const applyLessonStep = (stepIdx: number) => {
    if (!activeVisual) return;
    const safeIdx = Math.max(0, Math.min(activeVisual.steps.length - 1, stepIdx));
    setActiveStepIndex(safeIdx);
    const step = activeVisual.steps[safeIdx];
    if (step) {
      setPresetTrigger({
        ...(step.presetParams || {}),
        ...(step.highlightTarget ? { highlightTarget: step.highlightTarget } : {}),
        _ts: Date.now(),
      });
    }
  };

  const handleCompleteVisualLesson = async () => {
    if (!user?.uid || !activeVisual || completedVisualIds[activeVisual.id]) return;
    await dispatchVerifiedLearningEvent({
      eventType: 'lesson_completed',
      subject: activeVisual.subject,
      chapter: activeVisual.chapter,
      topic: activeVisual.topic,
      sourceModule: 'visual-lab',
      idempotencyKey: `visuallab_done_${activeVisual.cacheKey}`,
      title: `Completed Visual Lab: ${activeVisual.title}`,
      description: `${activeVisual.subject} (${activeVisual.board} ${activeVisual.classGrade}) AI visual concept mastery.`,
      recId: paramRecId || undefined,
    });
    setCompletedVisualIds((prev) => ({ ...prev, [activeVisual.id]: true }));
  };

  const renderActiveEngine = (visual: GeneratedVisualSpec) => {
    const common = { language, showLabels, presetTrigger };
    const cfg = visual.engineConfig;
    switch (visual.rendererType) {
      case 'kinematics-projectile':
        if (cfg.kinematics) return <KinematicsProjectileRenderer {...common} config={cfg.kinematics} />;
        break;
      case 'optics-ray':
        if (cfg.optics) return <OpticsRayRenderer {...common} config={cfg.optics} />;
        break;
      case 'circuit-network':
        if (cfg.circuit) return <CircuitNetworkRenderer {...common} config={cfg.circuit} />;
        break;
      case 'wave-oscillation':
        if (cfg.wave) return <WaveOscillationRenderer {...common} config={cfg.wave} />;
        break;
      case 'bohr-atom':
        if (cfg.bohr) return <BohrAtomRenderer {...common} config={cfg.bohr} />;
        break;
      case 'molecular-geometry':
        if (cfg.molecule) return <MolecularGeometryRenderer {...common} config={cfg.molecule} />;
        break;
      case 'math-function-plot':
        if (cfg.mathPlot) return <MathFunctionPlotRenderer {...common} config={cfg.mathPlot} />;
        break;
      case 'coordinate-geometry':
        if (cfg.geometry) return <CoordinateGeometryRenderer {...common} config={cfg.geometry} />;
        break;
      case 'annotated-diagram':
        if (cfg.diagram) return <AnnotatedDiagramRenderer {...common} config={cfg.diagram} />;
        break;
      case 'illustrated-concept':
      default:
        break;
    }
    if (cfg.illustrated) {
      return (
        <IllustratedConceptView
          config={cfg.illustrated}
          language={language}
          activeStepIndex={activeStepIndex}
          onSelectCardStep={(idx) => applyLessonStep(idx)}
        />
      );
    }
    return null;
  };

  const badge = activeVisual ? getModalityBadge(activeVisual.rendererType, isHi) : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-200 min-w-0">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-indigo-300">{selectedBoard}</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-200">{selectedClass}</span>
            <span aria-hidden="true">·</span>
            <span>{isHi ? 'AI विजुअल लर्निंग स्टूडियो' : 'AI Visual Learning Studio'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {isHi ? 'AI-संचालित विजुअल लर्निंग लैब' : 'AI-Powered Visual Learning Lab'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
            {isHi
              ? 'अपने कक्षा, बोर्ड और विषय के अनुसार किसी भी अवधारणा के लिए लाइव सिमुलेशन, इंटरैक्टिव आरेख, ग्राफ़ या विजुअल व्याख्या तैयार करें।'
              : 'Generate tailored interactive simulations, plotted graphs, clickable diagrams, and visual breakdowns for any Class 6–12 topic on demand.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={() => setLanguage('English')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                language === 'English' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLanguage('Hindi')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                language === 'Hindi' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Languages className="w-3.5 h-3.5" />
              हिंदी
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowLabels((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
          >
            {showLabels ? <Eye className="w-3.5 h-3.5 text-cyan-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-500" />}
            {showLabels ? (isHi ? 'लेबल चालू' : 'Labels On') : isHi ? 'लेबल बंद' : 'Labels Off'}
          </button>
        </div>
      </div>

      {/* AI Visual Generator Studio Form */}
      <Card className="p-4 sm:p-5 bg-slate-900/80 border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm sm:text-base font-bold text-white">
              {isHi ? 'कस्टम विजुअल लर्निंग जनरेटर' : 'Custom Visual Learning Generator'}
            </h2>
          </div>
          {matchingExistingVisual && (
            <button
              type="button"
              onClick={() => openExploration(matchingExistingVisual)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 cursor-pointer whitespace-nowrap"
            >
              <BookmarkCheck className="w-3.5 h-3.5" />
              {isHi ? 'पहले से जनरेटेड विजुअल खोलें' : 'Open Existing Saved Visual (No API Cost)'}
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runVisualGeneration();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Class */}
            <div>
              <label htmlFor={`${formId}-class`} className="block text-xs font-semibold text-slate-300 mb-1">
                {isHi ? 'कक्षा' : 'Class'}
              </label>
              <select
                id={`${formId}-class`}
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value as ClassGrade)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                {CLASS_OPTIONS.map((cls) => (
                  <option key={cls} value={cls}>
                    {cls}
                  </option>
                ))}
              </select>
            </div>

            {/* Board */}
            <div>
              <label htmlFor={`${formId}-board`} className="block text-xs font-semibold text-slate-300 mb-1">
                {isHi ? 'शिक्षा बोर्ड' : 'Education Board'}
              </label>
              <select
                id={`${formId}-board`}
                value={selectedBoard}
                onChange={(e) => setSelectedBoard(e.target.value as IndianBoard)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                {BOARD_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            {/* Subject */}
            <div>
              <label htmlFor={`${formId}-subject`} className="block text-xs font-semibold text-slate-300 mb-1">
                {isHi ? 'विषय' : 'Subject'}
              </label>
              {!customSubjectMode ? (
                <select
                  id={`${formId}-subject`}
                  value={subjectChoices.includes(subjectInput) ? subjectInput : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setCustomSubjectMode(true);
                      setSubjectInput('');
                    } else {
                      setSubjectInput(e.target.value);
                      setCustomChapterMode(false);
                    }
                  }}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  {subjectChoices.map((subj) => (
                    <option key={subj} value={subj}>
                      {subj}
                    </option>
                  ))}
                  <option value="__custom__">{isHi ? '+ अन्य विषय लिखें' : '+ Custom Subject...'}</option>
                </select>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    id={`${formId}-subject`}
                    type="text"
                    value={subjectInput}
                    onChange={(e) => setSubjectInput(e.target.value)}
                    placeholder={isHi ? 'विषय का नाम' : 'Enter subject'}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomSubjectMode(false);
                      setSubjectInput(subjectChoices[0] || 'Science');
                    }}
                    className="px-2.5 rounded-xl bg-slate-800 text-xs text-slate-300 hover:text-white cursor-pointer whitespace-nowrap"
                  >
                    List
                  </button>
                </div>
              )}
            </div>

            {/* Chapter */}
            <div>
              <label htmlFor={`${formId}-chapter`} className="block text-xs font-semibold text-slate-300 mb-1">
                {isHi ? 'अध्याय' : 'Chapter'}
              </label>
              {!customChapterMode && activeSubjectChapters.length > 0 ? (
                <select
                  id={`${formId}-chapter`}
                  value={
                    activeSubjectChapters.some((c) => c.title === chapterInput)
                      ? chapterInput
                      : '__custom__'
                  }
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setCustomChapterMode(true);
                      setChapterInput('');
                    } else {
                      setChapterInput(e.target.value);
                    }
                  }}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  {activeSubjectChapters.map((ch) => (
                    <option key={ch.id} value={ch.title}>
                      {ch.title}
                    </option>
                  ))}
                  <option value="__custom__">{isHi ? '+ कस्टम अध्याय लिखें' : '+ Custom Chapter...'}</option>
                </select>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    id={`${formId}-chapter`}
                    type="text"
                    value={chapterInput}
                    onChange={(e) => setChapterInput(e.target.value)}
                    placeholder={isHi ? 'अध्याय का नाम (वैकल्पिक)' : 'Enter chapter name'}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                  {activeSubjectChapters.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomChapterMode(false);
                        setChapterInput(activeSubjectChapters[0].title);
                      }}
                      className="px-2.5 rounded-xl bg-slate-800 text-xs text-slate-300 hover:text-white cursor-pointer whitespace-nowrap"
                    >
                      List
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-5">
              <label htmlFor={`${formId}-topic`} className="block text-xs font-semibold text-slate-300 mb-1">
                {isHi ? 'विशिष्ट विषय / अवधारणा (Topic)' : 'Specific Topic or Concept'}
              </label>
              <input
                id={`${formId}-topic`}
                type="text"
                required
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                placeholder={
                  isHi
                    ? 'जैसे: प्रकाश संश्लेषण, अवतल लेंस, द्विघात समीकरण...'
                    : 'e.g. Concave Mirror Ray Formation, Quadratic Roots, Chloroplast...'
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
              {activeChapterTopics.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {activeChapterTopics.slice(0, 5).map((tp) => (
                    <button
                      key={tp}
                      type="button"
                      onClick={() => setTopicInput(tp)}
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-medium cursor-pointer transition-colors ${
                        topicInput === tp
                          ? 'bg-indigo-600/20 border-indigo-400 text-indigo-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tp}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-5">
              <label htmlFor={`${formId}-prompt`} className="block text-xs font-semibold text-slate-300 mb-1">
                {isHi ? 'कस्टम विजुअल निर्देश (वैकल्पिक)' : 'Custom Topic-Related Prompt (Optional)'}
              </label>
              <input
                id={`${formId}-prompt`}
                type="text"
                value={customPromptInput}
                onChange={(e) => setCustomPromptInput(e.target.value)}
                placeholder={
                  isHi
                    ? 'जैसे: वर्चुअल इमेज केस पर फ़ोकस करें या तुलनात्मक आरेख दिखाएँ'
                    : 'e.g. Highlight virtual image case or compare series vs parallel drops'
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="lg:col-span-2 flex items-end">
              <Button
                type="submit"
                variant="primary"
                className="w-full py-2.5"
                disabled={generating}
                icon={generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              >
                {generating
                  ? isHi
                    ? 'बन रहा है...'
                    : 'Generating...'
                  : isHi
                    ? 'विजुअल बनाएँ'
                    : 'Generate Visual'}
              </Button>
            </div>
          </div>
        </form>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl bg-rose-500/10 border border-rose-500/35 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-200"
          >
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              disabled={generating}
              onClick={() => void runVisualGeneration()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-xs font-semibold text-rose-100 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {isHi ? 'पुनः प्रयास करें' : 'Retry'}
            </button>
          </div>
        )}
      </Card>

      {/* Personalized Topic Prompts & Saved/Recent Library (Only when no active visual OR collapsible browser above) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Personalized Suggestions */}
        <Card className="lg:col-span-7 p-4 bg-slate-900/70 border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-cyan-400" />
              {isHi ? 'आपके लिए व्यक्तिगत विजुअल सुझाव' : 'Personalized Visual Prompts'}
            </h2>
            <span className="text-[11px] text-slate-400">
              {selectedClass} · {selectedBoard}
            </span>
          </div>

          {personalizedSuggestions.length === 0 ? (
            <p className="text-xs text-slate-400">
              {isHi
                ? 'ऊपर अपना विषय और अवधारणा लिखकर पहला AI विजुअल मॉडल बनाएँ।'
                : 'Enter any subject and topic above to generate your first custom AI visual experience.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {personalizedSuggestions.map((sug) => (
                <div
                  key={sug.id}
                  className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex flex-col justify-between gap-2.5"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-cyan-300 truncate">{sug.subject}</span>
                      <span className="text-slate-400 shrink-0">{sug.reasonTag}</span>
                    </div>
                    <p className="text-xs font-bold text-white leading-snug">{sug.topic}</p>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{sug.prompt}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleApplySuggestion(sug, false)}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-[11px] font-semibold text-slate-200 cursor-pointer whitespace-nowrap"
                    >
                      {isHi ? 'फॉर्म में भरें' : 'Load Prompt'}
                    </button>
                    <button
                      type="button"
                      disabled={generating}
                      onClick={() => handleApplySuggestion(sug, true)}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-[11px] font-semibold text-white cursor-pointer whitespace-nowrap"
                    >
                      {isHi ? 'जनरेट करें' : 'Generate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent & Saved Visualizations */}
        <Card className="lg:col-span-5 p-4 bg-slate-900/70 border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
              <History className="w-4 h-4 text-indigo-400" />
              {isHi ? 'आपकी विजुअल लाइब्रेरी' : 'Your Visual Library'}
            </h2>
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={() => setLibraryFilter('recent')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                  libraryFilter === 'recent' ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`}
              >
                {isHi ? 'हाल के' : 'Recent'} ({explorations.length})
              </button>
              <button
                type="button"
                onClick={() => setLibraryFilter('saved')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                  libraryFilter === 'saved' ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`}
              >
                {isHi ? 'सहेजे गए' : 'Saved'} ({explorations.filter((v) => v.saved).length})
              </button>
            </div>
          </div>

          {filteredLibrary.length === 0 ? (
            <div className="rounded-xl bg-slate-950/70 border border-dashed border-slate-800 p-5 text-center space-y-1.5">
              <p className="text-xs font-semibold text-slate-300">
                {libraryFilter === 'saved'
                  ? isHi
                    ? 'अभी कोई सहेजा गया विजुअल नहीं है।'
                    : 'No saved visualizations yet.'
                  : isHi
                    ? 'अभी कोई जनरेटेड विजुअल नहीं है।'
                    : 'No generated visualizations yet.'}
              </p>
              <p className="text-[11px] text-slate-500">
                {isHi
                  ? 'जनरेट किए गए विजुअल्स यहाँ सहेजे जाते हैं ताकि आप बिना किसी अतिरिक्त AI कॉल के उन्हें दोबारा देख सकें।'
                  : 'Generated explorations appear here and reopen instantly from your saved history.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {filteredLibrary.slice(0, 12).map((item) => {
                const isSelected = activeVisual?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? 'bg-indigo-950/40 border-indigo-500/50'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openExploration(item)}
                      className="text-left flex-1 min-w-0 cursor-pointer"
                    >
                      <p className="text-xs font-bold text-white truncate">{item.title}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {item.subject} · {item.classGrade} · {item.language}
                      </p>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label={`Delete ${item.title}`}
                        onClick={() => void handleDeleteVisual(item.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-900 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Loading State */}
      {generating && (
        <Card className="p-8 bg-slate-900/90 border-slate-800 flex flex-col items-center justify-center text-center gap-3">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          <div className="space-y-1">
            <p className="text-sm font-bold text-white">
              {isHi
                ? `“${topicInput}” के लिए इंटरैक्टिव विजुअल मॉडल तैयार किया जा रहा है...`
                : `Building interactive visual model for “${topicInput}”...`}
            </p>
            <p className="text-xs text-slate-400">
              {isHi
                ? 'सिमुलेशन पैरामीटर, चरणबद्ध निर्देश और अवलोकन जाँच सूची संरचित की जा रही है।'
                : 'Selecting the best interactive engine, calibrated parameters, and guided exploration steps.'}
            </p>
          </div>
        </Card>
      )}

      {/* Active Interactive Visualization Stage */}
      {activeVisual && !generating && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Interactive Canvas & Concept Notes (~66%) */}
          <div className="lg:col-span-8 space-y-4 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3 px-1">
              <div className="space-y-1 min-w-0">
                <h2 className="text-lg sm:text-xl font-extrabold text-white leading-snug">
                  {activeVisual.title}
                </h2>
                <p className="text-xs text-slate-400">
                  {activeVisual.board} · {activeVisual.classGrade} · {activeVisual.subject} · {activeVisual.chapter}
                  {activeVisual.formulaOrLaw ? ` · ${activeVisual.formulaOrLaw}` : ''}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {badge && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${badge.classes}`}
                  >
                    {badge.icon}
                    {badge.label}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void handleToggleSave()}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer whitespace-nowrap ${
                    activeVisual.saved
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {activeVisual.saved ? (
                    <BookmarkCheck className="w-3.5 h-3.5" />
                  ) : (
                    <Bookmark className="w-3.5 h-3.5" />
                  )}
                  {activeVisual.saved
                    ? isHi
                      ? 'सहेजा गया'
                      : 'Saved'
                    : isHi
                      ? 'सहेजें'
                      : 'Save Visual'}
                </button>
                <button
                  type="button"
                  disabled={generating}
                  onClick={() =>
                    void runVisualGeneration({
                      subject: activeVisual.subject,
                      chapter: activeVisual.chapter,
                      topic: activeVisual.topic,
                      customPrompt: activeVisual.customPrompt,
                      forceRegenerate: true,
                    })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-300 cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {isHi ? 'पुनः जनरेट' : 'Regenerate'}
                </button>
              </div>
            </div>

            {renderActiveEngine(activeVisual)}

            {/* Structured Concept Breakdown & Observation Prompt */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-4 bg-slate-900/80 border-slate-800 space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                  {isHi ? 'अवधारणा की व्याख्या' : 'Concept Explanation'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                  {activeVisual.conceptExplanation}
                </p>
              </Card>

              <Card className="p-4 bg-slate-900/80 border-slate-800 space-y-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300 mb-1">
                    {isHi ? 'आप क्या देख रहे हैं' : 'What You Are Observing'}
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {activeVisual.whatYouAreObserving}
                  </p>
                </div>
                <div className="border-t border-slate-800 pt-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-300 mb-1">
                    {isHi ? 'इंटरैक्ट कैसे करें' : 'How to Interact'}
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {activeVisual.interactionInstructions}
                  </p>
                </div>
              </Card>
            </div>
          </div>

          {/* Right Guided Steps, Observations Checklist & Takeaways (~34%) */}
          <div className="lg:col-span-4 space-y-4">
            <Card className="p-4 space-y-2 bg-slate-900/90 border-slate-800">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                <Info className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>{isHi ? 'विजुअल मोड स्पष्टीकरण' : 'Visual Capability Note'}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {activeVisual.modalityHonestyLabel}
              </p>
            </Card>

            {/* Step-by-Step Exploration */}
            <Card className="p-4 space-y-4 bg-slate-900/90 border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <h3 className="text-sm font-bold text-white">
                  {isHi ? 'चरणबद्ध अन्वेषण' : 'Step-by-Step Exploration'}
                </h3>
                <span className="text-xs font-mono tabular-nums text-indigo-300">
                  {activeStepIndex + 1} / {activeVisual.steps.length}
                </span>
              </div>

              <div className="space-y-2">
                {activeVisual.steps.map((step, idx) => {
                  const isActive = idx === activeStepIndex;
                  return (
                    <button
                      key={step.step}
                      type="button"
                      onClick={() => applyLessonStep(idx)}
                      className={`w-full text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                          : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <p className="text-xs font-bold">
                        {step.step}. {step.title}
                      </p>
                      {isActive && (
                        <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                          {step.explanation}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={activeStepIndex === 0}
                  onClick={() => applyLessonStep(activeStepIndex - 1)}
                  icon={<ChevronLeft className="w-3.5 h-3.5" />}
                >
                  {isHi ? 'पिछला' : 'Previous'}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={activeStepIndex >= activeVisual.steps.length - 1}
                  onClick={() => applyLessonStep(activeStepIndex + 1)}
                  icon={<ChevronRight className="w-3.5 h-3.5" />}
                >
                  {isHi ? 'अगला' : 'Next Step'}
                </Button>
              </div>
            </Card>

            {/* Interactive Observations Checklist */}
            {activeVisual.observationsChecklist.length > 0 && (
              <Card className="p-4 space-y-2.5 bg-slate-900/90 border-slate-800">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  {isHi ? 'अवलोकन जाँच सूची' : 'Observations Checklist'}
                </h3>
                <div className="space-y-2">
                  {activeVisual.observationsChecklist.map((item, idx) => {
                    const checked = Boolean(checkedObservations[idx]);
                    return (
                      <label
                        key={idx}
                        className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setCheckedObservations((prev) => ({
                              ...prev,
                              [idx]: e.target.checked,
                            }))
                          }
                          className="mt-0.5 accent-emerald-500 rounded"
                        />
                        <span className={checked ? 'line-through text-slate-500' : ''}>{item}</span>
                      </label>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Key Takeaways & Mark Complete */}
            <Card className="p-4 space-y-3 bg-slate-900/90 border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                {isHi ? 'मुख्य निष्कर्ष' : 'Key Takeaways'}
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-300 list-disc pl-4">
                {activeVisual.keyTakeaways.map((tk, idx) => (
                  <li key={idx}>{tk}</li>
                ))}
              </ul>

              <div className="pt-2 border-t border-slate-800/80">
                <Button
                  size="sm"
                  variant={completedVisualIds[activeVisual.id] ? 'outline' : 'secondary'}
                  className="w-full"
                  disabled={Boolean(completedVisualIds[activeVisual.id])}
                  onClick={handleCompleteVisualLesson}
                  icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                >
                  {completedVisualIds[activeVisual.id]
                    ? isHi
                      ? 'विजुअल पाठ पूर्ण हुआ'
                      : 'Visual Lesson Completed'
                    : isHi
                      ? 'पाठ पूर्ण चिह्नित करें'
                      : 'Mark Visual Lesson Complete'}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

export const VisualLabPage: React.FC = () => {
  const { navigate } = useRouter();
  if (!FEATURE_FLAGS.visualLearningEnabled) {
    return (
      <VisualLearningComingSoonCard
        variant="page"
        onBackToDashboard={() => navigate('/dashboard')}
      />
    );
  }
  return <VisualLabWorkspace />;
};
