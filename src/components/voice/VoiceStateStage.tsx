import React from 'react';
import {
  AlertTriangle,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { TutorLanguage } from '../../types/ai';
import {
  MicPermissionState,
  VoiceSessionState,
  VoiceTransportMode,
} from '../../types/phase6';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface VoiceStateStageProps {
  sessionState: VoiceSessionState;
  transportMode: VoiceTransportMode;
  language: TutorLanguage;
  micPermission: MicPermissionState;
  micErrorDetail: string | null;
  isMicMuted: boolean;
  isSpeakerMuted: boolean;
  audioLevel: number;
  interimCaption: string;
  playbackEngineLabel: string | null;
  onStartSpeaking: () => void;
  onFinishSpeakingTurn: () => void;
  onStopSession: () => void;
  onResumeSession: () => void;
  onToggleMicMute: () => void;
  onToggleSpeakerMute: () => void;
  onRetryMicPermission: () => void;
  onSwitchToTextFallback: () => void;
}

const STATE_CONFIG: Record<
  VoiceSessionState,
  { label: string; sublabel: string; badgeVariant: 'default' | 'info' | 'success' | 'warning' | 'purple' | 'rose' }
> = {
  idle: {
    label: 'Ready',
    sublabel: 'Tap Microphone to speak, or ask your question in the text box below.',
    badgeVariant: 'default',
  },
  connecting: {
    label: 'Connecting Live Classroom',
    sublabel: 'Opening secure real-time Gemini Live Audio stream...',
    badgeVariant: 'info',
  },
  listening: {
    label: 'Listening',
    sublabel: 'Speak naturally — your AI Teacher is listening attentively.',
    badgeVariant: 'success',
  },
  processing: {
    label: 'Processing',
    sublabel: 'Understanding your question and preparing a patient explanation...',
    badgeVariant: 'purple',
  },
  speaking: {
    label: 'Speaking',
    sublabel: 'AI Teacher is explaining aloud. Tap Stop anytime to interrupt.',
    badgeVariant: 'info',
  },
  paused: {
    label: 'Paused',
    sublabel: 'Session paused. Tap Resume to continue or type anytime.',
    badgeVariant: 'warning',
  },
  error: {
    label: 'Attention Needed',
    sublabel: 'Voice input hit an issue — Text Fallback remains active below.',
    badgeVariant: 'rose',
  },
};

export const VoiceStateStage: React.FC<VoiceStateStageProps> = ({
  sessionState,
  transportMode,
  language,
  micPermission,
  micErrorDetail,
  isMicMuted,
  isSpeakerMuted,
  audioLevel,
  interimCaption,
  playbackEngineLabel,
  onStartSpeaking,
  onFinishSpeakingTurn,
  onStopSession,
  onResumeSession,
  onToggleMicMute,
  onToggleSpeakerMute,
  onRetryMicPermission,
  onSwitchToTextFallback,
}) => {
  const meta = STATE_CONFIG[sessionState];
  const micBlocked =
    micPermission === 'denied' || micPermission === 'no-device' || micPermission === 'unsupported';
  const isListening = sessionState === 'listening';
  const isProcessing = sessionState === 'processing' || sessionState === 'connecting';
  const isSpeaking = sessionState === 'speaking';
  const isPaused = sessionState === 'paused';

  const barMultipliers = [0.45, 0.72, 1, 0.85, 0.6, 0.92, 0.55, 0.78, 0.5];

  return (
    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 space-y-5">
      {/* Top Status & Mode Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={meta.badgeVariant} size="md" dot>
            <span data-testid="voice-state-label">{meta.label}</span>
          </Badge>
          <Badge variant="default" size="sm">
            <Radio className="w-3 h-3 mr-1 text-teal-400" />
            {transportMode === 'gemini-live'
              ? 'Gemini Live Audio'
              : transportMode === 'stt-tts-pipeline'
                ? 'Voice Turn (STT + Gemini + TTS)'
                : 'Text Fallback Active'}
          </Badge>
          <Badge variant="purple" size="sm">
            {language === 'Hindi'
              ? 'हिंदी (Hindi)'
              : language === 'Hinglish' || language === 'Bilingual'
                ? 'Hinglish (HI + EN)'
                : 'English'}
          </Badge>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/90">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span>Audio is ephemeral • Raw recordings never stored</span>
        </div>
      </div>

      {/* Central Interactive Stage */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4 w-full md:w-auto">
          {/* Primary Microphone Control */}
          <button
            type="button"
            data-testid="voice-mic-button"
            disabled={isProcessing || (micBlocked && !isListening)}
            onClick={isListening ? onFinishSpeakingTurn : onStartSpeaking}
            aria-label={
              isListening
                ? 'Stop listening and send question'
                : micBlocked
                  ? 'Microphone unavailable'
                  : 'Start speaking'
            }
            className={`relative w-16 h-16 rounded-2xl flex items-center justify-center transition-all border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${
              isListening
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-lg shadow-emerald-600/30'
                : isSpeaking
                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-600/30'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400/40 shadow-lg shadow-indigo-600/25'
            }`}
          >
            {isProcessing ? (
              <Loader2 className="w-7 h-7 animate-spin" />
            ) : isMicMuted ? (
              <MicOff className="w-7 h-7" />
            ) : isListening ? (
              <Square className="w-6 h-6 fill-current" />
            ) : (
              <Mic className="w-7 h-7" />
            )}
          </button>

          <div className="space-y-1 min-w-0">
            <p className="text-sm font-bold text-white">
              {isListening
                ? isMicMuted
                  ? 'Microphone Muted (Listening Paused)'
                  : transportMode === 'gemini-live'
                    ? 'Live Voice Active — Speak Anytime'
                    : 'Listening — Tap Square to Finish Turn'
                : isSpeaking
                  ? 'AI Teacher Speaking'
                  : isProcessing
                    ? 'Thinking & Preparing Explanation...'
                    : isPaused
                      ? 'Classroom Paused'
                      : micBlocked
                        ? 'Microphone Unavailable — Type Below'
                        : 'Tap Microphone to Ask Aloud'}
            </p>
            <p className="text-xs text-slate-400">{meta.sublabel}</p>
            {playbackEngineLabel && isSpeaking && (
              <p className="text-[11px] text-indigo-300 flex items-center gap-1">
                <Headphones className="w-3 h-3" />
                Audio Engine: {playbackEngineLabel}
              </p>
            )}
          </div>
        </div>

        {/* Acoustic / Speaking Equalizer Indicator */}
        <div
          className="flex items-end justify-center gap-1.5 h-12 pb-2 px-4 rounded-xl bg-slate-950/80 border border-slate-800/80 w-full md:w-48 shrink-0"
          aria-hidden="true"
        >
          {barMultipliers.map((mult, idx) => {
            let heightPx = 6;
            let barColor = 'bg-slate-700';
            if (isListening && !isMicMuted) {
              const activeBase = Math.max(0.18, audioLevel);
              heightPx = Math.round(8 + activeBase * mult * 28);
              barColor = 'bg-emerald-400';
            } else if (isSpeaking && !isSpeakerMuted) {
              heightPx = Math.round(12 + mult * 22);
              barColor = 'bg-indigo-400 animate-pulse';
            } else if (isProcessing) {
              heightPx = Math.round(10 + mult * 14);
              barColor = 'bg-purple-400 animate-pulse';
            }
            return (
              <span
                key={idx}
                className={`w-1.5 rounded-full transition-all duration-100 ${barColor}`}
                style={{ height: `${heightPx}px` }}
              />
            );
          })}
        </div>

        {/* Transport & Mute Controls */}
        <div className="flex flex-wrap items-center justify-center md:justify-end gap-2 w-full md:w-auto">
          {(isListening || isSpeaking || isProcessing) && (
            <Button
              size="sm"
              variant="danger"
              data-testid="voice-stop-btn"
              onClick={onStopSession}
              icon={<Pause className="w-3.5 h-3.5" />}
            >
              Stop
            </Button>
          )}

          {isPaused && (
            <Button
              size="sm"
              variant="primary"
              data-testid="voice-resume-btn"
              onClick={onResumeSession}
              icon={<Play className="w-3.5 h-3.5" />}
            >
              Resume
            </Button>
          )}

          <Button
            size="sm"
            variant={isMicMuted ? 'danger' : 'secondary'}
            data-testid="voice-mute-mic-btn"
            onClick={onToggleMicMute}
            aria-pressed={isMicMuted}
            icon={isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          >
            {isMicMuted ? 'Mic Muted' : 'Mute Mic'}
          </Button>

          <Button
            size="sm"
            variant={isSpeakerMuted ? 'danger' : 'secondary'}
            data-testid="voice-mute-speaker-btn"
            onClick={onToggleSpeakerMute}
            aria-pressed={isSpeakerMuted}
            icon={
              isSpeakerMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />
            }
          >
            {isSpeakerMuted ? 'Audio Muted' : 'Mute Voice'}
          </Button>
        </div>
      </div>

      {/* Live Interim Captions */}
      {interimCaption && (
        <div
          data-testid="voice-interim-caption"
          className="px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-200 flex items-center gap-2"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="font-medium">Hearing:</span>
          <span className="italic">{interimCaption}</span>
        </div>
      )}

      {/* Microphone Permission / Browser Capability Fallback Notice */}
      {micErrorDetail && (
        <div
          data-testid="voice-mic-notice"
          className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-amber-100">
                {micPermission === 'denied'
                  ? 'Microphone Permission Blocked'
                  : micPermission === 'no-device'
                    ? 'No Microphone Detected'
                    : micPermission === 'unsupported'
                      ? 'Browser Voice Input Unavailable'
                      : 'Voice Connection Notice'}
              </p>
              <p className="text-amber-200/90 leading-relaxed">{micErrorDetail}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={onRetryMicPermission}>
              Retry Mic
            </Button>
            {transportMode !== 'text-fallback' && (
              <Button size="sm" variant="secondary" onClick={onSwitchToTextFallback}>
                Use Text Mode
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
