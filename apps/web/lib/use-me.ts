'use client';

import { useEffect, useState } from 'react';
import { apiJson } from './api';
import type { Me } from './me-types';
import { tryParseLocaleCookie } from './public-locale';
import { publicT } from './public-messages';

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const u = await apiJson<Me>('/auth/me');
        if (!c) setMe(u);
      } catch (e) {
        if (!c) {
          setError(
            e instanceof Error ? e.message : publicT(tryParseLocaleCookie(), 'desk.err.generic'),
          );
        }
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  return { me, loading, error };
}
