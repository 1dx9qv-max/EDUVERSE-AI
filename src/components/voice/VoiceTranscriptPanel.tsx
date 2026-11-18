import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  MessageSquareText,
  Send,
  Sparkles,
  User,
  Volume2,
} from 'lucide-react';
import { TutorLanguage } from '../../types/ai';
import { VoiceTurnItem } from '../../types/phase6';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface VoiceTranscriptPanelProps {
  turns: VoiceTurnItem[];
  subject: string;
  language: TutorLanguage;
  isBusy: boolean;
  replayingTurnId: string | null;
  onSubmitTextQuestion: (text: string, overrideLanguage?: TutorLanguage) => Promise<void>;
  onReplayTurnAudio: (turn: VoiceTurnItem) => void;
}

const QUICK_STARTER_PROMPTS: Array<{
  label: string;
  language: TutorLanguage;
  prompt: string;
}> = [
  {
    label: 'English • Physics',
    language: 'English',
    prompt: "Explain Ohm's Law like I am hearing it for the first time, with one daily life example.",
  },
  {
    label: 'Hindi • विज्ञान',
    language: 'Hindi',
    prompt: 'प्रकाश संश्लेषण (Photosynthesis) कैसे होता है? सरल हिंदी में समझाइए।',
  },
  {
    label: 'Bilingual • Math',
    language: 'Bilingual',
    prompt: 'Quadratic formula का discriminant क्या बताता है? Easy bilingual example से समझाएं।',
  },
  {
    label: 'English • Oral Viva Check',
    language: 'English',
    prompt: 'Ask me a short oral viva question on Newton’s Laws and guide me based on my answer.',
  },
];

export const VoiceTranscriptPanel: React.FC<VoiceTranscriptPanelProps> = ({
  turns,
  subject,
  language,
  isBusy,
  replayingTurnId,
  onSubmitTextQuestion,
  onReplayTurnAudio,
}) => {
  const [typedText, setTypedText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length > 0 && scrollListRef.current) {
      scrollListRef.current.scrollTop = scrollListRef.current.scrollHeight;
    }
  }, [turns.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = typedText.trim();
    if (!cleaned || isBusy) return;
    setTypedText('');
    await onSubmitTextQuestion(cleaned);
  };

  return (
    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col overflow-hidden">
      {/* Transcript Header */}
      <div className="px-5 py-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquareText className="w-4 h-4 text-teal-400" />
          <h2 className="text-sm font-bold text-white">Live Classroom Transcript</h2>
          <span className="text-xs text-slate-400 tabular-nums">
            ({turns.length} {turns.length === 1 ? 'turn' : 'turns'})
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          Text-only transcript • Zero raw audio saved
        </span>
      </div>

      {/* Scrollable Transcript Stream */}
      <div
        ref={scrollListRef}
        data-testid="voice-transcript-list"
        className="p-5 space-y-4 min-h-[320px] max-h-[480px] overflow-y-auto"
      >
        {turns.length === 0 ? (
          <div className="py-6 text-center space-y-5">
            <div className="max-w-md mx-auto space-y-1.5">
              <div className="w-11 h-11 rounded-2xl bg-teal-500/15 border border-teal-500/30 text-teal-300 flex items-center justify-center mx-auto mb-3">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white">
                Start a Spoken or Typed {subject} Lesson
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Press the Microphone button above to speak naturally in English, Hindi, or Bilingual mode — or click a starter question below to test your AI Teacher immediately.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-2xl mx-auto text-left">
              {QUICK_STARTER_PROMPTS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={isBusy}
                  onClick={() => onSubmitTextQuestion(item.prompt, item.language)}
                  className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 hover:border-teal-500/40 hover:bg-slate-950 transition-colors text-left cursor-pointer disabled:opacity-50"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 block mb-1">
                    {item.label}
                  </span>
                  <span className="text-xs text-slate-200 line-clamp-2">{item.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => {
            const isStudent = turn.role === 'student';
            return (
              <div
                key={turn.id}
                data-testid={`voice-turn-${turn.role}`}
                className={`flex gap-3 ${isStudent ? 'justify-end' : 'justify-start'}`}
              >
                {!isStudent && (
                  <div className="w-8 h-8 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-300 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 space-y-2 border ${
                    isStudent
                      ? 'bg-indigo-600/20 border-indigo-500/35 text-slate-100'
                      : 'bg-slate-950/90 border-slate-800 text-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">
                        {isStudent ? 'You' : 'AI Teacher'}
                      </span>
                      <Badge variant={isStudent ? 'purple' : 'info'} size="sm">
                        {turn.inputSource === 'live-voice'
                          ? 'Live Voice'
                          : turn.inputSource === 'stt-voice'
                            ? 'Voice'
                            : 'Text'}
                      </Badge>
                      <span className="text-slate-500">{turn.language}</span>
                    </div>

                    {!isStudent && (
                      <button
                        type="button"
                        onClick={() => onReplayTurnAudio(turn)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-400 hover:text-teal-300 cursor-pointer"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        {replayingTurnId === turn.id ? 'Playing...' : 'Replay Voice'}
                      </button>
                    )}
                  </div>

                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{turn.text}</p>

                  {turn.conceptualCheck && (
                    <div className="pt-2 border-t border-slate-800/80 text-xs text-amber-200/95">
                      <span className="font-bold text-amber-400 uppercase tracking-wider text-[10px] mr-1.5">
                        Oral Check:
                      </span>
                      {turn.conceptualCheck}
                    </div>
                  )}
                </div>

                {isStudent && (
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Text Fallback Input Bar (Always Accessible) */}
      <form
        onSubmit={handleSubmit}
        className="p-3.5 border-t border-slate-800/80 bg-slate-950/60 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
      >
        <input
          ref={inputRef}
          type="text"
          data-testid="voice-text-fallback-input"
          value={typedText}
          onChange={(e) => setTypedText(e.target.value)}
          disabled={isBusy}
          placeholder={
            language === 'Hindi'
              ? 'बोल नहीं पा रहे हैं? यहाँ हिंदी या अंग्रेजी में अपना प्रश्न लिखें...'
              : 'Prefer typing or mic unavailable? Type your question in English or Hindi...'
          }
          className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500 disabled:opacity-60"
        />
        <Button
          type="submit"
          size="md"
          variant="primary"
          data-testid="voice-text-submit-btn"
          loading={isBusy}
          disabled={!typedText.trim() || isBusy}
          icon={<Send className="w-4 h-4" />}
        >
          Ask Teacher
        </Button>
      </form>
    </div>
  );
};
