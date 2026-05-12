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
import { createCalendarBlockSchema, updateCalendarBlockSchema } from '@car-rental/shared';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import { CalendarBlockService } from './calendar-block.service';

@ApiTags('Fleet')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('calendar-blocks')
export class CalendarBlockController {
  constructor(private readonly blocks: CalendarBlockService) {}

  @Get()
  @ApiOperation({ summary: 'List calendar blocks' })
  list(
    @CurrentUser() user: JwtUser,
    @Query('vehicleId') vehicleId: string | undefined,
    @Query('companyId') companyId: string | undefined,
  ) {
    return this.blocks.list(vehicleId, companyId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get calendar block' })
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.blocks.getOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create calendar block' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  create(@Body() body: unknown, @CurrentUser() user: JwtUser) {
    const data = createCalendarBlockSchema.parse(body);
    return this.blocks.create(data, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update calendar block' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = updateCalendarBlockSchema.parse(body);
    return this.blocks.update(id, data, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete calendar block' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    await this.blocks.remove(id, user);
  }
}
