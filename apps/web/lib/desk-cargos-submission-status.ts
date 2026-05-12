import type { PublicMessageKey } from './public-messages';

const CARGOS_SUBMISSION_STATUS_KEYS: Record<string, PublicMessageKey> = {
  PENDING: 'desk.reports.enum.cargos.PENDING',
  PROCESSING: 'desk.reports.enum.cargos.PROCESSING',
  MOCK_SENT: 'desk.reports.enum.cargos.MOCK_SENT',
  FAILED: 'desk.reports.enum.cargos.FAILED',
  SKIPPED: 'desk.reports.enum.cargos.SKIPPED',
};

export function formatDeskCargosSubmissionStatus(
  status: string,
  t: (key: PublicMessageKey) => string,
): string {
  const key = CARGOS_SUBMISSION_STATUS_KEYS[status];
  return key ? t(key) : status;
}
