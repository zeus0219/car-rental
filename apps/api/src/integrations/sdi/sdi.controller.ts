import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { sdiEnqueueBodySchema } from '@car-rental/shared';
import { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import { SdiService } from './sdi.service';

@ApiTags('Integrations')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('integrations/sdi')
@UseGuards(RolesGuard)
export class SdiController {
  constructor(private readonly sdi: SdiService) {}

  @Get('submissions')
  @ApiOperation({ summary: 'List SDI submission records' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  list(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('invoiceId') invoiceId: string | undefined,
  ) {
    return this.sdi.listSubmissions(user, { companyId, invoiceId });
  }

  @Post('enqueue')
  @ApiOperation({ summary: 'Enqueue SDI submission' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  enqueue(@Body() body: unknown, @CurrentUser() user: JwtUser) {
    return this.sdi.enqueue(sdiEnqueueBodySchema.parse(body), user);
  }

  @Post('callback')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'SDI middleware async completion (no JWT). Authorization: Bearer SDI_CALLBACK_SECRET. JSON: submissionId, status SENT|FAILED, optional idTracciatura / errorMessage.',
  })
  callback(
    @Headers('authorization') authorization: string | undefined,
    @Req() req: Request,
  ) {
    return this.sdi.handleMiddlewareCallback(authorization, req.body, req.ip ?? null);
  }
}
