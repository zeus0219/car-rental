import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { companyReportQuerySchema, customerDocumentsOcrPendingQuerySchema } from '@car-rental/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtUser } from '../auth/types';
import { OPENAPI_JWT } from '../openapi.constants';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('reports')
@UseGuards(RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('customer-documents-ocr-pending')
  @ApiOperation({
    summary:
      'G3 — customer documents in OCR queue (PENDING, upload complete, not applied) for a company',
  })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  customerDocumentsOcrPending(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const p = customerDocumentsOcrPendingQuerySchema.safeParse({ companyId, limit });
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    return this.reports.listCustomerDocumentsOcrPending(
      { companyId: p.data.companyId, limit: p.data.limit ?? undefined },
      user,
    );
  }

  @Get('company')
  @ApiOperation({
    summary:
      'Company report — revenue, counts, utilization (G1), CaRGOS totals + daily CaRGOS (UTC) by status',
  })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  company(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ) {
    const p = companyReportQuerySchema.safeParse({ companyId, from, to });
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    return this.reports.getCompanyReport(p.data, user);
  }
}
