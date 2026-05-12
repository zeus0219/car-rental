import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserRole } from '@car-rental/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from './types';

type JwtPayload = {
  sub: string;
  email?: string;
  companyId?: string;
  role?: UserRole;
  pur?: string;
  iat?: number;
  exp?: number;
};

function parseMfaRequiredFlag(config: ConfigService): boolean {
  const v = config.get<string | boolean>('AUTH_MFA_REQUIRED');
  if (v === true) {
    return true;
  }
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function mfaCapableRole(r: UserRole): boolean {
  return r === 'ADMIN' || r === 'BRANCH_MANAGER';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = config.get<string>('JWT_SECRET') ?? 'dev-insecure-jwt-secret-change-in-env';
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtUser> {
    if (payload.pur === 'mfa') {
      throw new UnauthorizedException();
    }

    if (payload.pur === 'mfa_setup') {
      if (!payload.email || !payload.companyId || !payload.role) {
        throw new UnauthorizedException();
      }
      const u = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!u || !u.isActive) {
        throw new UnauthorizedException();
      }
      if (!(u.mfaSecret && !u.mfaEnabled)) {
        throw new UnauthorizedException(
          'MFA enrollment is no longer pending — sign in again for a full session.',
        );
      }
      if (u.email !== payload.email || u.companyId !== payload.companyId || u.role !== payload.role) {
        throw new UnauthorizedException();
      }
      return {
        sub: u.id,
        email: u.email,
        companyId: u.companyId,
        role: u.role,
        firstName: u.firstName,
        lastName: u.lastName,
        stationId: u.stationId,
        mfaSetupPending: true,
      };
    }

    if (!payload.email || !payload.companyId || !payload.role) {
      throw new UnauthorizedException();
    }
    const u = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!u || !u.isActive) {
      throw new UnauthorizedException();
    }
    if (u.email !== payload.email || u.companyId !== payload.companyId || u.role !== payload.role) {
      throw new UnauthorizedException();
    }

    if (parseMfaRequiredFlag(this.config) && mfaCapableRole(u.role) && !u.mfaEnabled) {
      throw new UnauthorizedException(
        'Two-factor authentication is required — sign in again with a fully enrolled account.',
      );
    }

    return {
      sub: u.id,
      email: u.email,
      companyId: u.companyId,
      role: u.role,
      firstName: u.firstName,
      lastName: u.lastName,
      stationId: u.stationId,
    };
  }
}
