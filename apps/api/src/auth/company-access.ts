import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtUser } from './types';

/** When `1`/`true`/`yes`, `ADMIN` users are **company-bound** like other roles (no cross-tenant lists or resource bypass). */
function enforceStaffSingleCompany(): boolean {
  const v = process.env.ENFORCE_STAFF_SINGLE_COMPANY?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function isAdmin(user: JwtUser): boolean {
  return user.role === 'ADMIN';
}

/**
 * `ADMIN` who may see **all** companies in list filters and bypass `assertSameCompany` / `assertCreateBodyCompanyId`.
 * Set **`ENFORCE_STAFF_SINGLE_COMPANY`** to disable that (recommended per-dealer production).
 */
export function isAdminCrossCompany(user: Pick<JwtUser, 'role'>): boolean {
  return user.role === 'ADMIN' && !enforceStaffSingleCompany();
}

/** True when the user is a branch agent with an assigned `stationId` (branch-scoped at desk). */
export function isAgentStationScoped(user: JwtUser): boolean {
  return user.role === 'AGENT' && user.stationId != null;
}

/**
 * Read access: reservation must **touch** the agent’s station (pickup or return).
 * Uses 404 so IDs do not leak across branches.
 */
export function assertAgentReservationInScope(
  user: JwtUser,
  pickupStationId: string,
  returnStationId: string,
  notFoundMessage: string,
): void {
  if (!isAgentStationScoped(user)) {
    return;
  }
  const s = user.stationId!;
  if (pickupStationId === s || returnStationId === s) {
    return;
  }
  throw new NotFoundException(notFoundMessage);
}

/**
 * Mutations (create / update, checkout, etc.): pickup must be at the agent’s station
 * (desk creates rentals starting from their branch; one-way return elsewhere is still allowed).
 */
export function assertAgentMayUsePickupStation(user: JwtUser, pickupStationId: string): void {
  if (!isAgentStationScoped(user)) {
    return;
  }
  if (pickupStationId !== user.stationId) {
    throw new ForbiddenException('Reservation pickup must be at your assigned station');
  }
}

export function assertAgentVehicleHomeBranch(user: JwtUser, homeStationId: string, notFoundMessage: string): void {
  if (!isAgentStationScoped(user)) {
    return;
  }
  if (homeStationId !== user.stationId) {
    throw new NotFoundException(notFoundMessage);
  }
}

export function assertAgentAvailabilityStation(user: JwtUser, stationId: string): void {
  if (!isAgentStationScoped(user)) {
    return;
  }
  if (stationId !== user.stationId) {
    throw new ForbiddenException('You can only query availability for your assigned station');
  }
}

/**
 * For list filters: non-admins are restricted to their company. Admins may pass an optional
 * `companyId` or see all rows when omitted.
 */
export function effectiveListCompanyFilter(
  user: JwtUser,
  queryCompanyId: string | undefined,
): { companyId: string } | Record<string, never> {
  if (isAdminCrossCompany(user)) {
    return queryCompanyId ? { companyId: queryCompanyId } : {};
  }
  if (queryCompanyId && queryCompanyId !== user.companyId) {
    throw new ForbiddenException('Not allowed to access this company');
  }
  return { companyId: user.companyId };
}

export function assertSameCompany(
  user: JwtUser,
  resourceCompanyId: string,
  notFoundMessage: string,
): void {
  if (isAdminCrossCompany(user)) {
    return;
  }
  if (resourceCompanyId !== user.companyId) {
    throw new NotFoundException(notFoundMessage);
  }
}

export function assertCreateBodyCompanyId(user: JwtUser, bodyCompanyId: string): void {
  if (isAdminCrossCompany(user)) {
    return;
  }
  if (bodyCompanyId !== user.companyId) {
    throw new ForbiddenException('Not allowed to create for another company');
  }
}

/** Branch managers can only modify their own company record; admins any. */
export function assertCanPatchCompany(user: JwtUser, companyId: string): void {
  if (user.role === 'BRANCH_MANAGER' && companyId !== user.companyId) {
    throw new ForbiddenException('Not allowed to modify this company');
  }
}
