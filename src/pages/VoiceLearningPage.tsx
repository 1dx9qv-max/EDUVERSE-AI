import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  History,
  Mic,
  PlusCircle,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  generateVoiceSpeech,
  getFirebaseIdToken,
  sendVoiceTeacherTurn,
  transcribeVoiceClip,
} from '../api/client';
import {
  deleteVoiceSession,
  dispatchVerifiedLearningEvent,
  fetchVoiceSessions,
  saveVoiceSession,
} from '../lib/firestoreService';
import { TutorLanguage } from '../types/ai';
import {
  GeminiVoiceName,
  MicPermissionState,
  VoiceSessionRecord,
  VoiceSessionState,
  VoiceTransportMode,
  VoiceTurnItem,
} from '../types/phase6';
import { normalizeLanguageForTutor } from '../utils/aiValidation';
import {
  ALLOWED_VOICE_NAMES,
  base64Int16ToFloat32,
  calculateRmsLevel,
  classifyMicrophoneError,
  cleanTextForSpeech,
  float32ToInt16Base64,
  getBcp47LanguageTag,
  sanitizeVoiceSessionForStorage,
} from '../utils/voiceEngine';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { VoiceStateStage } from '../components/voice/VoiceStateStage';
import { VoiceTranscriptPanel } from '../components/voice/VoiceTranscriptPanel';

const DEFAULT_SUBJECTS = [
  'Science',
  'Physics',
  'Chemistry',
  'Biology',
  'Mathematics',
  'English',
  'Hindi',
  'Social Science',
  'History',
  'Geography',
];

