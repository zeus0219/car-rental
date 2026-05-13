import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import {
  RegisterInput,
  LoginInput,
  UserRole,
  MfaCompleteLoginInput,
  ChangePasswordInput,
  ForgotPasswordInput,
  ResetPasswordWithTokenInput,
  strongPasswordSchema,
} from '@car-rental/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { isAdminCrossCompany } from './company-access';

authenticator.options = { window: 1 };

const LOGIN_MIN_TIMING_MS = 200;
const MFA_BACKUP_CODE_COUNT = 10;
const MFA_BACKUP_BCRYPT_ROUNDS = 10;

function randomBackupCodePlain(): string {
  const hex = randomBytes(4).toString('hex');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

function normalizeBackupCodeInput(raw: string): string | null {
  const hex = raw.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(hex)) {
    return null;
  }
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

function parseBackupHashes(v: unknown): string[] {
  if (v == null) {
    return [];
  }
  if (!Array.isArray(v)) {
    return [];
  }
  return v.filter((x): x is string => typeof x === 'string');
}

async function hashBackupCodes(plain: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of plain) {
    out.push(await bcrypt.hash(p, MFA_BACKUP_BCRYPT_ROUNDS));
  }
  return out;
}

async function issueBackupCodePlainsAndHashes(): Promise<{ plains: string[]; hashes: string[] }> {
  const plains: string[] = [];
  for (let i = 0; i < MFA_BACKUP_CODE_COUNT; i += 1) {
    plains.push(randomBackupCodePlain());
  }
  const hashes = await hashBackupCodes(plains);
  return { plains, hashes };
}

