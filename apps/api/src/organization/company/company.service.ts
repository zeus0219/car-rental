import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyInput, UpdateCompanyInput } from '@car-rental/shared';
import { JwtUser } from '../../auth/types';
import { assertCanPatchCompany, assertSameCompany, isAdmin } from '../../auth/company-access';

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: JwtUser) {
    if (isAdmin(user)) {
      return this.prisma.company.findMany({
        orderBy: { name: 'asc' },
      });
    }
    return this.prisma.company.findMany({
      where: { id: user.companyId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: JwtUser) {
    const row = await this.getCompanyOrThrow(id);
    assertSameCompany(user, row.id, `Company not found: ${id}`);
    return row;
  }

  create(data: CreateCompanyInput) {
    return this.prisma.company.create({ data });
  }

  async update(id: string, data: UpdateCompanyInput, user: JwtUser) {
    const row = await this.getCompanyOrThrow(id);
    assertSameCompany(user, row.id, `Company not found: ${id}`);
    assertCanPatchCompany(user, id);
    const dataAny = { ...data } as Record<string, unknown>;
    if (dataAny.cargosHttpUrl === '') {
      dataAny.cargosHttpUrl = null;
    }
    if (dataAny.sdiHttpUrl === '') {
      dataAny.sdiHttpUrl = null;
    }
    return this.prisma.company.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: dataAny as any,
    });
  }

  async remove(id: string) {
    await this.getCompanyOrThrow(id);
    await this.prisma.company.delete({ where: { id } });
  }

  private async getCompanyOrThrow(id: string) {
    const row = await this.prisma.company.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Company not found: ${id}`);
    }
    return row;
  }
}
