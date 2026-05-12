import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  publicAvailabilityQuerySchema,
  publicCatalogQuerySchema,
  publicCreateQuoteBatchBodySchema,
  publicCreateQuoteBodySchema,
  publicMagicLinkQuerySchema,
  publicRateQuoteQuerySchema,
  publicRequestBookingViewLinkBodySchema,
  publicViewTokenQuerySchema,
} from '@car-rental/shared';
import { Public } from '../auth/public.decorator';
import { RateService } from '../pricing/rate.service';
import { AvailabilityService } from '../fleet/availability/availability.service';
import { ReservationService } from '../reservation/reservation.service';
import { PublicCatalogService } from './public-catalog.service';
import type { Request } from 'express';

@ApiTags('Public')
@Controller('public')
@Public()
export class PublicController {
  constructor(
    private readonly catalog: PublicCatalogService,
    private readonly rates: RateService,
    private readonly availability: AvailabilityService,
    private readonly reservations: ReservationService,
  ) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Public catalog — stations, classes (requires companyId)' })
  @Throttle({ default: { limit: 50, ttl: 60_000 } })
  getCatalog(@Query('companyId') companyId: string) {
    const p = publicCatalogQuerySchema.safeParse({ companyId });
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    return this.catalog.getCatalog(p.data.companyId);
  }

  @Get('quote')
  @ApiOperation({ summary: 'Public rate quote (same math as desk rate quote)' })
  @Throttle({ default: { limit: 50, ttl: 60_000 } })
  getQuote(
    @Query('companyId') companyId: string,
    @Query('vehicleClassId') vehicleClassId: string,
    @Query('pickupAt') pickupAt: string,
    @Query('returnAt') returnAt: string,
    @Query('pickupStationId') pickupStationId: string | undefined,
    @Query('returnStationId') returnStationId: string | undefined,
  ) {
    const p = publicRateQuoteQuerySchema.safeParse({
      companyId,
      vehicleClassId,
      pickupAt,
      returnAt,
      pickupStationId,
      returnStationId,
    });
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    const { companyId: cid, ...q } = p.data;
    return this.rates.quotePublic(q, cid);
  }

  @Get('availability/vehicles')
  @ApiOperation({ summary: 'List available vehicles for public quote flow' })
  @Throttle({ default: { limit: 50, ttl: 60_000 } })
  getAvailability(
    @Query('companyId') companyId: string,
    @Query('stationId') stationId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('vehicleClassId') vehicleClassId: string | undefined,
  ) {
    const p = publicAvailabilityQuerySchema.safeParse({
      companyId,
      stationId,
      from,
      to,
      vehicleClassId,
    });
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    const { companyId: cid, ...q } = p.data;
    return this.availability.listAvailableVehiclesPublic(cid, {
      ...q,
      vehicleClassId: q.vehicleClassId,
    });
  }

  @Post('quote-reservations')
  @ApiOperation({ summary: 'Create PUBLIC_WEB quote reservation (first free vehicle in class)' })
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  createQuoteReservation(@Body() body: unknown, @Req() req: Request) {
    const p = publicCreateQuoteBodySchema.safeParse(body);
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    return this.reservations.createPublicQuote(p.data, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  @Post('quote-reservations/batch')
  @ApiOperation({ summary: 'Create multiple PUBLIC_WEB quote reservations (basket; same trip)' })
  @HttpCode(201)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  createQuoteReservationBatch(@Body() body: unknown, @Req() req: Request) {
    const p = publicCreateQuoteBatchBodySchema.safeParse(body);
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    return this.reservations.createPublicQuoteBatch(p.data, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  /** C3: read-only “view my booking” for `PUBLIC_WEB` — `token` (bookmark) or time-limited `magic` (email recovery). */
  @Get('reservations/by-view-token')
  @ApiOperation({ summary: 'Read-only booking summary by publicViewToken or magic link' })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getReservationByViewToken(
    @Query('token') token: string | undefined,
    @Query('magic') magic: string | undefined,
  ) {
    const tok = token?.trim();
    const mag = magic?.trim();
    if (tok && mag) {
      throw new BadRequestException('Provide either token or magic, not both');
    }
    if (mag) {
      const p = publicMagicLinkQuerySchema.safeParse({ magic: mag });
      if (!p.success) {
        throw new BadRequestException(p.error.flatten().fieldErrors);
      }
      return this.reservations.getPublicReservationByMagicLink(p.data.magic);
    }
    if (tok) {
      const p = publicViewTokenQuerySchema.safeParse({ token: tok });
      if (!p.success) {
        throw new BadRequestException(p.error.flatten().fieldErrors);
      }
      return this.reservations.getPublicReservationByViewToken(p.data.token);
    }
    throw new BadRequestException('token or magic is required');
  }

  /** C3: request a time-limited magic link by email (anti-enumeration: always returns ok). */
  @Post('reservations/request-view-link')
  @HttpCode(200)
  @ApiOperation({ summary: 'Email a time-limited booking view link (PUBLIC_WEB + email match)' })
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  requestBookingViewLink(@Body() body: unknown, @Req() req: Request) {
    const p = publicRequestBookingViewLinkBodySchema.safeParse(body);
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    return this.reservations.requestPublicBookingViewLink(p.data, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }
}
