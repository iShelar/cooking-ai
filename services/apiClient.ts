/**
 * Authenticated API client.
 *
 * Wraps `fetch` to automatically include the Firebase ID token as a
 * Bearer token in the `Authorization` header.
 */

import { auth } from './firebase';

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
