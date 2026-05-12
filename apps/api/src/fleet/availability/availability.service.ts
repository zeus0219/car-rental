import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { reservationNonBlockingStatusValues } from '@car-rental/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { halfOpenRangesOverlap } from '../intervals';
import { JwtUser } from '../../auth/types';
import { assertAgentAvailabilityStation, assertSameCompany } from '../../auth/company-access';

export type AvailabilityQuery = {
  stationId: string;
  from: Date;
  to: Date;
  vehicleClassId?: string;
  /** When editing a reservation, ignore its own row for slot clashes */
  excludeReservationId?: string;
};

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Vehicles for [from, to): `AVAILABLE`, no **calendar** overlap, and no **active** reservation
   * overlap (all statuses except CANCELLED, COMPLETED, NO_SHOW; see @car-rental/shared).
   */
  async listAvailableVehicles(q: AvailabilityQuery, user: JwtUser) {
    if (q.from >= q.to) {
      throw new BadRequestException('"from" must be before "to"');
    }
    const station = await this.prisma.station.findUnique({ where: { id: q.stationId } });
    if (!station) {
      throw new NotFoundException(`Station not found: ${q.stationId}`);
    }
    assertSameCompany(user, station.companyId, `Station not found: ${q.stationId}`);
    assertAgentAvailabilityStation(user, q.stationId);
    if (q.vehicleClassId) {
      const cls = await this.prisma.vehicleClass.findUnique({ where: { id: q.vehicleClassId } });
      if (!cls) {
        throw new NotFoundException(`Vehicle class not found: ${q.vehicleClassId}`);
      }
      if (cls.companyId !== station.companyId) {
        throw new BadRequestException('Vehicle class does not belong to the same company as the station');
      }
    }
    return this.runAvailabilityForStation(q, station);
  }

  /**
   * Unauthenticated: `companyId` must match the station (and class) — for public quote / availability pages.
   */
  async listAvailableVehiclesPublic(companyId: string, q: AvailabilityQuery) {
    if (q.from >= q.to) {
      throw new BadRequestException('"from" must be before "to"');
    }
    const station = await this.prisma.station.findUnique({ where: { id: q.stationId } });
    if (!station || station.companyId !== companyId) {
      throw new NotFoundException(`Station not found: ${q.stationId}`);
    }
    if (q.vehicleClassId) {
      const cls = await this.prisma.vehicleClass.findUnique({ where: { id: q.vehicleClassId } });
      if (!cls) {
        throw new NotFoundException(`Vehicle class not found: ${q.vehicleClassId}`);
      }
      if (cls.companyId !== station.companyId) {
        throw new BadRequestException('Vehicle class does not belong to the same company as the station');
      }
    }
    return this.runAvailabilityForStation(q, station);
  }

  private async runAvailabilityForStation(
    q: AvailabilityQuery,
    station: { id: string; companyId: string },
  ) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        homeStationId: q.stationId,
        companyId: station.companyId,
        status: 'AVAILABLE',
        ...(q.vehicleClassId && { vehicleClassId: q.vehicleClassId }),
      },
      include: { vehicleClass: true, homeStation: { select: { id: true, name: true, code: true } } },
    });
    if (vehicles.length === 0) {
      return this.emptyPayload(q);
    }
    const ids = vehicles.map((v: { id: string }) => v.id);
    const allBlocks = await this.prisma.calendarBlock.findMany({
      where: { vehicleId: { in: ids } },
    });
    const blocksByVehicle = new Map<string, { vehicleId: string; startsAt: Date; endsAt: Date }[]>();
    for (const b of allBlocks) {
      const list = blocksByVehicle.get(b.vehicleId) ?? [];
      list.push(b);
      blocksByVehicle.set(b.vehicleId, list);
    }
    const free: typeof vehicles = [];
    for (const v of vehicles) {
      const blocks = blocksByVehicle.get(v.id) ?? [];
      const hasOverlap = blocks.some((b) => halfOpenRangesOverlap(q.from, q.to, b.startsAt, b.endsAt));
      if (!hasOverlap) {
        free.push(v);
      }
    }
    if (free.length === 0) {
      return {
        from: q.from,
        to: q.to,
        stationId: q.stationId,
        vehicleClassId: q.vehicleClassId ?? null,
        vehicles: [],
        count: 0,
      };
    }
    const freeIds = free.map((v: { id: string }) => v.id);
    const clashing = await this.prisma.reservation.findMany({
      where: {
        vehicleId: { in: freeIds },
        id: q.excludeReservationId ? { not: q.excludeReservationId } : undefined,
        status: { notIn: [...reservationNonBlockingStatusValues] },
        AND: [{ pickupAt: { lt: q.to } }, { returnAt: { gt: q.from } }],
      },
      select: { vehicleId: true },
    });
    const busy = new Set(clashing.map((c: { vehicleId: string }) => c.vehicleId));
    const available = free.filter((v: (typeof free)[0]) => !busy.has(v.id));
    return {
      from: q.from,
      to: q.to,
      stationId: q.stationId,
      vehicleClassId: q.vehicleClassId ?? null,
      vehicles: available,
      count: available.length,
    };
  }

  private emptyPayload(q: AvailabilityQuery) {
    return {
      from: q.from,
      to: q.to,
      stationId: q.stationId,
      vehicleClassId: q.vehicleClassId ?? null,
      vehicles: [],
      count: 0,
    };
  }
}
