/**
 * Authenticated API client.
 *
 * Wraps `fetch` to automatically include the Firebase ID token as a
 * Bearer token in the `Authorization` header.
 */

import { auth } from './firebase';

/** User-facing message when the API returns 429 (rate limit exceeded). */
export const RATE_LIMIT_MESSAGE =
  "We're getting a lot of requests right now. Please try again in a few minutes.";

/**
 * Throws a user-friendly error if the response is 429 (rate limit).
 * Call this after apiFetch() and before reading the body so the UI can show the message.
 */
export function checkRateLimit(res: Response): void {
  if (res.status === 429) {
    throw new Error(RATE_LIMIT_MESSAGE);
  }
}

/**
 * Make an authenticated fetch request to the backend.
 * Automatically attaches `Authorization: Bearer <idToken>`.
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await auth.currentUser?.getIdToken();

  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, { ...options, headers });
}

/**
 * Get the current user's Firebase ID token (for WebSocket auth).
 * Returns `null` if the user is not signed in.
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    return (await auth.currentUser?.getIdToken()) ?? null;
  } catch {
    return null;
  }
}
