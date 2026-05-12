import { customerDocumentTypeValues } from '@car-rental/shared';
import type { PublicMessageKey } from './public-messages';

export function formatDeskCustomerDocType(type: string, t: (key: PublicMessageKey) => string): string {
  if ((customerDocumentTypeValues as readonly string[]).includes(type)) {
    return t(`desk.customers.docType.${type}` as PublicMessageKey);
  }
  return type;
}
