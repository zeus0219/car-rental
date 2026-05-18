import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

export type B4ConsentAuditSnapshot = {
  privacyNoticeVersion: string | null;
  privacyNoticeAcceptedAt: string | null;
  marketingEmailOptIn: boolean;
  marketingOptInAt: string | null;
};

function b4Snapshot(row: {
  privacyNoticeVersion: string | null;
  privacyNoticeAcceptedAt: Date | null;
  marketingEmailOptIn: boolean;
  marketingOptInAt: Date | null;
}): B4ConsentAuditSnapshot {
  return {
    privacyNoticeVersion: row.privacyNoticeVersion,
    privacyNoticeAcceptedAt: row.privacyNoticeAcceptedAt?.toISOString() ?? null,
    marketingEmailOptIn: row.marketingEmailOptIn,
    marketingOptInAt: row.marketingOptInAt?.toISOString() ?? null,
  };
}

/**
 * B4: when the company has a privacy-notice register, desk emails with guest PII require a linked
 * customer with a registered `privacyNoticeVersion` and acceptance timestamp.
 */
export async function assertDeskEmailB4ForReservation(
  prisma: PrismaService,
  args: { companyId: string; customerId: string | null },
): Promise<{ b4Consent: B4ConsentAuditSnapshot | null; customerId: string | null }> {
  const notices = await prisma.companyPrivacyNotice.findMany({
    where: { companyId: args.companyId },
    select: { version: true },
  });
  if (notices.length === 0) {
    return { b4Consent: null, customerId: args.customerId };
  }
  if (!args.customerId) {
    throw new BadRequestException(
      'Link a customer with an accepted privacy notice (B4) before emailing this guest. The company privacy register requires a recorded notice version on the customer profile.',
    );
  }
  const customer = await prisma.customer.findUnique({
    where: { id: args.customerId },
    select: {
      companyId: true,
      anonymizedAt: true,
      privacyNoticeVersion: true,
      privacyNoticeAcceptedAt: true,
      marketingEmailOptIn: true,
      marketingOptInAt: true,
    },
  });
  if (!customer || customer.companyId !== args.companyId) {
    throw new BadRequestException('Linked customer not found for this company.');
  }
  if (customer.anonymizedAt) {
    throw new BadRequestException('Cannot email an anonymized customer profile (B4).');
  }
  const version = customer.privacyNoticeVersion?.trim();
  if (!version || !customer.privacyNoticeAcceptedAt) {
    throw new BadRequestException(
      'Customer must have privacyNoticeVersion and acceptance recorded (B4) before emailing.',
    );
  }
  if (!notices.some((n) => n.version === version)) {
    throw new BadRequestException(
      'Customer privacy notice version must match an entry in the company privacy register (B4).',
    );
  }
  return { b4Consent: b4Snapshot(customer), customerId: args.customerId };
}
