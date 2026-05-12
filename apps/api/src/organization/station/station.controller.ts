import {
  BadRequestException,
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
import { createStationSchema, updateStationSchema } from '@car-rental/shared';
import { z } from 'zod';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import { StationService } from './station.service';

const companyIdQuery = z.string().uuid().optional();

@ApiTags('Organization')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('stations')
export class StationController {
  constructor(private readonly station: StationService) {}

  @Get()
  @ApiOperation({ summary: 'List stations' })
  list(@CurrentUser() user: JwtUser, @Query('companyId') companyId: string | undefined) {
    if (companyId === undefined || companyId === '') {
      return this.station.findAll(undefined, user);
    }
    const r = companyIdQuery.safeParse(companyId);
    if (!r.success) {
      throw new BadRequestException('Invalid companyId');
    }
    return this.station.findAll(r.data, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get station' })
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.station.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create station' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  create(@Body() body: unknown, @CurrentUser() user: JwtUser) {
    const data = createStationSchema.parse(body);
    return this.station.create(data, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update station' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = updateStationSchema.parse(body);
    return this.station.update(id, data, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete station' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    await this.station.remove(id, user);
  }
}
