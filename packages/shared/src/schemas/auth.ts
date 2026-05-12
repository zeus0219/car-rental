import { z } from 'zod';

/** For desk UI / docs — matches `strongPasswordSchema`. */
export const PASSWORD_POLICY_HINT =
  'At least 12 characters (max 128), with uppercase, lowercase, a number, and a special character (!@#$%…).';

const PASSWORD_MIN_LEN = 12;
const PASSWORD_MAX_LEN = 128;
const HAS_LOWER = /[a-z]/;
const HAS_UPPER = /[A-Z]/;
const HAS_DIGIT = /[0-9]/;
/** Printable ASCII special (avoid whitespace). */
const HAS_SPECIAL = /[!@#$%^&*()_+\-=[\]{}|;:',.<>?/~`]/;

/**
 * A2: policy for **setting** passwords (register, change, reset, optional staff initial password).
 * Login accepts any stored hash length (do not use this schema for `POST /auth/login` password).
 */
export const strongPasswordSchema = z
  .string()
  .trim()
  .min(PASSWORD_MIN_LEN, { message: `Password must be at least ${PASSWORD_MIN_LEN} characters` })
  .max(PASSWORD_MAX_LEN, { message: `Password must be at most ${PASSWORD_MAX_LEN} characters` })
  .superRefine((val, ctx) => {
    if (!HAS_LOWER.test(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Password must contain a lowercase letter' });
    }
    if (!HAS_UPPER.test(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Password must contain an uppercase letter' });
    }
    if (!HAS_DIGIT.test(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Password must contain a number' });
    }
    if (!HAS_SPECIAL.test(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password must contain a special character (e.g. !@#$%^&*)',
      });
    }
  });

export const userRoleValues = [
  'ADMIN',
  'BRANCH_MANAGER',
  'AGENT',
  'READONLY_ACCOUNTING',
] as const;

export type UserRole = (typeof userRoleValues)[number];

/** Roles that may create/update/delete operational data (reservations, fleet, stations) */
export const userWriteRoleValues = ['ADMIN', 'BRANCH_MANAGER', 'AGENT'] as const;

export type UserWriteRole = (typeof userWriteRoleValues)[number];

export const totp6 = z.string().regex(/^\d{6}$/);

export const loginSchema = z.object({
  email: z.string().email().max(320),
  /** Submitted secret (max length cap). Strong-password rule is optional at login — see `AUTH_LOGIN_REQUIRE_STRONG_PASSWORD`. */
  password: z.string().min(1).max(200),
  /** If account has MFA, include 6-digit code from app (or use two-step mfaToken flow) */
  totp: totp6.optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const mfaCompleteLoginSchema = z
  .object({
    mfaToken: z.string().min(20).max(2000),
    totp: totp6.optional(),
    /** One-time recovery code (format `XXXX-XXXX`, hex; hyphen optional) */
    backupCode: z.string().min(8).max(32).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const hasT = d.totp != null && d.totp.length > 0;
    const hasB = d.backupCode != null && d.backupCode.trim().length > 0;
    if (hasT === hasB) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of totp or backupCode',
        path: hasT && hasB ? ['totp'] : ['totp'],
      });
    }
  });

export type MfaCompleteLoginInput = z.infer<typeof mfaCompleteLoginSchema>;

export const mfaEnableWithCodeSchema = z.object({ code: totp6 }).strict();

export const mfaRegenerateBackupCodesSchema = z.object({ code: totp6 }).strict();

export const mfaDisableWithCodeSchema = z.object({ code: totp6 }).strict();

export const registerSchema = z.object({
  email: z.string().email().max(320),
  password: strongPasswordSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  companyId: z.string().uuid(),
  stationId: z.string().uuid().optional(),
  role: z.enum(userRoleValues).default('AGENT'),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/** Admin updates to a user in the same company (API enforces company + self-deactivate rules) */
export const updateStaffMemberSchema = z
  .object({
    role: z.enum(userRoleValues).optional(),
    stationId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((o) => o.role !== undefined || o.stationId !== undefined || o.isActive !== undefined, {
    message: 'Provide at least one of role, stationId, isActive',
  });

export type UpdateStaffMemberInput = z.infer<typeof updateStaffMemberSchema>;

/** Admin creates a user in a company (desk “add staff” — not public self-register) */
export const createStaffUserSchema = z
  .object({
    companyId: z.string().uuid(),
    email: z.string().email().max(320),
    /** Omit or leave empty to let the server generate a one-time **temporary** password (returned in the response only). */
    password: z.string().max(200).optional(),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    role: z.enum(userRoleValues),
    stationId: z.string().uuid().nullable().optional(),
    /**
     * H2: send password-setup email (same token flow as forgot-password). Requires API mail + APP_PUBLIC_BASE_URL.
     * Cannot be combined with `password`.
     */
    sendInviteEmail: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.sendInviteEmail === true && data.password != null && data.password.trim() !== '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Remove the initial password when sending an invite email',
        path: ['password'],
      });
    }
    const raw = data.password;
    if (raw == null || raw === '') {
      return;
    }
    const r = strongPasswordSchema.safeParse(raw);
    if (!r.success) {
      for (const iss of r.error.issues) {
        ctx.addIssue({ ...iss, path: ['password'] });
      }
    }
  });

export type CreateStaffUserInput = z.infer<typeof createStaffUserSchema>;

/** Logged-in user changes their own password (H2) */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: strongPasswordSchema,
  })
  .strict()
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'New password must differ from current password',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** H2: request email with reset link (anti-enumeration — API always returns ok) */
export const forgotPasswordSchema = z.object({
  email: z.string().email().max(320),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** H2: complete reset with token from email (64 hex chars from 32 random bytes) */
export const resetPasswordWithTokenSchema = z
  .object({
    token: z.string().min(64).max(64).regex(/^[a-f0-9]+$/i),
    newPassword: strongPasswordSchema,
  })
  .strict();

export type ResetPasswordWithTokenInput = z.infer<typeof resetPasswordWithTokenSchema>;
