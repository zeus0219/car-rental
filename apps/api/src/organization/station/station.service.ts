import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStationInput, UpdateStationInput } from '@car-rental/shared';
import { JwtUser } from '../../auth/types';
import {
  assertCreateBodyCompanyId,
  assertSameCompany,
  effectiveListCompanyFilter,
  isAgentStationScoped,
} from '../../auth/company-access';

@Injectable()
export class StationService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(companyId: string | undefined, user: JwtUser) {
    const f = effectiveListCompanyFilter(user, companyId);
    const where: { companyId?: string; id?: string } = { ...(Object.keys(f).length ? f : {}) };
    if (isAgentStationScoped(user)) {
      where.id = user.stationId!;
    }
    return this.prisma.station.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: [{ companyId: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string, user: JwtUser) {
    const row = await this.getStationOrThrow(id);
    assertSameCompany(user, row.companyId, `Station not found: ${id}`);
    if (isAgentStationScoped(user) && id !== user.stationId) {
      throw new NotFoundException(`Station not found: ${id}`);
    }
    return row;
  }

  async create(data: CreateStationInput, user: JwtUser) {
    assertCreateBodyCompanyId(user, data.companyId);
    const company = await this.prisma.company.findUnique({ where: { id: data.companyId } });
    if (!company) {
      throw new NotFoundException(`Company not found: ${data.companyId}`);
    }
    return this.prisma.station.create({ data: this.toPrismaCreate(data) });
  }

  async update(id: string, data: UpdateStationInput, user: JwtUser) {
    await this.findOne(id, user);
    const d: Record<string, string | null> = {};
    if (data.name !== undefined) d.name = data.name;
    if (data.code !== undefined) d.code = data.code.toUpperCase();
    if (data.addressLine !== undefined) d.addressLine = data.addressLine;
    if (data.city !== undefined) d.city = data.city;
    if (data.province !== undefined) d.province = data.province;
    if (data.postalCode !== undefined) d.postalCode = data.postalCode;
    if (data.country !== undefined) d.country = data.country;
    if (data.timeZone !== undefined) d.timeZone = data.timeZone;
    if (data.cargosLocationCode !== undefined) {
      d.cargosLocationCode = data.cargosLocationCode;
    }
    if (Object.keys(d).length === 0) {
      throw new BadRequestException('No fields to update');
    }
    return this.prisma.station.update({ where: { id }, data: d });
  }

  async remove(id: string, user: JwtUser) {
    await this.findOne(id, user);
    await this.prisma.station.delete({ where: { id } });
  }

  private async getStationOrThrow(id: string) {
    const row = await this.prisma.station.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Station not found: ${id}`);
    }
    return row;
  }

  private toPrismaCreate(data: CreateStationInput) {
    return {
      companyId: data.companyId,
      name: data.name,
      code: data.code.toUpperCase(),
      addressLine: data.addressLine,
      city: data.city,
      province: data.province,
      postalCode: data.postalCode,
      country: data.country,
      timeZone: data.timeZone,
      ...(data.cargosLocationCode != null
        ? { cargosLocationCode: data.cargosLocationCode }
        : {}),
    };
  }
}
