import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { rateQuoteQuerySchema } from '@car-rental/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtUser } from '../auth/types';
import { OPENAPI_JWT } from '../openapi.constants';
import { RateService } from './rate.service';

@ApiTags('Pricing')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('rates')
export class RateController {
  constructor(private readonly rates: RateService) {}

  @Get('quote')
  @ApiOperation({ summary: 'Quote rent (seasonal rates + one-way)' })
  quote(
    @CurrentUser() user: JwtUser,
    @Query('vehicleClassId') vehicleClassId: string,
    @Query('pickupAt') pickupAt: string,
    @Query('returnAt') returnAt: string,
    @Query('pickupStationId') pickupStationId: string | undefined,
    @Query('returnStationId') returnStationId: string | undefined,
  ) {
    const r = rateQuoteQuerySchema.safeParse({
      vehicleClassId,
      pickupAt,
      returnAt,
      pickupStationId,
      returnStationId,
    });
    if (!r.success) {
      throw new BadRequestException(r.error.flatten().fieldErrors);
    }
    return this.rates.quote(r.data, user);
  }
}
