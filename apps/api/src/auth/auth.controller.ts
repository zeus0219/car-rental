import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaCompleteLoginSchema,
  mfaDisableWithCodeSchema,
  mfaEnableWithCodeSchema,
  mfaRegenerateBackupCodesSchema,
  registerSchema,
  resetPasswordWithTokenSchema,
} from '@car-rental/shared';
import { ZodError } from 'zod';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import { JwtUser } from './types';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import type { Request } from 'express';
import { OPENAPI_JWT } from '../openapi.constants';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @ApiOperation({ summary: 'Login — returns access token or MFA challenge (mfaToken)' })
  /** Stricter than global limit — credential-stuffing protection (A2 / PRODUCTION-READINESS). */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Body() body: unknown, @Req() req: Request) {
    let parsed: ReturnType<typeof loginSchema.parse>;
    try {
      parsed = loginSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(e.flatten().fieldErrors);
      }
      throw e;
    }
    return this.auth.login(parsed, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  @Public()
  @ApiOperation({
    summary: 'Complete MFA login after mfaToken step (TOTP or one-time backup code)',
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/complete')
  async completeMfa(@Body() body: unknown, @Req() req: Request) {
    let parsed: ReturnType<typeof mfaCompleteLoginSchema.parse>;
    try {
      parsed = mfaCompleteLoginSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(e.flatten().fieldErrors);
      }
      throw e;
    }
    return this.auth.completeMfaLogin(parsed, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  @Public()
  @ApiOperation({ summary: 'Self-register (requires AUTH_ALLOW_REGISTER=true)' })
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Post('register')
  async register(@Body() body: unknown) {
    let parsed: ReturnType<typeof registerSchema.parse>;
    try {
      parsed = registerSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(e.flatten().fieldErrors);
      }
      throw e;
    }
    return this.auth.register(parsed);
  }

  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Start TOTP MFA setup (returns secret + otpauth URL)' })
  @Post('mfa/setup')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  startMfa(@CurrentUser() user: JwtUser) {
    return this.auth.startMfaSetup(user.sub);
  }

  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Confirm MFA setup with app code' })
  @Post('mfa/setup/confirm')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  async confirmMfa(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    let p: ReturnType<typeof mfaEnableWithCodeSchema.parse>;
    try {
      p = mfaEnableWithCodeSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(e.flatten().fieldErrors);
      }
      throw e;
    }
    return this.auth.confirmMfaSetup(user.sub, p.code);
  }

  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Cancel pending MFA setup (clear secret)' })
  @Post('mfa/setup/cancel')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  cancelMfa(@CurrentUser() user: JwtUser) {
    return this.auth.cancelMfaSetup(user.sub);
  }

  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Disable MFA (requires current TOTP)' })
  @Post('mfa/disable')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  async disableMfa(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    let p: ReturnType<typeof mfaDisableWithCodeSchema.parse>;
    try {
      p = mfaDisableWithCodeSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(e.flatten().fieldErrors);
      }
      throw e;
    }
    return this.auth.disableMfa(user.sub, p.code);
  }

  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({
    summary: 'Regenerate MFA backup codes (invalidates previous codes; requires current TOTP)',
  })
  @Post('mfa/backup-codes/regenerate')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  async regenerateMfaBackupCodes(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    let p: ReturnType<typeof mfaRegenerateBackupCodesSchema.parse>;
    try {
      p = mfaRegenerateBackupCodesSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(e.flatten().fieldErrors);
      }
      throw e;
    }
    return this.auth.regenerateMfaBackupCodes(user.sub, p.code);
  }

  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Current user + MFA flags' })
  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return this.auth.getProfile(user.sub);
  }

  /** H2: forgot password — sends email when SMTP + APP_PUBLIC_BASE_URL are set (anti-enumeration: always 200 `{ ok: true }`). */
  @Public()
  @ApiOperation({ summary: 'Request password reset email (always { ok: true })' })
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('password/forgot')
  async forgotPassword(@Body() body: unknown, @Req() req: Request) {
    let p: ReturnType<typeof forgotPasswordSchema.parse>;
    try {
      p = forgotPasswordSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(e.flatten().fieldErrors);
      }
      throw e;
    }
    return this.auth.requestPasswordReset(p, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  @Public()
  @ApiOperation({ summary: 'Set password with one-time token from email' })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('password/reset')
  async resetPassword(@Body() body: unknown, @Req() req: Request) {
    let p: ReturnType<typeof resetPasswordWithTokenSchema.parse>;
    try {
      p = resetPasswordWithTokenSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(e.flatten().fieldErrors);
      }
      throw e;
    }
    return this.auth.resetPasswordWithToken(p, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  /** H2: change password while logged in */
  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Change password (Bearer + current password)' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password')
  async changePassword(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    let p: ReturnType<typeof changePasswordSchema.parse>;
    try {
      p = changePasswordSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(e.flatten().fieldErrors);
      }
      throw e;
    }
    return this.auth.changePassword(user.sub, p);
  }
}
