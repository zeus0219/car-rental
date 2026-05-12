import { defaultOpsChecklistTemplate } from '@car-rental/shared';
import type { PublicMessageKey } from './public-messages';

function buildOpsChecklistKeys(): Record<string, PublicMessageKey> {
  const out: Record<string, PublicMessageKey> = {};
  for (const row of defaultOpsChecklistTemplate) {
    out[row.key] = `desk.res.ops.cl.${row.key}` as PublicMessageKey;
  }
  return out;
}

const OPS_CHECKLIST_I18N_KEYS = buildOpsChecklistKeys();

export function formatDeskOpsChecklistItemLabel(
  key: string,
  fallbackLabel: string,
  t: (k: PublicMessageKey) => string,
): string {
  const msgKey = OPS_CHECKLIST_I18N_KEYS[key];
  return msgKey ? t(msgKey) : fallbackLabel;
}
