import type { PublicMessageKey } from './public-messages';

export function formatDeskSdiAdapter(
  adapter: string,
  t: (key: PublicMessageKey) => string,
): string {
  if (adapter === 'OFF') return t('desk.organization.sdi.optOff');
  if (adapter === 'MOCK') return t('desk.organization.sdi.optMock');
  if (adapter === 'HTTP') return t('desk.organization.sdi.optHttp');
  return adapter;
}

export function formatDeskCargosAdapter(
  adapter: string,
  t: (key: PublicMessageKey) => string,
): string {
  if (adapter === 'MOCK') return t('desk.organization.cargos.optMock');
  if (adapter === 'HTTP') return t('desk.organization.cargos.optHttp');
  if (adapter === 'OFF') return t('desk.organization.cargos.optOff');
  return adapter;
}
