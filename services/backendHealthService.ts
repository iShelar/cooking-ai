/**
 * Backend health check. Pings GET /api/health (no auth required).
 * Used to show "Start the backend" banner when the server is down.
 */

const HEALTH_URL = '/api/health';
const HEALTH_TIMEOUT_MS = 5000;

export interface HealthResult {
  ok: boolean;
  status?: number;
}

/**
 * Check if the backend is reachable. Returns { ok: true } if /api/health returns 200.
 */
export async function checkBackendHealth(): Promise<HealthResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(HEALTH_URL, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false };
  }
}
