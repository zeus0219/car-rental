import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PublicCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async getCatalog(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    const [stations, vehicleClasses, privacyNotices] = await Promise.all([
      this.prisma.station.findMany({
        where: { companyId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true, city: true, province: true },
      }),
      this.prisma.vehicleClass.findMany({
        where: { companyId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true, defaultDailyCents: true, defaultDepositCents: true },
      }),
      this.prisma.companyPrivacyNotice.findMany({
        where: { companyId },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'asc' }],
        select: { version: true, policyUrl: true, effectiveFrom: true },
      }),
    ]);
    return { company, stations, vehicleClasses, privacyNotices };
  }
}
