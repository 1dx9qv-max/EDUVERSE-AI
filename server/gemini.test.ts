import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiServiceError, mapGeminiError } from './gemini.ts';

test('mapGeminiError classifies 503 high-demand / UNAVAILABLE errors cleanly without leaking raw JSON', () => {
  const errWithJson = new Error(
    '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}'
  );
  const mapped = mapGeminiError(errWithJson);

  assert.ok(mapped instanceof GeminiServiceError);
  assert.equal(mapped.statusCode, 503);
  assert.equal(mapped.code, 'MODEL_OVERLOADED');
  assert.equal(mapped.retryable, true);
  assert.doesNotMatch(mapped.message, /"error"|\{code|"code"/);
  assert.match(mapped.message, /high demand/i);

  const errWithStatus = Object.assign(new Error('Service overloaded'), { status: 503 });
  const mappedStatus = mapGeminiError(errWithStatus);
  assert.equal(mappedStatus.statusCode, 503);
  assert.equal(mappedStatus.code, 'MODEL_OVERLOADED');
  assert.equal(mappedStatus.retryable, true);
});

test('mapGeminiError handles rate-limit, timeout, auth, and unmapped errors safely', () => {
  const rateLimit = mapGeminiError(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }));
  assert.equal(rateLimit.statusCode, 429);
  assert.equal(rateLimit.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(rateLimit.retryable, true);

  const timeout = mapGeminiError(new Error('MODEL_TIMEOUT'));
  assert.equal(timeout.statusCode, 504);
  assert.equal(timeout.code, 'MODEL_TIMEOUT');
  assert.equal(timeout.retryable, true);

  const unmapped = mapGeminiError(new Error('{"internal_debug_blob":"should_not_leak_to_client"}'));
  assert.equal(unmapped.statusCode, 502);
  assert.equal(unmapped.code, 'AI_GENERATION_FAILED');
  assert.equal(unmapped.retryable, true);
  assert.doesNotMatch(unmapped.message, /internal_debug_blob/);
});
