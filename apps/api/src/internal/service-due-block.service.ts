import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/** Stored on `CalendarBlock.reason`; idempotency also uses `Vehicle.serviceDueAutoBlockedForKm`. */
export const AUTO_SERVICE_DUE_BLOCK_REASON_PREFIX = '[auto-service-due]' as const;

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

function serviceDueAutoBlocksEnabled(config: ConfigService): boolean {
  const v = config.get<string>('SERVICE_DUE_AUTO_BLOCKS')?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * F3: when enabled (`SERVICE_DUE_AUTO_BLOCKS`) and a vehicle has `autoServiceBlockHours` + service due km
 * reached, create a MAINTENANCE calendar block (starts after any in-progress rental window).
 */
@Injectable()
export class ServiceDueBlockService {
  private readonly logger = new Logger(ServiceDueBlockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async processDueAutoBlocks(): Promise<{
    created: number;
    examined: number;
    skipped: string | null;
  }> {
    if (!serviceDueAutoBlocksEnabled(this.config)) {
      return { created: 0, examined: 0, skipped: 'SERVICE_DUE_AUTO_BLOCKS_off' };
    }

    const limit = Math.min(
      200,
      Math.max(1, parseIntEnv(this.config.get<string>('SERVICE_DUE_BLOCK_BATCH_LIMIT'), 50, 1, 200)),
    );

    const now = new Date();
    const candidates = await this.prisma.vehicle.findMany({
      where: {
        status: { not: 'OUT_OF_FLEET' },
        nextServiceDueOdometerKm: { not: null },
        autoServiceBlockHours: { not: null },
      },
      take: 800,
      orderBy: { updatedAt: 'desc' },
    });

    const ready = candidates.filter(
      (v) =>
        v.nextServiceDueOdometerKm != null &&
        v.autoServiceBlockHours != null &&
        v.odometerKm >= v.nextServiceDueOdometerKm &&
        v.serviceDueAutoBlockedForKm !== v.nextServiceDueOdometerKm,
    );

    const batch = ready.slice(0, limit);
    let created = 0;

    for (const v of batch) {
      const dueKm = v.nextServiceDueOdometerKm!;
      const hours = v.autoServiceBlockHours!;
      if (hours < 1 || hours > 336) {
        continue;
      }

      const openEnded = await this.prisma.calendarBlock.findFirst({
        where: {
          vehicleId: v.id,
          type: 'MAINTENANCE',
          reason: { startsWith: AUTO_SERVICE_DUE_BLOCK_REASON_PREFIX },
          endsAt: { gt: now },
        },
      });
      if (openEnded) {
        continue;
      }

      let startsAt = new Date(now);
      const ongoing = await this.prisma.reservation.findFirst({
        where: {
          vehicleId: v.id,
          status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
          pickupAt: { lte: now },
          returnAt: { gt: now },
        },
        orderBy: { returnAt: 'asc' },
        select: { returnAt: true },
      });
      if (ongoing && ongoing.returnAt > startsAt) {
        startsAt = ongoing.returnAt;
      }

      const endsAt = new Date(startsAt.getTime() + hours * 60 * 60 * 1000);
      if (endsAt <= startsAt) {
        continue;
      }

      const reason =
        `${AUTO_SERVICE_DUE_BLOCK_REASON_PREFIX} due≥${dueKm}km odo=${v.odometerKm} plate=${v.licensePlate}`;

      try {
        await this.prisma.$transaction([
          this.prisma.calendarBlock.create({
            data: {
              vehicleId: v.id,
              startsAt,
              endsAt,
              type: 'MAINTENANCE',
              reason,
            },
          }),
          this.prisma.vehicle.update({
            where: { id: v.id },
            data: { serviceDueAutoBlockedForKm: dueKm },
          }),
        ]);
        created += 1;
      } catch (e) {
        this.logger.warn(
          `service-due block failed vehicle=${v.id}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    return { created, examined: batch.length, skipped: null };
  }
}
