import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw === '') {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

/**
 * C2: one-time email nudge for unpaid `PUBLIC_WEB` QUOTE / PENDING_PAYMENT rows.
 * Triggered by `POST /v1/internal/cron/rent-payment-reminders` (Bearer `WORKER_INTERNAL_SECRET`).
 */
@Injectable()
export class RentReminderService {
  private readonly logger = new Logger(RentReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private remindersFlagOn(): boolean {
    const v = this.config.get<string>('EMAIL_RENT_PAYMENT_REMINDERS')?.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }

  async processDueReminders(): Promise<{ sent: number; examined: number; skipped: string | null }> {
    if (!this.mail.isEnabled()) {
      return { sent: 0, examined: 0, skipped: 'smtp_disabled' };
    }
    if (!this.remindersFlagOn()) {
      return { sent: 0, examined: 0, skipped: 'EMAIL_RENT_PAYMENT_REMINDERS_off' };
    }

    const limit = Math.min(
      500,
      Math.max(1, parseIntEnv(this.config.get<string>('RENT_REMINDER_BATCH_LIMIT'), 25, 1, 500)),
    );
    const minAgeHours = Math.max(
      1,
      parseIntEnv(this.config.get<string>('RENT_REMINDER_MIN_RESERVATION_AGE_HOURS'), 12, 1, 720),
    );
    const minLeadHours = Math.max(
      1,
      parseIntEnv(this.config.get<string>('RENT_REMINDER_MIN_LEAD_HOURS_BEFORE_PICKUP'), 24, 1, 720),
    );

    const now = Date.now();
    const maxCreatedAt = new Date(now - minAgeHours * 60 * 60 * 1000);
    const minPickupAt = new Date(now + minLeadHours * 60 * 60 * 1000);

    const candidates = await this.prisma.reservation.findMany({
      where: {
        source: 'PUBLIC_WEB',
        paidAt: null,
        rentPaymentReminderSentAt: null,
        publicViewToken: { not: null },
        status: { in: ['QUOTE', 'PENDING_PAYMENT'] },
        totalCents: { gte: 1 },
        createdAt: { lte: maxCreatedAt },
        pickupAt: { gte: minPickupAt },
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    const examined = candidates.length;
    let sent = 0;

    for (const r of candidates) {
      const email = r.customerEmail?.trim().toLowerCase() ?? '';
      if (!email.includes('@')) {
        continue;
      }
      const token = r.publicViewToken;
      if (!token) {
        continue;
      }
      try {
        const didSend = await this.mail.sendRentPaymentReminderEmail({
          to: email,
          customerName: r.customerName.trim() || 'customer',
          reservationId: r.id,
          companyId: r.companyId,
          totalCents: r.totalCents,
          currency: r.currency,
          status: r.status,
          publicViewToken: token,
        });
        if (!didSend) {
          continue;
        }
        const up = await this.prisma.reservation.updateMany({
          where: { id: r.id, rentPaymentReminderSentAt: null },
          data: { rentPaymentReminderSentAt: new Date() },
        });
        if (up.count === 1) {
          sent += 1;
        }
      } catch {
        this.logger.warn(`Rent reminder failed for reservation ${r.id} (will retry on next run if unsent)`);
      }
    }

    return { sent, examined, skipped: null };
  }
}
