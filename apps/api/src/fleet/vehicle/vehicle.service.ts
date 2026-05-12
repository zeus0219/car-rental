import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateVehicleInput, UpdateVehicleInput } from '@car-rental/shared';
import type { VehicleRentPricingMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaClientKnownRequestError } from '../../prisma/prisma-errors';
import { JwtUser } from '../../auth/types';
import {
  assertAgentVehicleHomeBranch,
  assertCreateBodyCompanyId,
  assertSameCompany,
  effectiveListCompanyFilter,
  isAgentStationScoped,
} from '../../auth/company-access';

@Injectable()
export class VehicleService {
  constructor(private readonly prisma: PrismaService) {}

  private assertMergedPricing(
    mode: VehicleRentPricingMode,
    override: number | null,
    flat: number | null,
  ) {
    if (mode === 'USE_CLASS') {
      if (override != null || flat != null) {
        throw new BadRequestException(
          'Per-vehicle rent amounts apply only to FIXED_DAILY or FLAT_TRIP; use class pricing or clear amounts',
        );
      }
      return;
    }
    if (mode === 'FIXED_DAILY') {
      if (override == null || override < 0) {
        throw new BadRequestException('FIXED_DAILY requires rentOverrideDailyCents (≥ 0 cents per 24h day)');
      }
      if (flat != null) {
        throw new BadRequestException('FIXED_DAILY cannot set flatTripRentCents');
      }
      return;
    }
    if (mode === 'FLAT_TRIP') {
      if (flat == null || flat < 0) {
        throw new BadRequestException('FLAT_TRIP requires flatTripRentCents (≥ 0 cents for the trip)');
      }
      if (override != null) {
        throw new BadRequestException('FLAT_TRIP cannot set rentOverrideDailyCents');
      }
    }
  }

  list(
    filters: { companyId?: string; homeStationId?: string; vehicleClassId?: string },
    user: JwtUser,
  ) {
    const c = effectiveListCompanyFilter(user, filters.companyId);
    let homeStationId = filters.homeStationId;
    if (isAgentStationScoped(user)) {
      if (homeStationId && homeStationId !== user.stationId) {
        throw new ForbiddenException('List vehicles only for your assigned station');
      }
      homeStationId = user.stationId!;
    }
    return this.prisma.vehicle.findMany({
      where: {
        ...(Object.keys(c).length ? c : {}),
        ...(homeStationId && { homeStationId }),
        ...(filters.vehicleClassId && { vehicleClassId: filters.vehicleClassId }),
      },
      orderBy: [{ homeStationId: 'asc' }, { licensePlate: 'asc' }],
      include: { vehicleClass: true, homeStation: { select: { id: true, name: true, code: true } } },
    });
  }

  async getOne(id: string, user: JwtUser) {
    const row = await this.prisma.vehicle.findUnique({
      where: { id },
      include: { vehicleClass: true, homeStation: true },
    });
    if (!row) {
      throw new NotFoundException(`Vehicle not found: ${id}`);
    }
    assertSameCompany(user, row.companyId, `Vehicle not found: ${id}`);
    assertAgentVehicleHomeBranch(user, row.homeStationId, `Vehicle not found: ${id}`);
    return row;
  }