function sleepMs(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

type UserRow = {
  id: string;
  companyId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  stationId: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaBackupCodeHashes: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const mfaCapable = (r: UserRole) => r === 'ADMIN' || r === 'BRANCH_MANAGER';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private parseMaxLoginAttempts(): number {
    const raw = this.config.get<string | number>('AUTH_LOGIN_MAX_ATTEMPTS');
    if (raw === undefined || raw === '') {
      return 0;
    }
    return Math.max(0, parseInt(String(raw), 10) || 0);
  }

  private isMfaRequiredByPolicy(): boolean {
    const v = this.config.get<string | boolean>('AUTH_MFA_REQUIRED');
    if (v === true) {
      return true;
    }
    const s = String(v ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
  }

  /** A2: when set, a correct password must also satisfy `strongPasswordSchema` (legacy weak passwords → use forgot-password). */
  private isLoginStrongPasswordRequired(): boolean {
    const v = this.config.get<string | boolean>('AUTH_LOGIN_REQUIRE_STRONG_PASSWORD');
    if (v === true) {
      return true;
    }
    const s = String(v ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
  }

  /** A2: failed password or failed MFA step during login — same `lockedUntil` rules. */
  private async recordFailedLoginAttempt(row: UserRow): Promise<void> {
    const maxAttempts = this.parseMaxLoginAttempts();
    if (maxAttempts <= 0) {
      return;
    }
    const next = (row.failedLoginAttempts ?? 0) + 1;
    const lockMinRaw = this.config.get<string | number>('AUTH_LOGIN_LOCKOUT_MINUTES');
    const lockMinParsed = parseInt(String(lockMinRaw ?? 15), 10);
    const lockMin = Math.min(
      Math.max(Number.isFinite(lockMinParsed) ? lockMinParsed : 15, 1),
      24 * 60,
    );
    const data: { failedLoginAttempts: number; lockedUntil?: Date } = {
      failedLoginAttempts: next,
    };
    if (next >= maxAttempts) {
      data.lockedUntil = new Date(Date.now() + lockMin * 60_000);
    }
    await this.prisma.user.update({ where: { id: row.id }, data });
  }

  private signAccess(u: Pick<UserRow, 'id' | 'email' | 'companyId' | 'role'>) {
    return this.jwt.sign({
      sub: u.id,
      email: u.email,
      companyId: u.companyId,
      role: u.role,
    });
  }

  private signMfaPending(userId: string) {
    return this.jwt.sign(
      { sub: userId, pur: 'mfa' },
      { expiresIn: '5m' },
    );
  }

  /** Restricted session: must complete POST /auth/mfa/setup/confirm (or cancel) before desk access. */
  private signMfaSetupPending(u: Pick<UserRow, 'id' | 'email' | 'companyId' | 'role'>) {
    return this.jwt.sign(
      {
        sub: u.id,
        email: u.email,
        companyId: u.companyId,
        role: u.role,
        pur: 'mfa_setup',
      },
      { expiresIn: '15m' },
    );
  }

  toPublicUser(
    u: Pick<UserRow, 'id' | 'email' | 'firstName' | 'lastName' | 'companyId' | 'stationId' | 'role'>,
  ) {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      companyId: u.companyId,
      stationId: u.stationId,
      role: u.role,
    };
  }

  private async assertFullLogin(
    row: UserRow,
    ctx?: { ip?: string; userAgent?: string },
  ) {
    await this.prisma.user.update({
      where: { id: row.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    const token = this.signAccess(row);
    await this.audit.log({
      userId: row.id,
      action: 'auth.login',
      entity: 'User',
      entityId: row.id,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
    });
    return { accessToken: token, user: this.toPublicUser(row), mfaRequired: false as const };
  }

  async login(
    body: LoginInput,
    ctx?: { ip?: string; userAgent?: string },
  ): Promise<
    | { accessToken: string; user: ReturnType<AuthService['toPublicUser']>; mfaRequired: false }
    | { mfaRequired: true; mfaToken: string }
    | { accessToken: string; user: ReturnType<AuthService['toPublicUser']>; mfaSetupPending: true }
  > {
    const t0 = Date.now();

    const u = await this.prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!u || !u.isActive) {
      await this.enforceMinLoginTiming(t0);
      throw new UnauthorizedException('Invalid credentials');
    }
    const row = u as UserRow;

    if (row.lockedUntil) {
      const until = row.lockedUntil.getTime();
      if (until > Date.now()) {
        await this.enforceMinLoginTiming(t0);
        throw new UnauthorizedException('Account temporarily locked due to failed sign-in attempts');
      }
      await this.prisma.user.update({
        where: { id: row.id },
        data: { lockedUntil: null, failedLoginAttempts: 0 },
      });
      row.lockedUntil = null;
      row.failedLoginAttempts = 0;
    }

    const ok = await bcrypt.compare(body.password, row.passwordHash);
    if (!ok) {
      await this.recordFailedLoginAttempt(row);
      await this.enforceMinLoginTiming(t0);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (this.isLoginStrongPasswordRequired()) {
      const policy = strongPasswordSchema.safeParse(body.password);
      if (!policy.success) {
        await this.enforceMinLoginTiming(t0);
        throw new UnauthorizedException(
          'Your password no longer meets security policy; use Forgot password to set a new one.',
        );
      }
    }

    await this.prisma.user.update({
      where: { id: row.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    row.failedLoginAttempts = 0;
    row.lockedUntil = null;

    const pendingMfaSetup = Boolean(row.mfaSecret && !row.mfaEnabled);
    if (
      this.isMfaRequiredByPolicy() &&
      mfaCapable(row.role) &&
      !row.mfaEnabled &&
      !pendingMfaSetup
    ) {
      await this.enforceMinLoginTiming(t0);
      throw new ForbiddenException(
        'Two-factor authentication is required for admin and branch manager accounts.',
      );
    }

    if (pendingMfaSetup) {
      await this.enforceMinLoginTiming(t0);
      return {
        accessToken: this.signMfaSetupPending(row),
        user: this.toPublicUser(row),
        mfaSetupPending: true as const,
      };
    }

    if (row.mfaEnabled && row.mfaSecret) {
      if (body.totp) {
        const valid = authenticator.check(body.totp, row.mfaSecret);
        if (!valid) {
          await this.recordFailedLoginAttempt(row);
          await this.enforceMinLoginTiming(t0);
          throw new UnauthorizedException('Invalid two-factor code');
        }
        return this.assertFullLogin(row, ctx);
      }
      await this.enforceMinLoginTiming(t0);
      return { mfaRequired: true, mfaToken: this.signMfaPending(row.id) };
    }

    return this.assertFullLogin(row, ctx);
  }
  
  async completeMfaLogin(
    body: MfaCompleteLoginInput,
    ctx?: { ip?: string; userAgent?: string },
  ) {
    const t0 = Date.now();
    let sub: string;
    try {
      const p = this.jwt.verify<{ sub: string; pur?: string }>(body.mfaToken);
      if (p.pur !== 'mfa' || !p.sub) {
        throw new Error('bad');
      }
      sub = p.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA step token');
    }
    const u = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!u || !u.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const row = u as UserRow;
    if (row.lockedUntil) {
      const until = row.lockedUntil.getTime();
      if (until > Date.now()) {
        throw new UnauthorizedException('Account temporarily locked due to failed sign-in attempts');
      }
      await this.prisma.user.update({
        where: { id: row.id },
        data: { lockedUntil: null, failedLoginAttempts: 0 },
      });
      row.lockedUntil = null;
      row.failedLoginAttempts = 0;
    }

    if (!row.mfaEnabled || !row.mfaSecret) {
      throw new BadRequestException('MFA is not active for this account');
    }
    if (body.totp) {
      if (!authenticator.check(body.totp, row.mfaSecret)) {
        await this.recordFailedLoginAttempt(row);
        await this.enforceMinLoginTiming(t0);
        throw new UnauthorizedException('Invalid two-factor code');
      }
      return this.assertFullLogin(row, ctx);
    }

    const canonical = normalizeBackupCodeInput(body.backupCode ?? '');
    if (!canonical) {
      await this.recordFailedLoginAttempt(row);
      await this.enforceMinLoginTiming(t0);
      throw new UnauthorizedException('Invalid recovery code');
    }
    const hashes = parseBackupHashes(row.mfaBackupCodeHashes);
    if (hashes.length === 0) {
      await this.recordFailedLoginAttempt(row);
      await this.enforceMinLoginTiming(t0);
      throw new UnauthorizedException('Invalid recovery code');
    }
    let matchIdx = -1;
    for (let i = 0; i < hashes.length; i += 1) {
      const hit = await bcrypt.compare(canonical, hashes[i]);
      if (hit) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx < 0) {
      await this.recordFailedLoginAttempt(row);
      await this.enforceMinLoginTiming(t0);
      throw new UnauthorizedException('Invalid recovery code');
    }
    const nextHashes = hashes.filter((_, i) => i !== matchIdx);
    await this.prisma.user.update({
      where: { id: row.id },
      data: { mfaBackupCodeHashes: nextHashes.length > 0 ? nextHashes : [] },
    });
    await this.audit.log({
      userId: row.id,
      action: 'auth.mfa_backup_redeem',
      entity: 'User',
      entityId: row.id,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
    });
    return this.assertFullLogin(row, ctx);
  }

  async startMfaSetup(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) {
      throw new UnauthorizedException();
    }
    if (!mfaCapable(u.role)) {
      throw new ForbiddenException('MFA is only available for admin and branch manager accounts');
    }
    if (u.mfaEnabled) {
      throw new BadRequestException('MFA is already enabled');
    }
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret, mfaEnabled: false, mfaBackupCodeHashes: Prisma.DbNull },
    });
    const otpauth = authenticator.keyuri(u.email, 'CarRentalDesk', secret);
    return { secretBase32: secret, otpauthUrl: otpauth };
  }

  async confirmMfaSetup(userId: string, code: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !mfaCapable(u.role)) {
      throw new ForbiddenException();
    }
    if (u.mfaEnabled) {
      throw new BadRequestException('MFA is already enabled');
    }
    if (!u.mfaSecret) {
      throw new BadRequestException('Call POST /auth/mfa/setup first, then enter the app code here');
    }
    if (!authenticator.check(code, u.mfaSecret)) {
      throw new UnauthorizedException('Invalid code');
    }
    const { plains, hashes } = await issueBackupCodePlainsAndHashes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaBackupCodeHashes: hashes },
    });
    await this.audit.log({
      userId,
      action: 'auth.mfa_enable',
      entity: 'User',
      entityId: userId,
    });
    const ready = (await this.prisma.user.findUnique({ where: { id: userId } })) as UserRow | null;
    if (!ready) {
      throw new UnauthorizedException();
    }
    return {
      ok: true as const,
      mfaEnabled: true as const,
      backupCodes: plains,
      accessToken: this.signAccess(ready),
    };
  }

  async cancelMfaSetup(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) {
      throw new UnauthorizedException();
    }
    if (u.mfaEnabled) {
      throw new BadRequestException('Turn off MFA with disable, not cancel');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaBackupCodeHashes: Prisma.DbNull },
    });
    return { ok: true as const };
  }

  async disableMfa(userId: string, code: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) {
      throw new UnauthorizedException();
    }
    if (!u.mfaEnabled || !u.mfaSecret) {
      throw new BadRequestException('MFA is not enabled');
    }
    if (this.isMfaRequiredByPolicy() && mfaCapable(u.role)) {
      throw new ForbiddenException(
        'Two-factor authentication cannot be disabled while required by policy.',
      );
    }
    if (!authenticator.check(code, u.mfaSecret)) {
      throw new UnauthorizedException('Invalid code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodeHashes: Prisma.DbNull },
    });
    await this.audit.log({
      userId,
      action: 'auth.mfa_disable',
      entity: 'User',
      entityId: userId,
    });
    return { ok: true as const, mfaEnabled: false as const };
  }

  async regenerateMfaBackupCodes(userId: string, totp: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) {
      throw new UnauthorizedException();
    }
    if (!mfaCapable(u.role)) {
      throw new ForbiddenException();
    }
    if (!u.mfaEnabled || !u.mfaSecret) {
      throw new BadRequestException('MFA is not enabled');
    }
    if (!authenticator.check(totp, u.mfaSecret)) {
      throw new UnauthorizedException('Invalid code');
    }
    const { plains, hashes } = await issueBackupCodePlainsAndHashes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaBackupCodeHashes: hashes },
    });
    await this.audit.log({
      userId,
      action: 'auth.mfa_backup_regenerate',
      entity: 'User',
      entityId: userId,
    });
    return { backupCodes: plains };
  }

  async register(body: RegisterInput) {
    const allowed = this.config.get<string>('AUTH_ALLOW_REGISTER', 'false') === 'true';
    if (!allowed) {
      throw new ForbiddenException('Registration is not enabled (AUTH_ALLOW_REGISTER=true)');
    }
    const [company, stationOk] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: body.companyId } }),
      body.stationId
        ? this.prisma.station.findFirst({ where: { id: body.stationId, companyId: body.companyId } })
        : Promise.resolve({ id: 'skip' } as { id: string }),
    ]);
    if (!company) {
      throw new ForbiddenException('Company not found');
    }
    if (body.stationId && !stationOk) {
      throw new ForbiddenException('Station does not belong to this company');
    }
    const email = body.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ForbiddenException('Email already in use');
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    const u = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        companyId: body.companyId,
        stationId: body.stationId ?? null,
        role: body.role ?? 'AGENT',
      },
    });
    const created = u as UserRow;
    const token = this.signAccess(created);
    return { accessToken: token, user: this.toPublicUser(created) };
  }

  private async enforceMinLoginTiming(startedAt: number) {
    const elapsed = Date.now() - startedAt;
    if (elapsed < LOGIN_MIN_TIMING_MS) {
      await sleepMs(LOGIN_MIN_TIMING_MS - elapsed);
    }
  }

  async getProfile(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) {
      throw new UnauthorizedException();
    }
    const backupRemaining =
      u.mfaEnabled ? parseBackupHashes(u.mfaBackupCodeHashes).length : 0;
    return {
      ...this.toPublicUser(u as UserRow),
      mfaEnabled: u.mfaEnabled,
      mfaSetupPending: Boolean(u.mfaSecret && !u.mfaEnabled),
      mfaCanEnable: mfaCapable(u.role),
      mfaBackupCodesRemaining: backupRemaining,
      /** False when `ENFORCE_STAFF_SINGLE_COMPANY` is on — desk should not offer multi-company scope. */
      adminCrossCompanyAccess: isAdminCrossCompany({ role: u.role }),
    };
  }

  /** H2: request password reset email (always returns ok; anti-enumeration). */
  async requestPasswordReset(
    body: ForgotPasswordInput,
    ctx?: { ip?: string; userAgent?: string },
  ): Promise<{ ok: true }> {
    const t0 = Date.now();
    const email = body.email.toLowerCase().trim();
    const u = await this.prisma.user.findUnique({ where: { email } });
    if (!u || !u.isActive) {
      await this.enforceMinLoginTiming(t0);
      return { ok: true };
    }
    const base = this.config.get<string>('APP_PUBLIC_BASE_URL')?.trim().replace(/\/$/, '') ?? '';
    if (!this.mail.isEnabled() || !base) {
      await this.enforceMinLoginTiming(t0);
      return { ok: true };
    }
    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: u.id, usedAt: null },
    });
    const raw = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(raw, 'utf8').digest('hex');
    const ttlMin = Number(this.config.get('PASSWORD_RESET_TTL_MINUTES') ?? 60);
    const ttl = Math.min(Math.max(Number.isFinite(ttlMin) ? ttlMin : 60, 5), 24 * 60);
    const expiresAt = new Date(Date.now() + ttl * 60_000);
    await this.prisma.passwordResetToken.create({
      data: { userId: u.id, tokenHash, expiresAt },
    });
    const resetUrl = `${base}/auth/reset-password?token=${encodeURIComponent(raw)}`;
    try {
      await this.mail.sendPasswordResetEmail({
        to: u.email,
        firstName: u.firstName,
        resetUrl,
      });
    } catch {
      await this.prisma.passwordResetToken.deleteMany({ where: { tokenHash } });
    }
    await this.audit.log({
      userId: u.id,
      action: 'auth.password_reset_request',
      entity: 'User',
      entityId: u.id,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
    });
    await this.enforceMinLoginTiming(t0);
    return { ok: true };
  }

  /** True when staff invite / password-reset emails can be sent (SMTP + public web base URL). */
  staffInviteEmailConfigured(): boolean {
    const base = this.config.get<string>('APP_PUBLIC_BASE_URL')?.trim().replace(/\/$/, '') ?? '';
    return this.mail.isEnabled() && Boolean(base);
  }

  /**
   * H2: after admin creates a user, email a one-time link to `/auth/reset-password?token=…`.
   * Rolls back token row if SMTP send throws. Caller should delete the user if this throws after partial failure.
   */
  async sendStaffInviteSetupEmail(
    userId: string,
    ctx: { actorUserId: string; ip?: string; userAgent?: string },
  ): Promise<void> {
    const base = this.config.get<string>('APP_PUBLIC_BASE_URL')?.trim().replace(/\/$/, '') ?? '';
    if (!this.mail.isEnabled() || !base) {
      throw new BadRequestException(
        'Cannot send staff invite: configure SMTP (e.g. SMTP_HOST, SMTP_FROM) and APP_PUBLIC_BASE_URL',
      );
    }
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.isActive) {
      throw new NotFoundException('User not found');
    }
    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: u.id, usedAt: null },
    });
    const raw = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(raw, 'utf8').digest('hex');
    const ttlMin = Number(this.config.get('PASSWORD_RESET_TTL_MINUTES') ?? 60);
    const ttl = Math.min(Math.max(Number.isFinite(ttlMin) ? ttlMin : 60, 5), 24 * 60);
    const expiresAt = new Date(Date.now() + ttl * 60_000);
    await this.prisma.passwordResetToken.create({
      data: { userId: u.id, tokenHash, expiresAt },
    });
    const resetUrl = `${base}/auth/reset-password?token=${encodeURIComponent(raw)}`;
    const [company, inviter] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: u.companyId }, select: { name: true } }),
      this.prisma.user.findUnique({
        where: { id: ctx.actorUserId },
        select: { firstName: true, lastName: true, email: true },
      }),
    ]);
    const invitedByLine = inviter
      ? `${inviter.firstName} ${inviter.lastName} (${inviter.email})`
      : null;
    try {
      await this.mail.sendStaffAccountInviteEmail({
        to: u.email,
        firstName: u.firstName,
        resetUrl,
        organizationName: company?.name ?? 'Car rental',
        invitedByLine,
      });
    } catch {
      await this.prisma.passwordResetToken.deleteMany({ where: { tokenHash } });
      throw new ServiceUnavailableException(
        'Could not send invite email; the new user was not created. Try again or add staff without the email invite.',
      );
    }
    await this.audit.log({
      userId: ctx.actorUserId,
      action: 'auth.staff_invite_email',
      entity: 'User',
      entityId: u.id,
      metadata: { targetEmail: u.email },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  }

  /** H2: set password using one-time token from email. */
  async resetPasswordWithToken(
    body: ResetPasswordWithTokenInput,
    ctx?: { ip?: string; userAgent?: string },
  ): Promise<{ ok: true }> {
    const tokenHash = createHash('sha256').update(body.token.toLowerCase(), 'utf8').digest('hex');
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Invalid or expired reset link');
    }
    const passwordHash = await bcrypt.hash(body.newPassword, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
      await tx.passwordResetToken.deleteMany({
        where: { userId: row.userId, usedAt: null, id: { not: row.id } },
      });
    });
    await this.audit.log({
      userId: row.userId,
      action: 'auth.password_reset_complete',
      entity: 'User',
      entityId: row.userId,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
    });
    return { ok: true };
  }

  /** H2: change own password (current password required). */
  async changePassword(userId: string, body: ChangePasswordInput) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.isActive) {
      throw new UnauthorizedException();
    }
    const row = u as UserRow;
    const ok = await bcrypt.compare(body.currentPassword, row.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (body.newPassword === body.currentPassword) {
      throw new BadRequestException('New password must differ from current password');
    }
    const passwordHash = await bcrypt.hash(body.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await this.audit.log({
      userId,
      action: 'auth.password_change',
      entity: 'User',
      entityId: userId,
    });
    return { ok: true as const };
  }
}