function createTurnId(): string {
  return `vt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createSessionId(): string {
  return `vs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export const VoiceLearningPage: React.FC = () => {
  const { user } = useAuth();

  const board = user?.board || 'CBSE';
  const classGrade = user?.classGrade || 'Class 10';
  const userId = user?.uid || '';

  const subjectOptions = useMemo(() => {
    const merged = new Set([...(user?.subjects || []), ...DEFAULT_SUBJECTS]);
    return Array.from(merged);
  }, [user?.subjects]);

  const [subject, setSubject] = useState<string>(subjectOptions[0] || 'Science');
  const [topic, setTopic] = useState<string>('');
  const [language, setLanguage] = useState<TutorLanguage>(() =>
    normalizeLanguageForTutor(user?.language)
  );
  const [voiceName, setVoiceName] = useState<GeminiVoiceName>('Kore');
  const [transportMode, setTransportMode] = useState<VoiceTransportMode>(() => {
    if (
      typeof window !== 'undefined' &&
      typeof WebSocket !== 'undefined' &&
      (typeof window.AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined')
    ) {
      return 'gemini-live';
    }
    return 'stt-tts-pipeline';
  });

  const [sessionState, setSessionState] = useState<VoiceSessionState>('idle');
  const [micPermission, setMicPermission] = useState<MicPermissionState>('prompt');
  const [micErrorDetail, setMicErrorDetail] = useState<string | null>(null);
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [interimCaption, setInterimCaption] = useState<string>('');
  const [playbackEngineLabel, setPlaybackEngineLabel] = useState<string | null>(null);
  const [replayingTurnId, setReplayingTurnId] = useState<string | null>(null);

  const [activeSessionId, setActiveSessionId] = useState<string>(() => createSessionId());
  const [turns, setTurns] = useState<VoiceTurnItem[]>([]);
  const [savedSessions, setSavedSessions] = useState<VoiceSessionRecord[]>([]);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState<boolean>(false);

  // Refs to avoid stale closures inside audio / WebSocket callbacks
  const isMicMutedRef = useRef(isMicMuted);
  const isSpeakerMutedRef = useRef(isSpeakerMuted);
  const sessionStateRef = useRef(sessionState);
  const languageRef = useRef(language);
  const subjectRef = useRef(subject);
  const turnsRef = useRef(turns);
  const savedSessionsRef = useRef(savedSessions);
  const lastActiveBeforePauseRef = useRef<VoiceTransportMode>('gemini-live');

  isMicMutedRef.current = isMicMuted;
  isSpeakerMutedRef.current = isSpeakerMuted;
  sessionStateRef.current = sessionState;
  languageRef.current = language;
  subjectRef.current = subject;
  turnsRef.current = turns;
  savedSessionsRef.current = savedSessions;

  // Audio / Recording / WS refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const speechRecRef = useRef<any>(null);
  const speechTranscriptRef = useRef<string>('');
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const activeAudioElRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);
  const liveWsRef = useRef<WebSocket | null>(null);
  const liveNextStartTimeRef = useRef<number>(0);
  const liveScheduledNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const liveInputBufferRef = useRef<string>('');
  const liveOutputBufferRef = useRef<string>('');
  const pausedAudioUrlRef = useRef<{ url: string; currentTime: number; turnId?: string } | null>(null);
  const wasLiveWsActiveRef = useRef<boolean>(false);
  const speechSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved text-only transcripts on mount
  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    fetchVoiceSessions(userId)
      .then((list) => {
        if (mounted) setSavedSessions(list);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [userId]);

  // Check microphone API support & permissions state upfront without requesting hardware yet
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported');
      setMicErrorDetail(
        'Voice recording APIs are unavailable in this browser context. You can use the Text Fallback below and still hear AI Teacher responses.'
      );
      return;
    }

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          if (status.state === 'denied') {
            setMicPermission('denied');
            setMicErrorDetail(
              'Microphone access is currently blocked in browser permissions. Allow access or use the Text Fallback input anytime.'
            );
          } else if (status.state === 'granted') {
            setMicPermission('granted');
          }
          status.onchange = () => {
            if (status.state === 'denied') {
              setMicPermission('denied');
            } else if (status.state === 'granted') {
              setMicPermission('granted');
              setMicErrorDetail(null);
            } else {
              setMicPermission('prompt');
            }
          };
        })
        .catch(() => {
          // Permissions API may not support 'microphone' query on Safari/Firefox; prompt on click
        });
    }
  }, []);

  const persistTurns = useCallback(
    async (
      nextTurns: VoiceTurnItem[],
      detectedTopic?: string,
      modeOverride?: VoiceTransportMode
    ) => {
      if (nextTurns.length === 0) return;
      const firstStudentTurn = nextTurns.find((t) => t.role === 'student');
      const existingSession = savedSessionsRef.current.find((s) => s.id === activeSessionId);
      const titleCandidate =
        existingSession?.title ||
        topic ||
        detectedTopic ||
        firstStudentTurn?.text ||
        `${subjectRef.current} Voice Session`;

      const sessionObj: VoiceSessionRecord = sanitizeVoiceSessionForStorage({
        id: activeSessionId,
        userId,
        title: titleCandidate.slice(0, 120),
        subject: subjectRef.current,
        topic: detectedTopic || topic || subjectRef.current,
        classGrade,
        board,
        language: languageRef.current,
        voiceName,
        transportUsed: modeOverride || transportMode,
        turns: nextTurns,
        createdAt: existingSession?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      try {
        if (!userId) return;
        const saved = await saveVoiceSession(sessionObj);
        setSavedSessions((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)].slice(0, 30));
      } catch {
        // Non-blocking save error; conversation continues uninterrupted
      }
    },
    [activeSessionId, board, classGrade, topic, transportMode, userId, voiceName]
  );

  const stopPlaybackOnly = useCallback((preservePausedOffset = false) => {
    if (activeAudioElRef.current) {
      try {
        if (preservePausedOffset && !activeAudioElRef.current.ended && activeAudioUrlRef.current) {
          pausedAudioUrlRef.current = {
            url: activeAudioUrlRef.current,
            currentTime: activeAudioElRef.current.currentTime,
          };
        }
        activeAudioElRef.current.pause();
        if (!preservePausedOffset) {
          activeAudioElRef.current.src = '';
        }
      } catch {
        // Ignore audio pause errors
      }
      if (!preservePausedOffset) {
        activeAudioElRef.current = null;
      }
    }

    if (!preservePausedOffset && activeAudioUrlRef.current) {
      try {
        URL.revokeObjectURL(activeAudioUrlRef.current);
      } catch {
        // Ignore URL revoke errors
      }
      activeAudioUrlRef.current = null;
      pausedAudioUrlRef.current = null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speechSynthesis cancel errors
      }
    }

    // Clear any scheduled Gemini Live 24kHz chunks
    for (const srcNode of liveScheduledNodesRef.current) {
      try {
        srcNode.stop();
      } catch {
        // Ignore already stopped audio nodes
      }
    }
    liveScheduledNodesRef.current = [];
    liveNextStartTimeRef.current = 0;

    if (speechSafetyTimerRef.current) {
      clearTimeout(speechSafetyTimerRef.current);
      speechSafetyTimerRef.current = null;
    }

    setReplayingTurnId(null);
    setPlaybackEngineLabel(null);
  }, []);

  const stopMicHardware = useCallback(() => {
    if (meterFrameRef.current !== null) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    setAudioLevel(0);

    if (speechRecRef.current) {
      try {
        speechRecRef.current.onresult = null;
        speechRecRef.current.onerror = null;
        speechRecRef.current.onend = null;
        speechRecRef.current.stop();
      } catch {
        // Ignore SpeechRecognition stop errors
      }
      speechRecRef.current = null;
    }

    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.disconnect();
      } catch {
        // Ignore disconnect error
      }
      processorNodeRef.current = null;
    }

    if (analyserNodeRef.current) {
      try {
        analyserNodeRef.current.disconnect();
      } catch {
        // Ignore disconnect error
      }
      analyserNodeRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      try {
        void inputAudioCtxRef.current.close();
      } catch {
        // Ignore AudioContext close error
      }
      inputAudioCtxRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      }
      mediaStreamRef.current = null;
    }
  }, []);

  const closeLiveWebSocket = useCallback(() => {
    if (liveWsRef.current) {
      try {
        if (liveWsRef.current.readyState === WebSocket.OPEN) {
          liveWsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        liveWsRef.current.close();
      } catch {
        // Ignore WS close errors
      }
      liveWsRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      try {
        void outputAudioCtxRef.current.close();
      } catch {
        // Ignore output AudioContext close error
      }
      outputAudioCtxRef.current = null;
    }
    liveInputBufferRef.current = '';
    liveOutputBufferRef.current = '';
  }, []);

  // Full cleanup on page unmount
  useEffect(() => {
    return () => {
      stopPlaybackOnly(false);
      stopMicHardware();
      closeLiveWebSocket();
    };
  }, [closeLiveWebSocket, stopMicHardware, stopPlaybackOnly]);

  const speakWithBrowserFallback = useCallback(
    (textToSpeak: string, lang: TutorLanguage, turnId?: string) => {
      if (speechSafetyTimerRef.current) {
        clearTimeout(speechSafetyTimerRef.current);
        speechSafetyTimerRef.current = null;
      }

      if (isSpeakerMutedRef.current || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setSessionState('idle');
        setPlaybackEngineLabel(null);
        setReplayingTurnId(null);
        return;
      }

      try {
        window.speechSynthesis.cancel();
        const cleaned = cleanTextForSpeech(textToSpeak);
        const voices = window.speechSynthesis.getVoices();
        // Headless browsers or systems without speech voices may silently drop utterances without firing onend/onerror
        if (!cleaned) {
          setSessionState('idle');
          setPlaybackEngineLabel(null);
          setReplayingTurnId(null);
          return;
        }

        const utterance = new SpeechSynthesisUtterance(cleaned);
        const targetLangTag = getBcp47LanguageTag(lang);
        utterance.lang = targetLangTag;
        utterance.rate = 0.96;

        const exactVoice =
          voices.find((v) => v.lang.toLowerCase() === targetLangTag.toLowerCase()) ||
          voices.find((v) => v.lang.toLowerCase().startsWith(targetLangTag.split('-')[0].toLowerCase()));
        if (exactVoice) utterance.voice = exactVoice;

        let started = false;
        const finishSafely = () => {
          if (speechSafetyTimerRef.current) {
            clearTimeout(speechSafetyTimerRef.current);
            speechSafetyTimerRef.current = null;
          }
          setSessionState((prev) => (prev === 'paused' ? 'paused' : 'idle'));
          setPlaybackEngineLabel(null);
          setReplayingTurnId(null);
        };

        utterance.onstart = () => {
          started = true;
          if (speechSafetyTimerRef.current) clearTimeout(speechSafetyTimerRef.current);
          const maxSpeakMs = Math.min(45000, Math.max(8000, cleaned.length * 90));
          speechSafetyTimerRef.current = setTimeout(() => {
            try {
              window.speechSynthesis.cancel();
            } catch {
              // Ignore cancel errors
            }
            finishSafely();
          }, maxSpeakMs);
          setSessionState('speaking');
          setPlaybackEngineLabel(`Browser Speech (${targetLangTag})`);
          if (turnId) setReplayingTurnId(turnId);
        };
        utterance.onend = finishSafely;
        utterance.onerror = finishSafely;

        // Guard against engines where speechSynthesis.speak() neither starts nor errors
        speechSafetyTimerRef.current = setTimeout(() => {
          if (!started && !window.speechSynthesis.speaking) {
            try {
              window.speechSynthesis.cancel();
            } catch {
              // Ignore cancel errors
            }
            finishSafely();
          }
        }, 1200);

        window.speechSynthesis.speak(utterance);
      } catch {
        setSessionState('idle');
        setPlaybackEngineLabel(null);
        setReplayingTurnId(null);
      }
    },
    []
  );

  const playTeacherSpeech = useCallback(
    async (spokenText: string, lang: TutorLanguage, turnId?: string) => {
      stopPlaybackOnly(false);
      if (isSpeakerMutedRef.current) {
        setSessionState('idle');
        return;
      }

      const cleanScript = cleanTextForSpeech(spokenText);
      if (!cleanScript) {
        setSessionState('idle');
        return;
      }

      setSessionState('speaking');
      if (turnId) setReplayingTurnId(turnId);

      try {
        const ttsResult = await generateVoiceSpeech({
          text: cleanScript,
          language: lang,
          voiceName,
        });

        // Respect mute or stop triggered while waiting for TTS audio
        if (isSpeakerMutedRef.current || sessionStateRef.current === 'paused') {
          setReplayingTurnId(null);
          return;
        }

        const binary = atob(ttsResult.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        const wavBlob = new Blob([bytes], { type: ttsResult.mimeType || 'audio/wav' });
        const objectUrl = URL.createObjectURL(wavBlob);
        activeAudioUrlRef.current = objectUrl;

        const audioEl = new Audio(objectUrl);
        activeAudioElRef.current = audioEl;
        setPlaybackEngineLabel(`Gemini TTS (${ttsResult.voiceName} • ${lang})`);

        audioEl.onended = () => {
          stopPlaybackOnly(false);
          setSessionState((prev) => (prev === 'paused' ? 'paused' : 'idle'));
        };
        audioEl.onerror = () => {
          speakWithBrowserFallback(cleanScript, lang, turnId);
        };

        await audioEl.play();
      } catch {
        // Reliable fallback if Gemini TTS hits quota or browser blocks autoplay
        speakWithBrowserFallback(cleanScript, lang, turnId);
      }
    },
    [speakWithBrowserFallback, stopPlaybackOnly, voiceName]
  );

  const processTeacherTurnText = useCallback(
    async (studentText: string, inputSource: 'stt-voice' | 'text') => {
      const cleaned = studentText.trim();
      if (!cleaned) {
        setSessionState('idle');
        return;
      }

      const studentTurn: VoiceTurnItem = {
        id: createTurnId(),
        role: 'student',
        text: cleaned,
        inputSource,
        language: languageRef.current,
        timestamp: new Date().toISOString(),
      };

      const turnsWithStudent = [...turnsRef.current, studentTurn];
      setTurns(turnsWithStudent);
      setSessionState('processing');
      setMicErrorDetail(null);

      try {
        const history = turnsWithStudent.slice(-10, -1).map((t) => ({
          role: t.role === 'teacher' ? ('assistant' as const) : ('user' as const),
          content: t.text,
        }));

        const aiResult = await sendVoiceTeacherTurn({
          subject: subjectRef.current,
          topic: topic || undefined,
          classGrade,
          board,
          language: languageRef.current,
          message: cleaned,
          history,
        });

        const teacherTurn: VoiceTurnItem = {
          id: createTurnId(),
          role: 'teacher',
          text: aiResult.replyText,
          spokenScript: aiResult.spokenScript,
          conceptualCheck: aiResult.conceptualCheck,
          inputSource: 'text',
          language: aiResult.languageUsed,
          timestamp: new Date().toISOString(),
        };

        const finalTurns = [...turnsWithStudent, teacherTurn];
        setTurns(finalTurns);
        if (aiResult.detectedTopic && !topic) {
          setTopic(aiResult.detectedTopic);
        }

        await persistTurns(
          finalTurns,
          aiResult.detectedTopic,
          inputSource === 'text' && transportMode === 'text-fallback'
            ? 'text-fallback'
            : 'stt-tts-pipeline'
        );

        if (userId) {
          void dispatchVerifiedLearningEvent({
            eventType: 'voice_turn',
            subject: subjectRef.current,
            topic: aiResult.detectedTopic || topic,
            sourceModule: 'voice-learning',
            idempotencyKey: `voice_${teacherTurn.id}`,
            title: `Voice Lesson: ${aiResult.detectedTopic || subjectRef.current}`,
            description: `Practiced ${subjectRef.current} (${aiResult.languageUsed}) in Voice Classroom.`,
          });
        }

        const spokenBody = `${aiResult.spokenScript}. ${aiResult.conceptualCheck}`;
        await playTeacherSpeech(spokenBody, aiResult.languageUsed, teacherTurn.id);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to reach AI Voice Teacher right now. Please try again.';
        setSessionState('error');
        setMicErrorDetail(msg);
      }
    },
    [board, classGrade, persistTurns, playTeacherSpeech, topic, transportMode, userId]
  );

  const commitLiveAccumulatedTurns = useCallback(() => {
    const inText = liveInputBufferRef.current.trim();
    const outText = liveOutputBufferRef.current.trim();
    liveInputBufferRef.current = '';
    liveOutputBufferRef.current = '';

    if (!inText && !outText) return;

    const additions: VoiceTurnItem[] = [];
    if (inText) {
      additions.push({
        id: createTurnId(),
        role: 'student',
        text: inText,
        inputSource: 'live-voice',
        language: languageRef.current,
        timestamp: new Date().toISOString(),
      });
    }
    let liveTeacherTurnId: string | null = null;
    if (outText) {
      liveTeacherTurnId = createTurnId();
      additions.push({
        id: liveTeacherTurnId,
        role: 'teacher',
        text: outText,
        spokenScript: cleanTextForSpeech(outText),
        inputSource: 'live-voice',
        language: languageRef.current,
        timestamp: new Date().toISOString(),
      });
    }

    const updated = [...turnsRef.current, ...additions];
    setTurns(updated);
    void persistTurns(updated, topic || subjectRef.current, 'gemini-live');
    if (userId && liveTeacherTurnId) {
      void dispatchVerifiedLearningEvent({
        eventType: 'voice_turn',
        subject: subjectRef.current,
        topic: topic || subjectRef.current,
        sourceModule: 'voice-learning',
        idempotencyKey: `voice_${liveTeacherTurnId}`,
        title: `Live Voice Lesson: ${topic || subjectRef.current}`,
        description: `Practiced ${subjectRef.current} (${languageRef.current}) via Gemini Live.`,
      });
    }
  }, [persistTurns, topic, userId]);

  const scheduleLivePcmPlayback = useCallback((base64Pcm: string) => {
    if (isSpeakerMutedRef.current) return;

    if (!outputAudioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      outputAudioCtxRef.current = new AudioCtx({ sampleRate: 24000 });
    }
    const ctx = outputAudioCtxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const floatSamples = base64Int16ToFloat32(base64Pcm);
    if (floatSamples.length === 0) return;

    const buffer = ctx.createBuffer(1, floatSamples.length, 24000);
    buffer.getChannelData(0).set(floatSamples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, liveNextStartTimeRef.current);
    source.start(startAt);
    liveNextStartTimeRef.current = startAt + buffer.duration;
    liveScheduledNodesRef.current.push(source);

    setSessionState('speaking');
    setPlaybackEngineLabel(`Gemini Live Audio (24kHz PCM • ${voiceName})`);

    source.onended = () => {
      liveScheduledNodesRef.current = liveScheduledNodesRef.current.filter((n) => n !== source);
      if (liveScheduledNodesRef.current.length === 0 && liveWsRef.current?.readyState === WebSocket.OPEN) {
        setSessionState((prev) => (prev === 'paused' ? 'paused' : 'listening'));
        setPlaybackEngineLabel(null);
      }
    };
  }, [voiceName]);

  const startGeminiLiveSession = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported');
      setMicErrorDetail('Live microphone capture is unsupported in this browser. Switching to Text Fallback.');
      setTransportMode('text-fallback');
      return;
    }

    stopPlaybackOnly(false);
    stopMicHardware();
    closeLiveWebSocket();
    setMicErrorDetail(null);
    setInterimCaption('');
    setSessionState('connecting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;
      setMicPermission('granted');
    } catch (err) {
      const classified = classifyMicrophoneError(err);
      setMicPermission(classified.permissionState);
      setMicErrorDetail(classified.detail);
      setSessionState('error');
      return;
    }

    const idToken = await getFirebaseIdToken();
    if (!idToken) {
      setMicErrorDetail('Sign-in token unavailable. Please refresh your session or use Voice Turn mode.');
      stopMicHardware();
      setSessionState('error');
      return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/voice-live?token=${encodeURIComponent(idToken)}`;
    const ws = new WebSocket(wsUrl);
    liveWsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          idToken,
          config: {
            subject: subjectRef.current,
            topic,
            classGrade,
            board,
            language: languageRef.current,
            voiceName,
          },
        })
      );
    };

    ws.onmessage = (event) => {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'connected') {
        setSessionState('listening');
        // Start 16kHz PCM mic stream only once Live API session is open
        try {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const inputCtx = new AudioCtx({ sampleRate: 16000 });
          inputAudioCtxRef.current = inputCtx;
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          processorNodeRef.current = processor;

          source.connect(processor);
          processor.connect(inputCtx.destination);

          processor.onaudioprocess = (ev) => {
            if (isMicMutedRef.current || sessionStateRef.current === 'paused') {
              setAudioLevel(0);
              return;
            }
            const channelData = ev.inputBuffer.getChannelData(0);
            setAudioLevel(calculateRmsLevel(channelData));
            if (liveWsRef.current && liveWsRef.current.readyState === WebSocket.OPEN) {
              liveWsRef.current.send(
                JSON.stringify({
                  type: 'audio',
                  data: float32ToInt16Base64(channelData),
                })
              );
            }
          };
        } catch (audioErr) {
          const classified = classifyMicrophoneError(audioErr);
          setMicErrorDetail(classified.detail);
          setSessionState('error');
          closeLiveWebSocket();
          stopMicHardware();
        }
        return;
      }

      if (msg.type === 'inputTranscript' && typeof msg.text === 'string') {
        liveInputBufferRef.current += msg.text;
        setInterimCaption(liveInputBufferRef.current.trim());
        return;
      }

      if (msg.type === 'outputTranscript' && typeof msg.text === 'string') {
        liveOutputBufferRef.current += msg.text;
        const preview = liveOutputBufferRef.current.trim();
        if (preview) {
          setInterimCaption(`AI Teacher: ${preview}`);
        }
        return;
      }

      if (msg.type === 'audio' && typeof msg.data === 'string') {
        scheduleLivePcmPlayback(msg.data);
        return;
      }

      if (msg.type === 'interrupted') {
        stopPlaybackOnly(false);
        commitLiveAccumulatedTurns();
        setSessionState('listening');
        return;
      }

      if (msg.type === 'turnComplete') {
        setInterimCaption('');
        commitLiveAccumulatedTurns();
        if (isSpeakerMutedRef.current || liveScheduledNodesRef.current.length === 0) {
          setSessionState((prev) => (prev === 'paused' ? 'paused' : 'listening'));
          setPlaybackEngineLabel(null);
        }
        return;
      }

      if (msg.type === 'error') {
        setMicErrorDetail(
          `${msg.message || 'Live audio unavailable.'} Switched automatically to reliable Voice Turn (STT + Gemini + TTS) mode.`
        );
        closeLiveWebSocket();
        stopMicHardware();
        setTransportMode('stt-tts-pipeline');
        setSessionState('idle');
        return;
      }

      if (msg.type === 'liveClosed') {
        commitLiveAccumulatedTurns();
        stopMicHardware();
        setSessionState('idle');
      }
    };

    ws.onerror = () => {
      setMicErrorDetail(
        'Real-time Live WebSocket could not stay open. Switched cleanly to reliable Voice Turn (STT + Gemini + TTS) mode.'
      );
      closeLiveWebSocket();
      stopMicHardware();
      setTransportMode('stt-tts-pipeline');
      setSessionState('idle');
    };
  }, [
    board,
    classGrade,
    closeLiveWebSocket,
    commitLiveAccumulatedTurns,
    scheduleLivePcmPlayback,
    stopMicHardware,
    stopPlaybackOnly,
    topic,
    voiceName,
  ]);

  const startTurnBasedRecording = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported');
      setMicErrorDetail(
        'Microphone capture is unsupported in this browser. Type below using Text Fallback anytime.'
      );
      setTransportMode('text-fallback');
      return;
    }

    stopPlaybackOnly(false);
    stopMicHardware();
    setMicErrorDetail(null);
    setInterimCaption('');
    speechTranscriptRef.current = '';
    recordedChunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;
      setMicPermission('granted');
    } catch (err) {
      const classified = classifyMicrophoneError(err);
      setMicPermission(classified.permissionState);
      setMicErrorDetail(classified.detail);
      setSessionState('error');
      return;
    }

    setSessionState('listening');

    // Start real RMS meter using Web Audio AnalyserNode
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      inputAudioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserNodeRef.current = analyser;
      const samples = new Float32Array(analyser.fftSize);

      const updateMeter = () => {
        if (!analyserNodeRef.current || sessionStateRef.current !== 'listening') return;
        if (isMicMutedRef.current) {
          setAudioLevel(0);
        } else {
          analyserNodeRef.current.getFloatTimeDomainData(samples);
          setAudioLevel(calculateRmsLevel(samples));
        }
        meterFrameRef.current = requestAnimationFrame(updateMeter);
      };
      meterFrameRef.current = requestAnimationFrame(updateMeter);
    } catch {
      // Non-fatal if AudioContext unavailable for visual meter
    }

    // Start browser SpeechRecognition for real-time captions if supported
    const SpeechRecCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecCtor) {
      try {
        const recognition = new SpeechRecCtor();
        recognition.lang = getBcp47LanguageTag(languageRef.current);
        recognition.interimResults = true;
        recognition.continuous = true;

        recognition.onresult = (event: any) => {
          let fullFinal = '';
          let fullInterim = '';
          for (let i = 0; i < event.results.length; i += 1) {
            const res = event.results[i];
            if (res.isFinal) {
              fullFinal += `${res[0].transcript} `;
            } else {
              fullInterim += `${res[0].transcript} `;
            }
          }
          const combined = `${fullFinal}${fullInterim}`.trim();
          speechTranscriptRef.current = combined;
          if (!isMicMutedRef.current) {
            setInterimCaption(combined);
          }
        };
        recognition.onerror = () => {
          // MediaRecorder buffer remains active as authoritative Gemini transcribe fallback
        };
        recognition.start();
        speechRecRef.current = recognition;
      } catch {
        speechRecRef.current = null;
      }
    }

    // Also record an ephemeral turn clip so browsers without WebSpeech API (Firefox, privacy browsers) still transcribe via Gemini
    if (typeof MediaRecorder !== 'undefined') {
      try {
        const preferredMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
          .find((m) => MediaRecorder.isTypeSupported(m));
        const recorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime })
          : new MediaRecorder(stream);

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0 && !isMicMutedRef.current) {
            recordedChunksRef.current.push(ev.data);
          }
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;
      } catch {
        mediaRecorderRef.current = null;
      }
    }
  }, [stopMicHardware, stopPlaybackOnly]);

  const handleFinishSpeakingTurn = useCallback(async () => {
    if (transportMode === 'gemini-live') {
      commitLiveAccumulatedTurns();
      closeLiveWebSocket();
      stopMicHardware();
      stopPlaybackOnly(false);
      setInterimCaption('');
      setSessionState('idle');
      return;
    }

    setSessionState('processing');
    const capturedWebSpeech = speechTranscriptRef.current.trim();
    const recorder = mediaRecorderRef.current;

    const finalizeAudioBlob = async (): Promise<Blob | null> => {
      if (!recorder || recorder.state === 'inactive') {
        return recordedChunksRef.current.length > 0
          ? new Blob(recordedChunksRef.current, { type: recorder?.mimeType || 'audio/webm' })
          : null;
      }
      return new Promise((resolve) => {
        recorder.onstop = () => {
          const blob =
            recordedChunksRef.current.length > 0
              ? new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
              : null;
          recordedChunksRef.current = [];
          resolve(blob);
        };
        try {
          recorder.stop();
        } catch {
          resolve(null);
        }
      });
    };

    const audioBlob = await finalizeAudioBlob();
    mediaRecorderRef.current = null;
    stopMicHardware();
    setInterimCaption('');

    // Immediately clear recorded chunks array after copying blob reference
    recordedChunksRef.current = [];

    if (capturedWebSpeech) {
      await processTeacherTurnText(capturedWebSpeech, 'stt-voice');
      return;
    }

    if (!audioBlob || audioBlob.size < 128) {
      setSessionState('error');
      setMicErrorDetail(
        'No voice audio was captured (or mic was muted). Try speaking again or type your question below.'
      );
      return;
    }

    try {
      const arrayBuf = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64Audio = btoa(binary);

      const sttRes = await transcribeVoiceClip({
        audioBase64: base64Audio,
        mimeType: audioBlob.type || 'audio/webm',
        language: languageRef.current,
        subjectHint: subjectRef.current,
      });

      await processTeacherTurnText(sttRes.transcript, 'stt-voice');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not transcribe voice clip. Please type your question below.';
      setSessionState('error');
      setMicErrorDetail(msg);
    }
  }, [
    closeLiveWebSocket,
    commitLiveAccumulatedTurns,
    processTeacherTurnText,
    stopMicHardware,
    stopPlaybackOnly,
    transportMode,
  ]);

  const handleStartSpeaking = useCallback(() => {
    lastActiveBeforePauseRef.current = transportMode;
    if (transportMode === 'gemini-live') {
      void startGeminiLiveSession();
    } else {
      if (transportMode === 'text-fallback') {
        setTransportMode('stt-tts-pipeline');
      }
      void startTurnBasedRecording();
    }
  }, [startGeminiLiveSession, startTurnBasedRecording, transportMode]);

  const handleStopSession = useCallback(() => {
    lastActiveBeforePauseRef.current = transportMode;
    const wasSpeakingAudioEl = Boolean(activeAudioElRef.current && !activeAudioElRef.current.paused);

    stopPlaybackOnly(wasSpeakingAudioEl);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore recorder stop errors
      }
      mediaRecorderRef.current = null;
    }
    recordedChunksRef.current = [];

    const hadLiveWs = Boolean(liveWsRef.current);
    wasLiveWsActiveRef.current = hadLiveWs;
    if (liveWsRef.current) {
      commitLiveAccumulatedTurns();
      closeLiveWebSocket();
    }

    stopMicHardware();
    setInterimCaption('');
    setSessionState('paused');
  }, [closeLiveWebSocket, commitLiveAccumulatedTurns, stopMicHardware, stopPlaybackOnly, transportMode]);

  const handleResumeSession = useCallback(() => {
    if (pausedAudioUrlRef.current && activeAudioElRef.current && !isSpeakerMutedRef.current) {
      try {
        activeAudioElRef.current.currentTime = pausedAudioUrlRef.current.currentTime;
        void activeAudioElRef.current.play();
        setSessionState('speaking');
        setPlaybackEngineLabel(`Resumed AI Voice (${voiceName})`);
        pausedAudioUrlRef.current = null;
        return;
      } catch {
        stopPlaybackOnly(false);
      }
    }

    if (lastActiveBeforePauseRef.current === 'gemini-live' && wasLiveWsActiveRef.current) {
      wasLiveWsActiveRef.current = false;
      void startGeminiLiveSession();
    } else {
      wasLiveWsActiveRef.current = false;
      setSessionState('idle');
    }
  }, [startGeminiLiveSession, stopPlaybackOnly, voiceName]);

  const handleToggleMicMute = useCallback(() => {
    setIsMicMuted((prev) => {
      const next = !prev;
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getAudioTracks()) {
          track.enabled = !next;
        }
      }
      if (next) setAudioLevel(0);
      return next;
    });
  }, []);

  const handleToggleSpeakerMute = useCallback(() => {
    setIsSpeakerMuted((prev) => {
      const next = !prev;
      if (next) {
        stopPlaybackOnly(false);
        if (sessionStateRef.current === 'speaking') {
          setSessionState(liveWsRef.current ? 'listening' : 'idle');
        }
      }
      return next;
    });
  }, [stopPlaybackOnly]);

  const handleSubmitTextQuestion = useCallback(
    async (questionText: string, overrideLanguage?: TutorLanguage) => {
      if (overrideLanguage && overrideLanguage !== languageRef.current) {
        languageRef.current = overrideLanguage;
        setLanguage(overrideLanguage);
      }

      // If Gemini Live WebSocket is currently open and listening, forward directly over Live API
      if (
        transportMode === 'gemini-live' &&
        liveWsRef.current &&
        liveWsRef.current.readyState === WebSocket.OPEN
      ) {
        liveInputBufferRef.current = questionText;
        liveWsRef.current.send(JSON.stringify({ type: 'text', text: questionText }));
        setSessionState('processing');
        return;
      }
      await processTeacherTurnText(questionText, 'text');
    },
    [processTeacherTurnText, transportMode]
  );

  const handleRetryMicPermission = useCallback(() => {
    setMicErrorDetail(null);
    if (transportMode === 'text-fallback') {
      setTransportMode('stt-tts-pipeline');
    }
    if (transportMode === 'gemini-live') {
      void startGeminiLiveSession();
    } else {
      void startTurnBasedRecording();
    }
  }, [startGeminiLiveSession, startTurnBasedRecording, transportMode]);

  const handleNewSession = () => {
    stopPlaybackOnly(false);
    stopMicHardware();
    closeLiveWebSocket();
    setTurns([]);
    setTopic('');
    setInterimCaption('');
    setMicErrorDetail(null);
    setActiveSessionId(createSessionId());
    setSessionState('idle');
  };

  const handleLoadSession = (rec: VoiceSessionRecord) => {
    stopPlaybackOnly(false);
    stopMicHardware();
    closeLiveWebSocket();
    setActiveSessionId(rec.id);
    setSubject(rec.subject);
    setTopic(rec.topic);
    setLanguage(rec.language);
    setVoiceName(rec.voiceName);
    setTurns(rec.turns || []);
    setShowHistoryDrawer(false);
    setSessionState('idle');
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userId) return;
    await deleteVoiceSession(userId, id).catch(() => {});
    setSavedSessions((prev) => prev.filter((item) => item.id !== id));
    if (activeSessionId === id) {
      handleNewSession();
    }
  };

  const handleModeChange = (nextMode: VoiceTransportMode) => {
    if (nextMode === transportMode) return;
    stopPlaybackOnly(false);
    stopMicHardware();
    closeLiveWebSocket();
    setInterimCaption('');
    setSessionState('idle');
    setTransportMode(nextMode);
    if (nextMode === 'text-fallback') {
      setMicErrorDetail(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success" size="sm" dot>
              Phase 6 • Voice AI Classroom
            </Badge>
            <Badge variant="purple" size="sm">
              {board} • {classGrade}
            </Badge>
            <Badge variant="default" size="sm">
              <ShieldCheck className="w-3 h-3 mr-1 text-emerald-400" />
              No Audio Recordings Stored
            </Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Mic className="w-7 h-7 text-teal-400 shrink-0" />
            <span>Voice Learning Classroom</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            Speak naturally in Hindi, English, or Bilingual mode — ask questions aloud, interrupt anytime, and review saved transcripts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            data-testid="voice-history-toggle-btn"
            onClick={() => setShowHistoryDrawer((v) => !v)}
            icon={<History className="w-4 h-4" />}
          >
            Transcripts ({savedSessions.length})
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="voice-new-session-btn"
            onClick={handleNewSession}
            icon={<PlusCircle className="w-4 h-4" />}
          >
            New Lesson
          </Button>
        </div>
      </div>

      {/* Classroom Configuration Bar */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div>
          <label
            htmlFor="voice-subject-select"
            className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1"
          >
            Subject
          </label>
          <select
            id="voice-subject-select"
            data-testid="voice-subject-select"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs font-medium text-white focus:outline-none focus:border-teal-500"
          >
            {subjectOptions.map((subj) => (
              <option key={subj} value={subj}>
                {subj}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="voice-topic-input"
            className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1"
          >
            Chapter / Topic (Optional)
          </label>
          <input
            id="voice-topic-input"
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Refraction, Quadratic Eq."
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
          />
        </div>

        <div>
          <label
            htmlFor="voice-language-select"
            className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1"
          >
            Classroom Language
          </label>
          <select
            id="voice-language-select"
            data-testid="voice-language-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value as TutorLanguage)}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs font-medium text-white focus:outline-none focus:border-teal-500"
          >
            <option value="English">English (Indian Academic)</option>
            <option value="Hindi">हिंदी (Hindi Medium)</option>
            <option value="Hinglish">Hinglish (Hindi + English Mix)</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="voice-persona-select"
            className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1"
          >
            Teacher Voice
          </label>
          <select
            id="voice-persona-select"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value as GeminiVoiceName)}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs font-medium text-white focus:outline-none focus:border-teal-500"
          >
            {ALLOWED_VOICE_NAMES.map((v) => (
              <option key={v} value={v}>
                {v} (Natural Teacher)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="voice-transport-select"
            className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1"
          >
            Voice Engine
          </label>
          <select
            id="voice-transport-select"
            data-testid="voice-transport-select"
            value={transportMode}
            onChange={(e) => handleModeChange(e.target.value as VoiceTransportMode)}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs font-medium text-white focus:outline-none focus:border-teal-500"
          >
            <option value="stt-tts-pipeline">STT + Gemini + TTS (Reliable)</option>
            <option value="gemini-live">Gemini Live Audio (Real-Time)</option>
            <option value="text-fallback">Text + Spoken Output</option>
          </select>
        </div>
      </div>

      {/* Saved Transcripts History Panel (Collapsible) */}
      {showHistoryDrawer && (
        <div
          data-testid="voice-saved-history"
          className="rounded-2xl bg-slate-900/95 border border-slate-800 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-teal-400" />
              Saved Classroom Transcripts (Text Only)
            </h2>
            <span className="text-[11px] text-slate-500">Private to your student account</span>
          </div>

          {savedSessions.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">
              No saved voice lessons yet. Ask a question to automatically save a clean text transcript.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {savedSessions.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleLoadSession(item)}
                  className={`p-3 rounded-xl border transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                    item.id === activeSessionId
                      ? 'bg-teal-500/10 border-teal-500/40'
                      : 'bg-slate-950/90 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-bold text-white truncate">{item.title}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {item.subject} · {item.language} · {item.turns.length} turns
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete saved transcript ${item.title}`}
                    onClick={(e) => handleDeleteSession(item.id, e)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Voice Control Stage */}
      <VoiceStateStage
        sessionState={sessionState}
        transportMode={transportMode}
        language={language}
        micPermission={micPermission}
        micErrorDetail={micErrorDetail}
        isMicMuted={isMicMuted}
        isSpeakerMuted={isSpeakerMuted}
        audioLevel={audioLevel}
        interimCaption={interimCaption}
        playbackEngineLabel={playbackEngineLabel}
        onStartSpeaking={handleStartSpeaking}
        onFinishSpeakingTurn={handleFinishSpeakingTurn}
        onStopSession={handleStopSession}
        onResumeSession={handleResumeSession}
        onToggleMicMute={handleToggleMicMute}
        onToggleSpeakerMute={handleToggleSpeakerMute}
        onRetryMicPermission={handleRetryMicPermission}
        onSwitchToTextFallback={() => handleModeChange('text-fallback')}
      />

      {/* Transcript & Text Fallback */}
      <VoiceTranscriptPanel
        turns={turns}
        subject={subject}
        language={language}
        isBusy={sessionState === 'processing' || sessionState === 'connecting'}
        replayingTurnId={replayingTurnId}
        onSubmitTextQuestion={handleSubmitTextQuestion}
        onReplayTurnAudio={(turn) => {
          const textToPlay = turn.spokenScript || turn.text;
          void playTeacherSpeech(textToPlay, turn.language, turn.id);
        }}
      />
    </div>
  );
};
