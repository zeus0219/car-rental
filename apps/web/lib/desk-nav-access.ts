import type { Me } from './me-types';

const OPS_ROLES = new Set(['ADMIN', 'BRANCH_MANAGER', 'AGENT']);

/** Fleet + calendar are operations-heavy; hide from read-only accounting in the nav (pages remain reachable if linked). */
export function deskNavShowsFleetAndCalendar(me: Me): boolean {
  return OPS_ROLES.has(me.role);
}

/** Only `ADMIN` may create/update staff (`POST`/`PATCH /staff`). */
export function deskNavShowsTeam(me: Me): boolean {
  return me.role === 'ADMIN';
}

export function deskNavShowsAudit(me: Me): boolean {
  return me.role === 'ADMIN' || me.role === 'BRANCH_MANAGER' || me.role === 'READONLY_ACCOUNTING';
}
