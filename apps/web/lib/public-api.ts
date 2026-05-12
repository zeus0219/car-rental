/** Unauthenticated /v1/public/... (no Bearer token). CORS + API throttling apply. */

import { translateDeskApiError, translateHttpErrorWithoutBody } from './desk-api-error-i18n';

export function getPublicApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/v1';
}

function urlFor(path: string) {
  return `${getPublicApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
}

function errorFromResponse(r: Response, text: string): Error {
  const trimmed = text.trim();
  if (trimmed) {
    return new Error(translateDeskApiError(trimmed));
  }
  const st = (r.statusText ?? '').replace(/\s+/g, ' ').trim();
  if (st) {
    return new Error(translateDeskApiError(st));
  }
  return new Error(translateHttpErrorWithoutBody(r.status));
}

export async function fetchPublicJson<T>(path: string): Promise<T> {
  const r = await fetch(urlFor(path), { cache: 'no-store' });
  const text = await r.text();
  if (!r.ok) {
    throw errorFromResponse(r, text);
  }
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export async function postPublicJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(urlFor(path), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    throw errorFromResponse(r, text);
  }
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}
