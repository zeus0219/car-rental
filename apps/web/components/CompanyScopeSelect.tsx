'use client';

import type { Me } from '../lib/me-types';
import { usePublicLocaleContext } from './PublicLocaleProvider';

type Co = { id: string; name: string };

export function CompanyScopeSelect(props: {
  me: Me;
  companies: Co[];
  companyId: string;
  onChange: (id: string) => void;
}) {
  const { me, companies, companyId, onChange } = props;
  const { t } = usePublicLocaleContext();
  if (companies.length <= 1) {
    return null;
  }
  return (
    <div className="desk-tool">
      <label>
        {t('desk.scope.company')}
        <select
          value={companyId}
          onChange={(e) => onChange(e.target.value)}
          disabled={me.role !== 'ADMIN'}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {me.role !== 'ADMIN' && <span className="desk-muted">{t('desk.scope.yourCompanyOnly')}</span>}
    </div>
  );
}