  async create(data: CreateVehicleInput, user: JwtUser) {
    assertCreateBodyCompanyId(user, data.companyId);
    assertAgentVehicleHomeBranch(user, data.homeStationId, `Station not found: ${data.homeStationId}`);
    await this.assertCompanyCoherence(
      data.companyId,
      data.vehicleClassId,
      data.homeStationId,
    );
    const mode = data.rentPricingMode ?? 'USE_CLASS';
    let o: number | null = data.rentOverrideDailyCents ?? null;
    let f: number | null = data.flatTripRentCents ?? null;
    if (mode === 'USE_CLASS') {
      o = null;
      f = null;
    } else if (mode === 'FIXED_DAILY') {
      f = null;
    } else {
      o = null;
    }
    this.assertMergedPricing(mode, o, f);
    try {
      return await this.prisma.vehicle.create({
        data: {
          companyId: data.companyId,
          vehicleClassId: data.vehicleClassId,
          homeStationId: data.homeStationId,
          licensePlate: data.licensePlate.toUpperCase(),
          vehicleType: data.vehicleType,
          vin: data.vin,
          status: data.status,
          odometerKm: data.odometerKm,
          acquiredAt: data.acquiredAt,
          nextServiceDueOdometerKm: data.nextServiceDueOdometerKm,
          autoServiceBlockHours: data.autoServiceBlockHours ?? undefined,
          fuelType: data.fuelType,
          modelLabel: data.modelLabel,
          coverImageUrl: data.coverImageUrl?.trim() || undefined,
          rentPricingMode: mode,
          rentOverrideDailyCents: o,
          flatTripRentCents: f,
        },
        include: { vehicleClass: true, homeStation: { select: { id: true, name: true, code: true } } },
      });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('License plate must be unique within the company');
      }
      throw e;
    }
  }

  async update(id: string, data: UpdateVehicleInput, user: JwtUser) {
    const existing = await this.getOne(id, user);
    const classId = data.vehicleClassId ?? existing.vehicleClassId;
    const stationId = data.homeStationId ?? existing.homeStationId;
    if (data.homeStationId !== undefined) {
      assertAgentVehicleHomeBranch(user, data.homeStationId, `Station not found: ${data.homeStationId}`);
    }
    await this.assertCompanyCoherence(existing.companyId, classId, stationId);
    const d: Record<string, unknown> = {};
    if (data.vehicleClassId !== undefined) d.vehicleClassId = data.vehicleClassId;
    if (data.homeStationId !== undefined) d.homeStationId = data.homeStationId;
    if (data.licensePlate !== undefined) d.licensePlate = data.licensePlate.toUpperCase();
    if (data.vehicleType !== undefined) d.vehicleType = data.vehicleType;
    if (data.vin !== undefined) d.vin = data.vin;
    if (data.status !== undefined) d.status = data.status;
    if (data.odometerKm !== undefined) d.odometerKm = data.odometerKm;
    if (data.acquiredAt !== undefined) d.acquiredAt = data.acquiredAt;
    if (data.nextServiceDueOdometerKm !== undefined) {
      d.nextServiceDueOdometerKm = data.nextServiceDueOdometerKm;
      d.serviceDueAutoBlockedForKm = null;
    }
    if (data.autoServiceBlockHours !== undefined) {
      d.autoServiceBlockHours = data.autoServiceBlockHours;
      if (data.autoServiceBlockHours == null) {
        d.serviceDueAutoBlockedForKm = null;
      }
    }
    if (data.fuelType !== undefined) d.fuelType = data.fuelType;
    if (data.modelLabel !== undefined) d.modelLabel = data.modelLabel;
    if (data.coverImageUrl !== undefined) {
      const u = data.coverImageUrl?.trim();
      d.coverImageUrl = u === '' || u == null ? null : u;
    }
    const pricingTouched =
      data.rentPricingMode !== undefined ||
      data.rentOverrideDailyCents !== undefined ||
      data.flatTripRentCents !== undefined;
    if (pricingTouched) {
      const mode = data.rentPricingMode ?? existing.rentPricingMode;
      const overrideRaw =
        data.rentOverrideDailyCents !== undefined
          ? data.rentOverrideDailyCents
          : existing.rentOverrideDailyCents;
      const flatRaw =
        data.flatTripRentCents !== undefined ? data.flatTripRentCents : existing.flatTripRentCents;
      let o = overrideRaw;
      let f = flatRaw;
      if (data.rentPricingMode === 'USE_CLASS') {
        o = null;
        f = null;
      } else if (data.rentPricingMode === 'FIXED_DAILY') {
        f = null;
      } else if (data.rentPricingMode === 'FLAT_TRIP') {
        o = null;
      }
      this.assertMergedPricing(mode, o, f);
      d.rentPricingMode = mode;
      d.rentOverrideDailyCents = o;
      d.flatTripRentCents = f;
    }
    if (Object.keys(d).length === 0) {
      return existing;
    }
    try {
      return await this.prisma.vehicle.update({
        where: { id },
        data: d,
        include: { vehicleClass: true, homeStation: { select: { id: true, name: true, code: true } } },
      });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('License plate must be unique within the company');
      }
      throw e;
    }
  }

  async remove(id: string, user: JwtUser) {
    await this.getOne(id, user);
    try {
      await this.prisma.vehicle.delete({ where: { id } });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException(`Vehicle not found: ${id}`);
      }
      throw e;
    }
  }

  /** Ensures class and station belong to the same company. */
  private async assertCompanyCoherence(companyId: string, classId: string, stationId: string) {
    const [vClass, station] = await Promise.all([
      this.prisma.vehicleClass.findUnique({ where: { id: classId } }),
      this.prisma.station.findUnique({ where: { id: stationId } }),
    ]);
    if (!vClass) {
      throw new NotFoundException(`Vehicle class not found: ${classId}`);
    }
    if (!station) {
      throw new NotFoundException(`Station not found: ${stationId}`);
    }
    if (vClass.companyId !== companyId) {
      throw new BadRequestException('Vehicle class does not belong to the same company as the vehicle');
    }
    if (station.companyId !== companyId) {
      throw new BadRequestException('Home station does not belong to the same company as the vehicle');
    }
  }
}
