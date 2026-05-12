import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  captureDepositBodySchema,
  createCheckoutSessionBodySchema,
  createDepositCheckoutSessionBodySchema,
  createStripeRefundBodySchema,
  publicRentalCheckoutBodySchema,
  reconciliationQuerySchema,
} from '@car-rental/shared';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtUser } from '../auth/types';
import { OPENAPI_JWT } from '../openapi.constants';
import { PaymentsService } from './payments.service';

@ApiTags('Integrations')
@Controller('payments/stripe')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('reconciliation')
  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Stripe reconciliation (JSON or CSV export)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  async getReconciliation(
    @Query('companyId') companyId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    const p = reconciliationQuerySchema.safeParse({
      companyId,
      from,
      to,
      format: format ?? 'json',
    });
    if (!p.success) {
      throw new BadRequestException(p.error.flatten());
    }
    const out = await this.payments.getReconciliation(p.data, user);
    if (out.format === 'csv') {
      return new StreamableFile(Buffer.from(out.csv, 'utf-8'), {
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="${out.filename}"`,
      });
    }
    return out.body;
  }

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Whether Stripe is configured ({ stripe: boolean })' })
  status() {
    return this.payments.getStripeAvailable();
  }

  /** C1: public pays rent for a PUBLIC_WEB quote (email must match reservation; throttled). */
  @Public()
  @ApiOperation({ summary: 'Public rental Stripe Checkout session' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('public/reservations/:reservationId/rental-checkout')
  async publicRentalCheckout(
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
    @Body() body: unknown,
  ) {
    const p = publicRentalCheckoutBodySchema.safeParse(body);
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    return this.payments.createPublicRentalCheckoutSession(reservationId, p.data);
  }

  @Post('reservations/:reservationId/checkout-session')
  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Desk — create rental Checkout session' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  async createCheckout(
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
    @CurrentUser() user: JwtUser,
    @Body() body: unknown,
  ) {
    const data = createCheckoutSessionBodySchema.parse(body);
    return this.payments.createCheckoutSession(reservationId, user, data);
  }

  @Post('reservations/:reservationId/deposit-checkout-session')
  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Desk — create deposit hold Checkout session' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  async createDepositCheckout(
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
    @CurrentUser() user: JwtUser,
    @Body() body: unknown,
  ) {
    const data = createDepositCheckoutSessionBodySchema.parse(body);
    return this.payments.createDepositCheckoutSession(reservationId, user, data);
  }

  @Post('reservations/:reservationId/capture-deposit')
  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Capture held deposit (optional partial amount in body; remainder of hold released)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  captureDeposit(
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
    @CurrentUser() user: JwtUser,
    @Body() body: unknown,
  ) {
    const data = captureDepositBodySchema.parse(body ?? {});
    return this.payments.captureDeposit(reservationId, user, data);
  }

  @Post('reservations/:reservationId/cancel-deposit')
  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Cancel / release deposit hold' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  cancelDeposit(
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.payments.cancelDepositHold(reservationId, user);
  }

  @Post('reservations/:reservationId/refund')
  @ApiBearerAuth(OPENAPI_JWT)
  @ApiOperation({ summary: 'Create Stripe refund (payment intent)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  async refund(
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
    @CurrentUser() user: JwtUser,
    @Body() body: unknown,
  ) {
    const data = createStripeRefundBodySchema.parse(body);
    return this.payments.createRefund(reservationId, user, data);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Stripe webhook (raw body; no JWT)' })
  @HttpCode(200)
  @Public()
  @SkipThrottle()
  handleWebhook(@Req() req: RawBodyRequest<Request>) {
    return this.payments.handleStripeWebhook(req);
  }
}
