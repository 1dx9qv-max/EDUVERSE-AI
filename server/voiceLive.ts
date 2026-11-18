import type http from 'node:http';
import type net from 'node:net';
import { GoogleGenAI, type LiveServerMessage, Modality, type Session } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { normalizeLanguageForTutor } from '../src/utils/aiValidation.ts';
import { screenAgeAppropriateContent } from '../src/utils/securityEngine.ts';
import { buildVoiceClassroomInstruction, normalizeVoiceName } from '../src/utils/voiceEngine.ts';
import { verifyFirebaseIdToken } from './firebaseJwt.ts';

const attachedServers = new WeakSet<http.Server>();

function getLiveAiClient(apiVersion = 'v1alpha'): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    apiVersion,
    httpOptions: {
      apiVersion,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function safeWsSend(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachVoiceLiveWebSocket(server: http.Server): void {
  if (attachedServers.has(server)) return;
  attachedServers.add(server);

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const rawUrl = request.url || '';
    const pathname = rawUrl.split('?')[0];
    if (pathname !== '/ws/voice-live') {
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (clientWs: WebSocket, request: http.IncomingMessage) => {
    let liveSession: Session | null = null;
    let liveSessionPromise: Promise<Session> | null = null;
    let isClosing = false;

    const reqUrl = new URL(request.url || '/ws/voice-live', 'http://localhost');
    const urlToken = (reqUrl.searchParams.get('token') || '').trim();
    let verifiedUid: string | null = null;
    const urlAuthPromise = urlToken
      ? verifyFirebaseIdToken(urlToken)
          .then((res) => {
            verifiedUid = res.uid;
            return res.uid;
          })
          .catch(() => null)
      : Promise.resolve(null);

    const ai = getLiveAiClient();
    safeWsSend(clientWs, {
      type: 'ready',
      liveSupported: Boolean(ai),
      model: 'gemini-3.8-live',
    });

    const closeLiveSession = () => {
      liveSessionPromise = null;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // Ignore already-closed live session errors
        }
        liveSession = null;
      }
    };

    clientWs.on('message', async (rawData) => {
      if (isClosing) return;
      let parsed: Record<string, any>;
      try {
        parsed = JSON.parse(rawData.toString());
      } catch {
        safeWsSend(clientWs, {
          type: 'error',
          code: 'INVALID_WS_JSON',
          message: 'Malformed WebSocket message received.',
        });
        return;
      }

      if (parsed.type === 'start') {
        if (!verifiedUid) {
          await urlAuthPromise;
        }
        if (!verifiedUid && typeof parsed.idToken === 'string' && parsed.idToken.trim()) {
          try {
            const verified = await verifyFirebaseIdToken(parsed.idToken.trim());
            verifiedUid = verified.uid;
          } catch {
            verifiedUid = null;
          }
        }
        if (!verifiedUid) {
          safeWsSend(clientWs, {
            type: 'error',
            code: 'UNAUTHENTICATED',
            message: 'Authentication is required to use the Live Voice classroom.',
          });
          return;
        }

        if (!ai) {
          safeWsSend(clientWs, {
            type: 'error',
            code: 'GEMINI_NOT_CONFIGURED',
            message: 'Gemini API key is not configured on the server for Live Audio.',
          });
          return;
        }

        closeLiveSession();

        const cfg = parsed.config || {};
        const subject = String(cfg.subject || 'Science').trim().slice(0, 80);
        const topic = String(cfg.topic || '').trim().slice(0, 140);
        const classGrade = String(cfg.classGrade || 'Class 10').trim().slice(0, 30);
        const board = String(cfg.board || 'CBSE').trim().slice(0, 32);
        const language = normalizeLanguageForTutor(cfg.language);
        const voiceName = normalizeVoiceName(cfg.voiceName);

        try {
          const systemInstruction = buildVoiceClassroomInstruction({
            subject,
            topic: topic || undefined,
            classGrade,
            board,
            language,
          });

          liveSessionPromise = ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction,
            },
            callbacks: {
              onopen: () => {
                // Resolved session is assigned before notifying clientWs below
              },
              onmessage: (message: LiveServerMessage) => {
                const content = message.serverContent;
                if (content?.inputTranscription?.text) {
                  safeWsSend(clientWs, {
                    type: 'inputTranscript',
                    text: content.inputTranscription.text,
                  });
                }
                if (content?.outputTranscription?.text) {
                  safeWsSend(clientWs, {
                    type: 'outputTranscript',
                    text: content.outputTranscription.text,
                  });
                }
                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    safeWsSend(clientWs, {
                      type: 'audio',
                      data: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                    });
                  }
                }
                if (content?.interrupted) {
                  safeWsSend(clientWs, { type: 'interrupted' });
                }
                if (content?.turnComplete) {
                  safeWsSend(clientWs, { type: 'turnComplete' });
                }
              },
              onerror: (err: unknown) => {
                const detail =
                  err instanceof Error
                    ? err.message
                    : typeof (err as any)?.message === 'string'
                      ? (err as any).message
                      : typeof (err as any)?.error?.message === 'string'
                        ? (err as any).error.message
                        : 'Gemini Live session error.';
                console.warn('[Voice Live WS] Live callback error:', detail);
                safeWsSend(clientWs, {
                  type: 'error',
                  code: 'LIVE_SESSION_ERROR',
                  message: detail,
                });
              },
              onclose: (ev: any) => {
                liveSession = null;
                liveSessionPromise = null;
                if (!isClosing) {
                  safeWsSend(clientWs, {
                    type: 'liveClosed',
                    reason: typeof ev?.reason === 'string' ? ev.reason : undefined,
                  });
                }
              },
            },
          });

          const session = await liveSessionPromise;

          if (isClosing || clientWs.readyState !== WebSocket.OPEN) {
            session.close();
            return;
          }
          liveSession = session;
          safeWsSend(clientWs, {
            type: 'connected',
            voiceName,
            language,
            model: 'gemini-3.8-live',
          });
        } catch (err) {
          liveSessionPromise = null;
          const msg =
            err instanceof Error
              ? err.message
              : 'Could not connect to Gemini Live Audio model right now.';
          console.warn('[Voice Live WS] Connect failed:', msg);
          safeWsSend(clientWs, {
            type: 'error',
            code: 'LIVE_CONNECT_FAILED',
            message: msg,
          });
        }
        return;
      }

      if (parsed.type === 'audio' && typeof parsed.data === 'string' && liveSessionPromise) {
        try {
          const session = liveSession || (await liveSessionPromise);
          session.sendRealtimeInput({
            audio: {
              data: parsed.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed sending audio frame.';
          safeWsSend(clientWs, { type: 'error', code: 'LIVE_AUDIO_SEND_FAILED', message: msg });
        }
        return;
      }

      if (parsed.type === 'text' && typeof parsed.text === 'string' && liveSessionPromise) {
        const cleanText = parsed.text.trim().slice(0, 1800);
        if (!cleanText) return;
        const safety = screenAgeAppropriateContent(cleanText);
        if (!safety.safe) {
          safeWsSend(clientWs, {
            type: 'error',
            code: 'AGE_SAFETY_BLOCKED',
            message: safety.reason || 'Message blocked by K-12 student safety policy.',
          });
          return;
        }
        try {
          const session = liveSession || (await liveSessionPromise);
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: cleanText }] }],
            turnComplete: true,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed sending text message to Live session.';
          safeWsSend(clientWs, { type: 'error', code: 'LIVE_TEXT_SEND_FAILED', message: msg });
        }
        return;
      }

      if (parsed.type === 'stop') {
        closeLiveSession();
        safeWsSend(clientWs, { type: 'stopped' });
      }
    });

    clientWs.on('close', () => {
      isClosing = true;
      closeLiveSession();
    });

    clientWs.on('error', () => {
      isClosing = true;
      closeLiveSession();
    });
  });
}
