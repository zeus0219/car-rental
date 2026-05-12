import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateCalendarBlockInput, UpdateCalendarBlockInput } from '@car-rental/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaClientKnownRequestError } from '../../prisma/prisma-errors';
import { halfOpenRangesOverlap } from '../intervals';
import { JwtUser } from '../../auth/types';
import { assertAgentVehicleHomeBranch, assertSameCompany, isAdmin, isAgentStationScoped } from '../../auth/company-access';

@Injectable()
export class CalendarBlockService {
  constructor(private readonly prisma: PrismaService) {}

  async list(vehicleId: string | undefined, companyId: string | undefined, user: JwtUser) {
    if (vehicleId) {
      const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
      if (!vehicle) {
        throw new NotFoundException(`Vehicle not found: ${vehicleId}`);
      }
      assertSameCompany(user, vehicle.companyId, `Vehicle not found: ${vehicleId}`);
      assertAgentVehicleHomeBranch(user, vehicle.homeStationId, `Vehicle not found: ${vehicleId}`);
      return this.prisma.calendarBlock.findMany({
        where: { vehicleId },
        orderBy: { startsAt: 'asc' },
      });
    }

    let filterCompanyId: string | undefined;
    if (isAdmin(user)) {
      const q = companyId?.trim();
      filterCompanyId = q || undefined;
      if (!filterCompanyId) {
        return [];
      }
    } else {
      filterCompanyId = user.companyId;
      if (companyId?.trim() && companyId.trim() !== user.companyId) {
        throw new ForbiddenException('Not allowed to access this company');
      }
    }

    const vehicleWhere: { companyId: string; homeStationId?: string } = {
      companyId: filterCompanyId,
    };
    if (isAgentStationScoped(user)) {
      vehicleWhere.homeStationId = user.stationId!;
    }
    return this.prisma.calendarBlock.findMany({
      where: { vehicle: vehicleWhere },
      orderBy: { startsAt: 'asc' },
    });
  }

  async getOne(id: string, user: JwtUser) {
    const row = await this.prisma.calendarBlock.findUnique({
      where: { id },
      include: { vehicle: { select: { companyId: true, homeStationId: true } } },
    });
    if (!row) {
      throw new NotFoundException(`Calendar block not found: ${id}`);
    }
    assertSameCompany(user, row.vehicle.companyId, `Calendar block not found: ${id}`);
    assertAgentVehicleHomeBranch(user, row.vehicle.homeStationId, `Calendar block not found: ${id}`);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { vehicle, ...out } = row;
    return out;
  }

  async create(data: CreateCalendarBlockInput, user: JwtUser) {
    this.assertTimeOrder(data.startsAt, data.endsAt);
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: data.vehicleId } });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle not found: ${data.vehicleId}`);
    }
    assertSameCompany(user, vehicle.companyId, `Vehicle not found: ${data.vehicleId}`);
    assertAgentVehicleHomeBranch(user, vehicle.homeStationId, `Vehicle not found: ${data.vehicleId}`);
    await this.assertNoBlockOverlap(vehicle.id, data.startsAt, data.endsAt);
    return this.prisma.calendarBlock.create({
      data: {
        vehicleId: data.vehicleId,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        ...(data.type != null && { type: data.type }),
        ...(data.reason != null && { reason: data.reason }),
      },
    });
  }

  async update(id: string, data: UpdateCalendarBlockInput, user: JwtUser) {
    const current = await this.getOne(id, user);
    const start = data.startsAt ?? current.startsAt;
    const end = data.endsAt ?? current.endsAt;
    this.assertTimeOrder(start, end);
    await this.assertNoBlockOverlap(current.vehicleId, start, end, { excludeId: id });
    const d: Record<string, unknown> = {};
    if (data.startsAt !== undefined) d.startsAt = data.startsAt;
    if (data.endsAt !== undefined) d.endsAt = data.endsAt;
    if (data.type !== undefined) d.type = data.type;
    if (data.reason !== undefined) d.reason = data.reason;
    if (Object.keys(d).length === 0) {
      return this.getOne(id, user);
    }
    return this.prisma.calendarBlock.update({ where: { id }, data: d });
  }

  async remove(id: string, user: JwtUser) {
    await this.getOne(id, user);
    try {
      await this.prisma.calendarBlock.delete({ where: { id } });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException(`Calendar block not found: ${id}`);
      }
      throw e;
    }
  }

  private assertTimeOrder(startsAt: Date, endsAt: Date) {
    if (startsAt >= endsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
  }

  private async assertNoBlockOverlap(
    vehicleId: string,
    startsAt: Date,
    endsAt: Date,
    opts: { excludeId?: string } = {},
  ) {
    const others = await this.prisma.calendarBlock.findMany({ where: { vehicleId } });
    for (const b of others) {
      if (opts.excludeId && b.id === opts.excludeId) {
        continue;
      }
      if (halfOpenRangesOverlap(startsAt, endsAt, b.startsAt, b.endsAt)) {
        throw new ConflictException('Calendar block overlaps an existing block for this vehicle');
      }
    }
  }
}
