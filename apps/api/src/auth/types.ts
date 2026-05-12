import { UserRole } from '@car-rental/shared';

export type JwtUser = {
  sub: string;
  email: string;
  companyId: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  /// Counter / branch; only agents with a set station are restricted to that branch
  stationId: string | null;
  /** Bearer from `pur: mfa_setup` — desk routes blocked until enrollment is confirmed */
  mfaSetupPending?: true;
};
