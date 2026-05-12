export const API_VERSION = '1';

/**
 * Web `apps/web/lib/public-messages` key for the G1 utilization formula paragraph (H3 i18n).
 * API echoes this in `GET /reports/company` → `utilization.definitionKey` instead of English-only `definition`.
 */
export const COMPANY_REPORT_UTILIZATION_DEFINITION_I18N_KEY = 'desk.reports.utilization.definition' as const;
