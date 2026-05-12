import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateVehicleClassInput,
  PutVehicleClassSeasonalRatesInput,
  UpdateVehicleClassInput,
} from '@car-rental/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaClientKnownRequestError } from '../../prisma/prisma-errors';
import { JwtUser } from '../../auth/types';
import {
  assertCreateBodyCompanyId,
  assertSameCompany,
  effectiveListCompanyFilter,
} from '../../auth/company-access';

@Injectable()
export class VehicleClassService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string | undefined, user: JwtUser) {
    const f = effectiveListCompanyFilter(user, companyId);
    return this.prisma.vehicleClass.findMany({
      where: Object.keys(f).length ? f : undefined,
      orderBy: [{ companyId: 'asc' }, { name: 'asc' }],
    });
  }

  async getOne(id: string, user: JwtUser) {
    const row = await this.prisma.vehicleClass.findUnique({
      where: { id },
      include: {
        seasonalRates: { orderBy: [{ priority: 'desc' }, { validFrom: 'asc' }] },
      },
    });
    if (!row) {
      throw new NotFoundException(`Vehicle class not found: ${id}`);
    }
    assertSameCompany(user, row.companyId, `Vehicle class not found: ${id}`);
    return row;
  }

  async create(data: CreateVehicleClassInput, user: JwtUser) {
    assertCreateBodyCompanyId(user, data.companyId);
    const company = await this.prisma.company.findUnique({ where: { id: data.companyId } });
    if (!company) {
      throw new NotFoundException(`Company not found: ${data.companyId}`);
    }
    return this.prisma.vehicleClass.create({
      data: {
        companyId: data.companyId,
        name: data.name,
        code: data.code.toUpperCase(),
        ...(data.defaultDailyCents !== undefined && { defaultDailyCents: data.defaultDailyCents }),
        ...(data.defaultDepositCents !== undefined && { defaultDepositCents: data.defaultDepositCents }),
      },
    });
  }

  async update(id: string, data: UpdateVehicleClassInput, user: JwtUser) {
    await this.getOne(id, user);
    if (data.code !== undefined) {
      data = { ...data, code: data.code.toUpperCase() };
    }
    try {
      return await this.prisma.vehicleClass.update({ where: { id }, data });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Vehicle class code must be unique within the company');
      }
      throw e;
    }
  }

  async remove(id: string, user: JwtUser) {
    await this.getOne(id, user);
    try {
      await this.prisma.vehicleClass.delete({ where: { id } });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException('Cannot delete class: vehicles still reference it');
      }
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException(`Vehicle class not found: ${id}`);
      }
      throw e;
    }
  }

  private async getOrThrow(id: string) {
    const row = await this.prisma.vehicleClass.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Vehicle class not found: ${id}`);
    }
    return row;
  }

  async replaceSeasonalRates(id: string, data: PutVehicleClassSeasonalRatesInput, user: JwtUser) {
    const row = await this.getOrThrow(id);
    assertSameCompany(user, row.companyId, `Vehicle class not found: ${id}`);
    const creates = data.rates.map((r) => ({
      validFrom: new Date(`${r.validFrom}T00:00:00.000Z`),
      validTo: new Date(`${r.validTo}T00:00:00.000Z`),
      dailyCents: r.dailyCents,
      priority: r.priority,
    }));
    return this.prisma.$transaction(async (tx) => {
      await tx.vehicleClassSeasonalRate.deleteMany({ where: { vehicleClassId: id } });
      if (creates.length > 0) {
        await tx.vehicleClassSeasonalRate.createMany({
          data: creates.map((c) => ({ id: randomUUID(), vehicleClassId: id, ...c })),
        });
      }
      return tx.vehicleClass.findUniqueOrThrow({
        where: { id },
        include: {
          seasonalRates: { orderBy: [{ priority: 'desc' }, { validFrom: 'asc' }] },
        },
      });
    });
  }
}
