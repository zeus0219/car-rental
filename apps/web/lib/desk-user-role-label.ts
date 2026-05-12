import { userRoleValues } from '@car-rental/shared';
import type { PublicMessageKey } from './public-messages';

export function formatDeskUserRole(role: string, t: (key: PublicMessageKey) => string): string {
  if ((userRoleValues as readonly string[]).includes(role)) {
    return t(`desk.team.role.${role}` as PublicMessageKey);
  }
  return role;
}
