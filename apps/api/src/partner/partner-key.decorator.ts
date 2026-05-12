import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { PartnerRequestContext, RequestWithPartner } from './partner.types';

export const PartnerCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PartnerRequestContext => {
    const req = ctx.switchToHttp().getRequest<RequestWithPartner>();
    const p = req.partner;
    if (!p) {
      throw new InternalServerErrorException('Partner context missing');
    }
    return p;
  },
);
