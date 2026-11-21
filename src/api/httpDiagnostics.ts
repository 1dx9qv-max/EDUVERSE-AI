export class AiApiClientError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;

  constructor(statusCode: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = 'AiApiClientError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

export function isAiStudioAuthBridgeHostname(hostname: string): boolean {
  return /^ais-(?:dev|pre)-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/i.test(hostname);
}

export function resolveApiUrl(
  path: string,
  options?: { apiBaseUrl?: string; currentOrigin?: string; currentHostname?: string }
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const rawBase =
    options?.apiBaseUrl !== undefined
      ? options.apiBaseUrl
      : typeof import.meta !== 'undefined' && import.meta.env
        ? (import.meta.env.VITE_API_BASE_URL as string | undefined)
        : undefined;
  let base = (rawBase || '').trim().replace(/\/+$/, '');
  if (!base) {
    return normalizedPath;
  }

  if (normalizedPath.startsWith('/api/') && base.toLowerCase().endsWith('/api')) {
    base = base.slice(0, -4).replace(/\/+$/, '');
  }

  const winOrigin =
    options?.currentOrigin ??
    (typeof window !== 'undefined' && window.location ? window.location.origin : '');
  const winHost =
    options?.currentHostname ??
    (typeof window !== 'undefined' && window.location ? window.location.hostname : '');

  if (winOrigin && winHost) {
    try {
      const parsed = new URL(base);
      const isCurrentlyLocal = winHost === 'localhost' || winHost === '127.0.0.1';
      const isBaseLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

      if ((!isCurrentlyLocal && isBaseLocal) || parsed.origin === winOrigin) {
        return normalizedPath;
      }
      if (!isCurrentlyLocal && isAiStudioAuthBridgeHostname(parsed.hostname)) {
        return normalizedPath;
      }
      return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}${normalizedPath}`;
    } catch {
      return normalizedPath;
    }
  }

  return `${base}${normalizedPath}`;
}

export interface ResilientFetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  currentOrigin?: string;
  currentHostname?: string;
  isOnline?: boolean;
  authHeaders?: Record<string, string>;
}

export async function probeSameOriginBackendHealth(
  fetchImpl: typeof fetch
): Promise<'ok' | 'auth_redirect' | 'http_error' | 'unreachable'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_500);
  try {
    const res = await fetchImpl('/api/health', {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return 'auth_redirect';
    }
    if (res.ok) {
      return 'ok';
    }
    return 'http_error';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

export async function executeResilientFetch(
  url: string,
  init: RequestInit = {},
  options: ResilientFetchOptions = {}
): Promise<Response> {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 35_000;
  const normalizedPath = url.startsWith('/') ? url : `/${url}`;
  const targetUrl = resolveApiUrl(normalizedPath, {
    apiBaseUrl: options.apiBaseUrl,
    currentOrigin: options.currentOrigin,
    currentHostname: options.currentHostname,
  });

  const browserOnline =
    options.isOnline !== undefined
      ? options.isOnline
      : typeof navigator !== 'undefined'
        ? navigator.onLine
        : true;

  if (browserOnline === false) {
    throw new AiApiClientError(
      0,
      'OFFLINE',
      'Your browser appears to be offline. Reconnect to the internet and retry.',
      true
    );
  }

  const runTimedFetch = async (requestUrl: string): Promise<Response> => {
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (init.signal) {
      if (init.signal.aborted) {
        controller.abort();
      } else {
        init.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(requestUrl, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers || {}),
          ...(options.authHeaders || {}),
        },
      });
      if (response.type === 'opaqueredirect') {
        throw new AiApiClientError(
          401,
          'PREVIEW_AUTH_EXPIRED',
          'Your preview session redirected to sign-in. Reload the page and retry.',
          true
        );
      }
      return response;
    } catch (err) {
      if (err instanceof AiApiClientError) {
        throw err;
      }
      if (timedOut) {
        throw new AiApiClientError(
          504,
          'CLIENT_TIMEOUT',
          'The request timed out waiting for the EDUVERSE AI server. Please retry with a clearer or smaller file.',
          true
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (init.signal) {
        init.signal.removeEventListener('abort', onExternalAbort);
      }
    }
  };

  try {
    return await runTimedFetch(targetUrl);
  } catch (err) {
    if (err instanceof AiApiClientError) {
      throw err;
    }

    const stillOnline =
      options.isOnline !== undefined
        ? options.isOnline
        : typeof navigator !== 'undefined'
          ? navigator.onLine
          : true;

    if (stillOnline === false) {
      throw new AiApiClientError(
        0,
        'OFFLINE',
        'Your internet connection dropped during the request. Reconnect and retry.',
        true
      );
    }

    const effectiveOrigin =
      options.currentOrigin ??
      (typeof window !== 'undefined' && window.location ? window.location.origin : '');
    const isCrossOriginTarget =
      /^https?:\/\//i.test(targetUrl) &&
      (!effectiveOrigin || !targetUrl.startsWith(effectiveOrigin));

    const probe = await probeSameOriginBackendHealth(fetchImpl);
    if (isCrossOriginTarget && probe === 'ok') {
      try {
        return await runTimedFetch(normalizedPath);
      } catch (fallbackErr) {
        if (fallbackErr instanceof AiApiClientError) {
          throw fallbackErr;
        }
      }
    }

    if (probe === 'auth_redirect') {
      throw new AiApiClientError(
        401,
        'PREVIEW_AUTH_EXPIRED',
        'Your AI Studio preview authentication cookie expired or was blocked. Refresh the page and retry.',
        true
      );
    }

    if (probe === 'ok') {
      throw new AiApiClientError(
        0,
        'CONNECTION_DROPPED',
        'The EDUVERSE AI server is online (/api/health OK), but this request connection closed before a response arrived. Try a smaller file or retry.',
        true
      );
    }

    if (probe === 'http_error') {
      throw new AiApiClientError(
        502,
        'BACKEND_UNAVAILABLE',
        'The EDUVERSE AI API route returned an upstream gateway error. Please retry shortly.',
        true
      );
    }

    throw new AiApiClientError(
      0,
      isCrossOriginTarget ? 'CORS_OR_API_URL_ERROR' : 'SERVER_UNREACHABLE',
      isCrossOriginTarget
        ? 'Could not connect to the configured API server URL (CORS or unreachable host). Verify deployment API configuration and retry.'
        : 'Cannot reach the EDUVERSE AI backend API server (/api/health unreachable). Ensure the server is running and retry.',
      true
    );
  }
}

export async function parseErrorResponse(res: Response): Promise<AiApiClientError> {
  const contentType = (res.headers?.get('content-type') || '').toLowerCase();
  let data: { error?: string; code?: string; retryable?: boolean } = {};
  let parsedJson = false;
  try {
    data = await res.json();
    parsedJson = Boolean(data && typeof data === 'object');
  } catch {
    // Non-JSON response body (e.g. proxy HTML 502/504/413)
  }
  let endpointPath = '';
  try {
    endpointPath = res.url ? new URL(res.url).pathname : '';
  } catch {
    endpointPath = res.url || '';
  }
  const isAiEndpoint = endpointPath.includes('/api/ai/');
  const serviceLabel = isAiEndpoint ? 'AI service' : 'API service';

  const fallbackMessage =
    res.status === 413
      ? 'Uploaded files exceed the server limit. Please keep total datesheet files under 6 MB.'
      : res.status === 405
        ? `Request rejected with HTTP 405 (Method Not Allowed)${endpointPath ? ` on ${endpointPath}` : ''}.`
        : !parsedJson && contentType.includes('text/html')
          ? `Server proxy returned HTTP ${res.status} (non-JSON response)${endpointPath ? ` on ${endpointPath}` : ''}. Please retry.`
          : `${serviceLabel} error (HTTP ${res.status}). Please retry.`;

  const message = data.error || fallbackMessage;
  const code =
    data.code ||
    (res.status === 413
      ? 'PAYLOAD_TOO_LARGE'
      : res.status === 405
        ? 'METHOD_NOT_ALLOWED'
        : !parsedJson && res.status >= 500
          ? `UPSTREAM_HTTP_${res.status}`
          : `HTTP_${res.status}`);

  return new AiApiClientError(
    res.status,
    code,
    message,
    Boolean(data.retryable ?? (res.status >= 500 || res.status === 429))
  );
}
