import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createStaffUserSchema, updateStaffMemberSchema } from '@car-rental/shared';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import { StaffService } from './staff.service';

@ApiTags('Organization')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'List staff (optional company filter for admin)' })
  list(@CurrentUser() user: JwtUser, @Query('companyId') companyId: string | undefined) {
    return this.staff.findAll(companyId, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create staff user (ADMIN); optional temp password' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() body: unknown, @CurrentUser() user: JwtUser, @Req() req: Request) {
    return this.staff.create(createStaffUserSchema.parse(body), user, {
      ip: typeof req.ip === 'string' ? req.ip : undefined,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  @Post(':id/send-setup-email')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resend staff onboarding email (ADMIN); only if user has never signed in',
  })
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  sendSetupEmail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser, @Req() req: Request) {
    return this.staff
      .sendSetupInviteEmail(id, user, {
        ip: typeof req.ip === 'string' ? req.ip : undefined,
        userAgent: req.get('user-agent') ?? undefined,
      })
      .then(() => ({ ok: true as const }));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update staff member (ADMIN)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    return this.staff.update(id, updateStaffMemberSchema.parse(body), user);
  }
}
