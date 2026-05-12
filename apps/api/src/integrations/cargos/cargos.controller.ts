import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { cargosEnqueueBodySchema } from '@car-rental/shared';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import { CargosService } from './cargos.service';

@ApiTags('Integrations')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('integrations/cargos')
@UseGuards(RolesGuard)
export class CargosController {
  constructor(private readonly cargos: CargosService) {}

  @Get('submissions')
  @ApiOperation({ summary: 'List CaRGOS submission records' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  list(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('reservationId') reservationId: string | undefined,
  ) {
    return this.cargos.listSubmissions(user, { companyId, reservationId });
  }

  @Post('enqueue')
  @ApiOperation({ summary: 'Enqueue CaRGOS submission (optional sendImmediately: run MOCK/HTTP in API now)' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  enqueue(@Body() body: unknown, @CurrentUser() user: JwtUser) {
    return this.cargos.enqueue(cargosEnqueueBodySchema.parse(body), user);
  }
}
