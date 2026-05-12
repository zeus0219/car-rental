import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createVehicleClassSchema,
  putVehicleClassSeasonalRatesBodySchema,
  updateVehicleClassSchema,
} from '@car-rental/shared';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import { VehicleClassService } from './vehicle-class.service';

@ApiTags('Fleet')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('vehicle-classes')
export class VehicleClassController {
  constructor(private readonly vehicleClass: VehicleClassService) {}

  @Get()
  @ApiOperation({ summary: 'List vehicle classes' })
  list(@CurrentUser() user: JwtUser, @Query('companyId') companyId: string | undefined) {
    return this.vehicleClass.list(companyId, user);
  }

  @Put(':id/seasonal-rates')
  @ApiOperation({ summary: 'Replace seasonal rates for class' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  putSeasonal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = putVehicleClassSeasonalRatesBodySchema.parse(body);
    return this.vehicleClass.replaceSeasonalRates(id, data, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get vehicle class' })
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.vehicleClass.getOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create vehicle class' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  create(@Body() body: unknown, @CurrentUser() user: JwtUser) {
    const data = createVehicleClassSchema.parse(body);
    return this.vehicleClass.create(data, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update vehicle class' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = updateVehicleClassSchema.parse(body);
    return this.vehicleClass.update(id, data, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete vehicle class' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    await this.vehicleClass.remove(id, user);
  }
}
