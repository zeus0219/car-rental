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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createReservationSchema,
  reservationSourceValues,
  reservationStatusValues,
  updateReservationSchema,
} from '@car-rental/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtUser } from '../auth/types';
import { OPENAPI_JWT } from '../openapi.constants';
import { ReservationService } from './reservation.service';
import type { Request } from 'express';

const reservationStatusEnum = z.enum(reservationStatusValues);

const listQuerySchema = z
  .object({
    companyId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    status: z.preprocess(
      (v) => (v === '' || v == null ? undefined : v),
      reservationStatusEnum.optional(),
    ),
    statuses: z.preprocess((v) => {
      if (typeof v !== 'string' || !v.trim()) {
        return undefined;
      }
      const parts = v.split(',').map((x) => x.trim()).filter(Boolean);
      return parts.length ? parts : undefined;
    }, z.array(reservationStatusEnum).max(20).optional()),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    source: z.enum(reservationSourceValues).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.status && a.statuses?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use either status or statuses, not both',
        path: ['statuses'],
      });
    }
  })
  .refine(
    (a) =>
      Boolean(a.companyId) ||
      Boolean(a.vehicleId) ||
      Boolean(a.customerId) ||
      Boolean(a.status) ||
      Boolean(a.statuses?.length) ||
      (Boolean(a.from) && Boolean(a.to)) ||
      Boolean(a.source),
    {
      message: 'Set companyId, vehicleId, customerId, status, statuses, from+to, or source',
    },
  );

@ApiTags('Reservations')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('reservations')
export class ReservationController {
  constructor(private readonly reservations: ReservationService) {}

  @Get()
  @ApiOperation({ summary: 'List reservations (filters)' })
  list(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('vehicleId') vehicleId: string | undefined,
    @Query('customerId') customerId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('statuses') statuses: string | undefined,
    @Query('from') fromStr: string | undefined,
    @Query('to') toStr: string | undefined,
    @Query('source') source: string | undefined,
  ) {
    const r = listQuerySchema.safeParse({
      companyId,
      vehicleId,
      customerId,
      status,
      statuses,
      from: fromStr,
      to: toStr,
      source,
    });
    if (!r.success) {
      throw new BadRequestException(r.error.flatten().fieldErrors);
    }
    const { from, to, ...rest } = r.data;
    if ((from && !to) || (!from && to)) {
      throw new BadRequestException('from and to must be used together (ISO 8601)');
    }
    return this.reservations.list({ ...rest, from, to }, user);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Reservation summary stats for desk' })
  summary(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
  ) {
    if (!companyId) {
      throw new BadRequestException('companyId is required');
    }
    return this.reservations.getSummary(companyId, user);
  }

  @Post(':id/send-booking-summary-email')
  @ApiOperation({
    summary: 'Email customer a booking summary (quote/total/pickup/return; optional public view link)',
  })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  sendBookingSummaryEmail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.reservations.sendBookingSummaryEmail(id, user, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get reservation with handover gate, ops, damage, etc.' })
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.reservations.getOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create reservation' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  create(
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const data = createReservationSchema.parse(body);
    return this.reservations.create(data, {
      user,
      actorUserId: user.sub,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update reservation' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = updateReservationSchema.parse(body);
    return this.reservations.update(id, data, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete draft reservation' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  @HttpCode(204)
  async removeDraft(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    await this.reservations.removeDraft(id, user);
  }
}
