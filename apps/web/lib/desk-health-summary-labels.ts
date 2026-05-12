import type { PublicMessageKey } from './public-messages';

export function formatDeskHealthSummaryStatus(
  status: string | undefined,
  t: (key: PublicMessageKey) => string,
): string {
  if (status === 'ok') return t('desk.api.summaryStatus.ok');
  if (status === 'degraded') return t('desk.api.summaryStatus.degraded');
  if (status === 'error') return t('desk.api.summaryStatus.error');
  return status ?? '—';
}

export function formatDeskHealthDbState(
  db: string | null | undefined,
  t: (key: PublicMessageKey) => string,
): string {
  if (db === 'up') return t('desk.api.dbState.up');
  if (db === 'down') return t('desk.api.dbState.down');
  return db ?? '—';
}
