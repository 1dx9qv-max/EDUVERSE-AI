import { auth } from '../lib/firebase';
import { AuthCapabilities, UserProfile } from '../types/auth';
import type {
  AnalyzeDatesheetRequestPayload,
  AnalyzeDatesheetResponsePayload,
} from '../types/datesheet';
import {
  AiApiClientError,
  executeResilientFetch,
  isAiStudioAuthBridgeHostname,
  parseErrorResponse,
  resolveApiUrl,
  type ResilientFetchOptions,
} from './httpDiagnostics';

export {
  AiApiClientError,
  isAiStudioAuthBridgeHostname,
  parseErrorResponse,
  resolveApiUrl,
};

export async function getFirebaseIdToken(): Promise<string | null> {
  if (!auth.currentUser) return null;
  try {
    const token = await auth.currentUser.getIdToken();
    return token || null;
  } catch {
    return null;
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getFirebaseIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type AuthFetchOptions = Omit<ResilientFetchOptions, 'authHeaders'>;

export async function authFetch(
  url: string,
  init: RequestInit = {},
  options: AuthFetchOptions = {}
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  return executeResilientFetch(url, init, {
    ...options,
    authHeaders,
  });
}

export interface HealthStatus {
  status: string;
  platform: string;
  version: string;
  geminiConfigured: boolean;
  timestamp: string;
  supportedBoards: string[];
  supportedGrades: string[];
}

export async function checkBackendHealth(): Promise<HealthStatus> {
  const res = await fetch(resolveApiUrl('/api/health'));
  if (!res.ok) {
    throw new Error(`Health check failed with status: ${res.status}`);
  }
  return res.json();
}

export async function fetchAuthCapabilities(): Promise<AuthCapabilities> {
  const res = await fetch(resolveApiUrl('/api/auth/capabilities'));
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return res.json();
}

export async function checkUsernameOnServer(username: string): Promise<{
  valid: boolean;
  available: boolean;
  normalized: string;
  error?: string;
}> {
  const res = await authFetch(
    `/api/auth/username/check?username=${encodeURIComponent(username)}`
  );
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return res.json();
}

export async function fetchServerProfile(): Promise<UserProfile> {
  const res = await authFetch('/api/auth/profile');
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  const data = await res.json();
  return data.profile;
}

export async function updateServerProfile(
  updates: Partial<UserProfile>
): Promise<UserProfile> {
  const res = await authFetch('/api/auth/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  const data = await res.json();
  return data.profile;
}

export async function deleteAccountOnServer(): Promise<{ deleted: boolean }> {
  const res = await authFetch('/api/auth/account', {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return res.json();
}

export async function analyzeDatesheetFiles(
  payload: AnalyzeDatesheetRequestPayload
): Promise<AnalyzeDatesheetResponsePayload> {
  const res = await authFetch(
    '/api/ai/datesheet/analyze',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 125_000 }
  );
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return res.json();
}
