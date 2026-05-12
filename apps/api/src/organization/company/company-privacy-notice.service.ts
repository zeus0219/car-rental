import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateCompanyPrivacyNoticeBody } from '@car-rental/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtUser } from '../../auth/types';
import { assertCanPatchCompany, assertSameCompany } from '../../auth/company-access';
import { AuditService } from '../../audit/audit.service';
import { PrismaClientKnownRequestError } from '../../prisma/prisma-errors';

@Injectable()
export class CompanyPrivacyNoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string, user: JwtUser) {
    await this.assertCompanyReadable(companyId, user);
    return this.prisma.companyPrivacyNotice.findMany({
      where: { companyId },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'asc' }],
    });
  }

  async create(companyId: string, body: CreateCompanyPrivacyNoticeBody, user: JwtUser) {
    await this.assertCompanyReadable(companyId, user);
    assertCanPatchCompany(user, companyId);
    const effectiveFrom =
      body.effectiveFrom && body.effectiveFrom.length > 0
        ? new Date(`${body.effectiveFrom}T00:00:00.000Z`)
        : null;
    try {
      const row = await this.prisma.companyPrivacyNotice.create({
        data: {
          companyId,
          version: body.version,
          policyUrl: body.policyUrl ?? null,
          effectiveFrom,
          notes: body.notes ?? null,
        },
      });
      await this.audit.log({
        userId: user.sub,
        action: 'company.privacy_notice.create',
        entity: 'Company',
        entityId: companyId,
        metadata: {
          noticeId: row.id,
          version: row.version,
          policyUrl: row.policyUrl ?? undefined,
          effectiveFrom: body.effectiveFrom ?? undefined,
        },
      });
      return row;
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A privacy notice with this version already exists for this company');
      }
      throw e;
    }
  }

  async remove(companyId: string, noticeId: string, user: JwtUser) {
    await this.assertCompanyReadable(companyId, user);
    assertCanPatchCompany(user, companyId);
    const row = await this.prisma.companyPrivacyNotice.findFirst({
      where: { id: noticeId, companyId },
    });
    if (!row) {
      throw new NotFoundException('Privacy notice not found');
    }
    await this.prisma.companyPrivacyNotice.delete({ where: { id: noticeId } });
    await this.audit.log({
      userId: user.sub,
      action: 'company.privacy_notice.delete',
      entity: 'Company',
      entityId: companyId,
      metadata: { noticeId, version: row.version },
    });
    return { ok: true as const };
  }

  private async assertCompanyReadable(companyId: string, user: JwtUser) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      throw new NotFoundException(`Company not found: ${companyId}`);
    }
    assertSameCompany(user, company.id, `Company not found: ${companyId}`);
  }
}
