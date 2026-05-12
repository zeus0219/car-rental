import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import { AvailabilityService } from './availability.service';

const querySchema = z.object({
  stationId: z.string().uuid(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  vehicleClassId: z.string().uuid().optional(),
  excludeReservationId: z.string().uuid().optional(),
});

@ApiTags('Fleet')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get('vehicles')
  @ApiOperation({ summary: 'List available vehicles for station / window (desk)' })
  listVehicles(
    @CurrentUser() user: JwtUser,
    @Query('stationId') stationId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('vehicleClassId') vehicleClassId?: string,
    @Query('excludeReservationId') excludeReservationId?: string,
  ) {
    const r = querySchema.safeParse({
      stationId,
      from,
      to,
      vehicleClassId,
      excludeReservationId,
    });
    if (!r.success) {
      throw new BadRequestException(r.error.flatten().fieldErrors);
    }
    return this.availability.listAvailableVehicles(r.data, user);
  }
}
