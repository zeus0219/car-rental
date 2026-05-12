import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { JwtUser } from './types';

function isMfaSetupAllowedRoute(method: string, rawPath: string): boolean {
  const path = (rawPath.split('?')[0] ?? '').replace(/\/$/, '');
  if (method === 'GET' && path.endsWith('/auth/me')) {
    return true;
  }
  if (method === 'POST' && path.endsWith('/auth/mfa/setup/confirm')) {
    return true;
  }
  if (method === 'POST' && path.endsWith('/auth/mfa/setup/cancel')) {
    return true;
  }
  return false;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const req = context.switchToHttp().getRequest<{
      path?: string;
      url?: string;
      method?: string;
      user?: JwtUser;
    }>();
    const p = String(req.path ?? (req.url ? String(req.url).split('?')[0] : ''));
    if (p === '/docs' || p === '/docs-json' || p.startsWith('/docs/') || p.startsWith('/docs-')) {
      return true;
    }

    const ok = await super.canActivate(context);
    if (!ok) {
      return false;
    }
    const user = req.user as JwtUser | undefined;
    if (user?.mfaSetupPending) {
      const method = String(req.method ?? 'GET').toUpperCase();
      if (!isMfaSetupAllowedRoute(method, p)) {
        throw new ForbiddenException(
          'Complete or cancel two-factor enrollment (confirm the app code) before using the desk.',
        );
      }
    }
    return true;
  }
}
