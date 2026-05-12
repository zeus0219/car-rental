import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { countRentalDays24h, type RateQuoteQuery, sumClassRentCents24h } from '@car-rental/shared';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../auth/types';
import { assertAgentMayUsePickupStation, assertSameCompany } from '../auth/company-access';

@Injectable()
export class RateService {
  constructor(private readonly prisma: PrismaService) {}

  async quote(q: RateQuoteQuery, user: JwtUser) {
    if (!(q.returnAt > q.pickupAt)) {
      throw new BadRequestException('returnAt must be after pickupAt');
    }
    const cls = await this.prisma.vehicleClass.findUnique({
      where: { id: q.vehicleClassId },
      include: { seasonalRates: true },
    });
    if (!cls) {
      throw new NotFoundException(`Vehicle class not found: ${q.vehicleClassId}`);
    }
    assertSameCompany(user, cls.companyId, `Vehicle class not found: ${q.vehicleClassId}`);
    const company = await this.prisma.company.findUnique({ where: { id: cls.companyId } });
    if (!company) {
      throw new NotFoundException(`Company not found: ${cls.companyId}`);
    }
    let oneWayCents = 0;
    if (q.pickupStationId) {
      assertAgentMayUsePickupStation(user, q.pickupStationId);
    }
    if (q.pickupStationId && q.returnStationId) {
      if (q.pickupStationId !== q.returnStationId) {
        const [pu, re] = await Promise.all([
          this.prisma.station.findUnique({ where: { id: q.pickupStationId } }),
          this.prisma.station.findUnique({ where: { id: q.returnStationId } }),
        ]);
        if (!pu || !re) {
          throw new NotFoundException('Pickup or return station not found for quote');
        }
        if (pu.companyId !== cls.companyId || re.companyId !== cls.companyId) {
          throw new BadRequestException('Stations must belong to the same company as the vehicle class');
        }
        oneWayCents = company.oneWayFeeCents ?? 0;
      }
    }
    const rentalDays = countRentalDays24h(q.pickupAt, q.returnAt);
    const daily = cls.defaultDailyCents;
    const rentCents = sumClassRentCents24h(
      daily,
      cls.seasonalRates.map((s) => ({
        validFrom: s.validFrom,
        validTo: s.validTo,
        dailyCents: s.dailyCents,
        priority: s.priority,
      })),
      q.pickupAt,
      q.returnAt,
    );
    const totalCents =
      rentCents == null
        ? oneWayCents > 0
          ? oneWayCents
          : null
        : rentCents + oneWayCents;
    return {
      vehicleClassId: cls.id,
      companyId: cls.companyId,
      pickupAt: q.pickupAt,
      returnAt: q.returnAt,
      rentalDays,
      defaultDailyCents: daily,
      subtotalCents: rentCents,
      oneWayCents,
      totalCents,
      defaultDepositCents: cls.defaultDepositCents,
      currency: 'EUR' as const,
      pricingModel: 'PER_CLASS_DAY_24H' as const,
    };
  }

  /** No JWT: caller must know `companyId` (e.g. from marketing / quote page); same math as `quote` without staff scoping */
  async quotePublic(q: RateQuoteQuery, companyId: string) {
    if (!(q.returnAt > q.pickupAt)) {
      throw new BadRequestException('returnAt must be after pickupAt');
    }
    const cls = await this.prisma.vehicleClass.findUnique({
      where: { id: q.vehicleClassId },
      include: { seasonalRates: true },
    });
    if (!cls) {
      throw new NotFoundException(`Vehicle class not found: ${q.vehicleClassId}`);
    }
    if (cls.companyId !== companyId) {
      throw new NotFoundException(`Vehicle class not found: ${q.vehicleClassId}`);
    }
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    let oneWayCents = 0;
    if (q.pickupStationId && q.returnStationId) {
      if (q.pickupStationId !== q.returnStationId) {
        const [pu, re] = await Promise.all([
          this.prisma.station.findUnique({ where: { id: q.pickupStationId } }),
          this.prisma.station.findUnique({ where: { id: q.returnStationId } }),
        ]);
        if (!pu || !re) {
          throw new NotFoundException('Pickup or return station not found for quote');
        }
        if (pu.companyId !== companyId || re.companyId !== companyId) {
          throw new BadRequestException('Stations must belong to the same company as the vehicle class');
        }
        oneWayCents = company.oneWayFeeCents ?? 0;
      }
    }
    const rentalDays = countRentalDays24h(q.pickupAt, q.returnAt);
    const daily = cls.defaultDailyCents;
    const rentCents = sumClassRentCents24h(
      daily,
      cls.seasonalRates.map((s) => ({
        validFrom: s.validFrom,
        validTo: s.validTo,
        dailyCents: s.dailyCents,
        priority: s.priority,
      })),
      q.pickupAt,
      q.returnAt,
    );
    const totalCents =
      rentCents == null
        ? oneWayCents > 0
          ? oneWayCents
          : null
        : rentCents + oneWayCents;
    return {
      vehicleClassId: cls.id,
      companyId: cls.companyId,
      pickupAt: q.pickupAt,
      returnAt: q.returnAt,
      rentalDays,
      defaultDailyCents: daily,
      subtotalCents: rentCents,
      oneWayCents,
      totalCents,
      defaultDepositCents: cls.defaultDepositCents,
      currency: 'EUR' as const,
      pricingModel: 'PER_CLASS_DAY_24H' as const,
    };
  }
}
