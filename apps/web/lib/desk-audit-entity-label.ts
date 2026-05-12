import type { PublicMessageKey } from './public-messages';

const DESK_AUDIT_ENTITY_I18N: Record<string, PublicMessageKey> = {
  Reservation: 'desk.audit.entity.Reservation',
  Invoice: 'desk.audit.entity.Invoice',
  Customer: 'desk.audit.entity.Customer',
  User: 'desk.audit.entity.User',
  CustomerDocument: 'desk.audit.entity.CustomerDocument',
  PartnerApiKey: 'desk.audit.entity.PartnerApiKey',
  SdiInvoiceSubmission: 'desk.audit.entity.SdiInvoiceSubmission',
  DamageReport: 'desk.audit.entity.DamageReport',
};

export function isDeskAuditEntityKnown(entity: string): boolean {
  return Object.prototype.hasOwnProperty.call(DESK_AUDIT_ENTITY_I18N, entity);
}

export function formatDeskAuditEntityLabel(
  entity: string,
  t: (key: PublicMessageKey) => string,
): string {
  const key = DESK_AUDIT_ENTITY_I18N[entity];
  return key ? t(key) : entity;
}
