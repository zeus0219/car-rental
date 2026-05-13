'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { clearAccessToken, getAccessToken } from './auth-storage';
import type { Me } from './me-types';

/**
 * For **public** layout (e.g. `SiteHeader`): loads `GET /auth/me` when a token exists.
 * Does **not** redirect on 401 (unlike `useMe` / `apiJson`) — clears stale token and returns `null`.
 */
export function useStaffSessionOptional() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!getAccessToken()) {
        if (!cancelled) {
          setMe(null);
          setReady(true);
        }
        return;
      }
      try {
        const r = await apiFetch('/auth/me');
        if (cancelled) return;
        if (r.status === 401) {
          clearAccessToken();
          setMe(null);
        } else if (r.ok) {
          setMe((await r.json()) as Me);
        } else {
          setMe(null);
        }
      } catch {
        if (!cancelled) setMe(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { me, ready };
}
