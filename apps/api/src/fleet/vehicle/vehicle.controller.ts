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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createVehicleSchema, updateVehicleSchema } from '@car-rental/shared';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import { VehicleService } from './vehicle.service';

@ApiTags('Fleet')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('vehicles')
export class VehicleController {
  constructor(private readonly vehicle: VehicleService) {}

  @Get()
  @ApiOperation({ summary: 'List vehicles' })
  list(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('homeStationId') homeStationId: string | undefined,
    @Query('vehicleClassId') vehicleClassId: string | undefined,
  ) {
    return this.vehicle.list({ companyId, homeStationId, vehicleClassId }, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get vehicle' })
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.vehicle.getOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create vehicle' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  create(@Body() body: unknown, @CurrentUser() user: JwtUser) {
    const data = createVehicleSchema.parse(body);
    return this.vehicle.create(data, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update vehicle' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = updateVehicleSchema.parse(body);
    return this.vehicle.update(id, data, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete vehicle' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    await this.vehicle.remove(id, user);
  }
}
