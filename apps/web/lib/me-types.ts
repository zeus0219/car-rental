export type Me = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  companyId: string;
  stationId: string | null;
  role: string;
  /** A3: from GET /auth/me when using MFA */
  mfaEnabled?: boolean;
  mfaSetupPending?: boolean;
  mfaCanEnable?: boolean;
  /** A3: one-time backup codes remaining (0 if MFA off) */
  mfaBackupCodesRemaining?: number;
  /** When false, `ENFORCE_STAFF_SINGLE_COMPANY` treats this ADMIN like a single-tenant user (desk omits multi-company scope). */
  adminCrossCompanyAccess?: boolean;
};
