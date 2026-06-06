/**
 * `unwrap` — the bridge between the openapi-fetch client and TanStack Query. openapi-fetch returns
 * `{ data, error, response }`; this throws an `ApiError` on a non-2xx (so React Query's `isError`
 * fires) and returns the parsed body otherwise. The cast to `T` is needed because the backend OpenAPI
 * declares no response schemas (so `data` is typed `never`) — callers pass the hand-written response
 * type. Remove the cast once the backend ships `@ApiResponse` DTOs (flagged follow-up). — CLAUDE §13
 */
import { ApiError } from '../api/apiError';

interface FetchResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/** The server's error body — the contract envelope `{ error: { code, message, details } }` (arch §5.1). */
interface ErrorEnvelope {
  error?: { code?: string; message?: unknown; details?: unknown };
}

/** Pull the human message from the envelope (`body.error.message`), falling back to a legacy `body.message`. */
function messageFrom(body: unknown, response: Response): string {
  if (body && typeof body === 'object') {
    const enveloped = (body as ErrorEnvelope).error?.message;
    const legacy = (body as { message?: unknown }).message;
    const m = enveloped ?? legacy;
    if (Array.isArray(m)) return m.join(', ');
    if (m) return String(m);
  }
  return response.statusText || `Request failed (${response.status})`;
}

/** The structured `details` from the envelope (so e.g. billing's `unpriced` stays reachable), legacy → body. */
function detailsFrom(body: unknown): unknown {
  if (body && typeof body === 'object' && 'error' in body) {
    return (body as ErrorEnvelope).error?.details ?? (body as ErrorEnvelope).error;
  }
  return body;
}

export async function unwrap<T>(promise: Promise<FetchResult>): Promise<T> {
  const { data, error, response } = await promise;
  if (!response.ok) {
    // Read the contract envelope: `error.message` for the toast, `error.details` for structured payloads.
    throw new ApiError(response.status, messageFrom(error, response), detailsFrom(error));
  }
  return data as T;
}
