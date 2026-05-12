import { clearAccessToken, getAccessToken } from './auth-storage';
import { translateDeskApiError } from './desk-api-error-i18n';

export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/v1';
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(`${getApiBase()}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers,
  });
}

/** JSON GET/POST; on 401 clears token and sends user to login. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await apiFetch(path, init);
  if (r.status === 401) {
    clearAccessToken();
    if (typeof window !== 'undefined') {
      window.location.assign('/auth');
    }
    throw new Error(translateDeskApiError('Session expired or invalid'));
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(translateDeskApiError(t || r.statusText));
  }
  return r.json() as Promise<T>;
}

/** GET JSON as a browser download (e.g. GDPR export). */
export async function downloadApiJsonFile(path: string, filename: string) {
  const r = await apiFetch(path);
  if (r.status === 401) {
    clearAccessToken();
    if (typeof window !== 'undefined') {
      window.location.assign('/auth');
    }
    throw new Error(translateDeskApiError('Session expired or invalid'));
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(translateDeskApiError(t || r.statusText));
  }
  const blob = await r.blob();
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(u);
}
