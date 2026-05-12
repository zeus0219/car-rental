'use client';

import { useEffect, useState } from 'react';
import { apiJson } from './api';
import type { Me } from './me-types';
import { tryParseLocaleCookie } from './public-locale';
import { publicT } from './public-messages';

type Co = { id: string; name: string };

export function useCompanyScope(me: Me | null) {
  const [companies, setCompanies] = useState<Co[]>([]);
  const [companyId, setCompanyId] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!me) {
      return;
    }
    let c = false;
    (async () => {
      try {
        const list = await apiJson<Co[]>('/companies');
        if (c) return;
        if (list.length === 0) {
          setErr(publicT(tryParseLocaleCookie(), 'desk.scope.noCompaniesVisible'));
          return;
        }
        setCompanies(list);
        setCompanyId((prev) => {
          if (prev) return prev;
          const match = list.find((x) => x.id === me.companyId);
          return match?.id ?? list[0]!.id;
        });
      } catch (e) {
        if (!c) {
          setErr(
            e instanceof Error ? e.message : publicT(tryParseLocaleCookie(), 'desk.err.generic'),
          );
        }
      }
    })();
    return () => {
      c = true;
    };
  }, [me]);

  return {
    companies,
    companyId,
    setCompanyId,
    ready: Boolean(me) && companyId.length > 0,
    err,
  };
}
