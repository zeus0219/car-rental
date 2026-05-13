import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtUser } from '../auth/types';
import { effectiveListCompanyFilter } from '../auth/company-access';
import { OPENAPI_JWT } from '../openapi.constants';
import { AuditService } from './audit.service';

@ApiTags('Organization')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List audit log entries for a company (admin needs companyId)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'READONLY_ACCOUNTING')
  list(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('take') takeStr: string | undefined,
    @Query('action') actionContains: string | undefined,
  ) {
    const take = Math.min(500, Math.max(1, Number.parseInt(takeStr ?? '100', 10) || 100));
    const f = effectiveListCompanyFilter(user, companyId);
    if (!('companyId' in f) || typeof f.companyId !== 'string') {
      throw new BadRequestException('Pass companyId');
    }
    return this.audit.listForCompany(f.companyId, take, actionContains);
  }
}
