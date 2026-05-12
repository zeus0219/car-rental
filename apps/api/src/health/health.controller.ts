import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { API_VERSION } from '@car-rental/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/public.decorator';

/** Not subject to the global per-IP rate limit (e.g. k8s probes, monitoring). */
@ApiTags('Health')
@SkipThrottle()
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: process is up (use for load balancers that only need a fast ping). */
  @ApiOperation({ summary: 'Liveness — no DB check' })
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'car-rental-api',
      apiVersion: API_VERSION,
      uptimeSec: Math.floor(process.uptime()),
      time: new Date().toISOString(),
    };
  }

  /**
   * Readiness: can serve traffic (DB reachable). Use for k8s / orchestration probes.
   * Returns **503** if PostgreSQL is not reachable.
   */
  @ApiOperation({ summary: 'Readiness — DB ping (503 if down)' })
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'car-rental-api',
        ready: false,
        database: 'down',
        apiVersion: API_VERSION,
      });
    }
    return {
      status: 'ok',
      service: 'car-rental-api',
      ready: true,
      database: 'up',
      apiVersion: API_VERSION,
      time: new Date().toISOString(),
    };
  }

  /**
   * Single JSON for lightweight monitoring (uptime + DB + process).
   * **503** if DB unreachable — for Uptime Kuma / blackbox with one check (A6 / PRODUCTION-READINESS).
   */
  @ApiOperation({
    summary:
      'Summary — DB + version + uptime + Redis flag + integration queue inflight (503 if DB down)',
  })
  @Get('summary')
  async summary() {
    const uptimeSec = Math.floor(process.uptime());
    const nodeEnv = process.env.NODE_ENV ?? 'development';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'degraded',
        service: 'car-rental-api',
        ready: false,
        database: 'down',
        apiVersion: API_VERSION,
        uptimeSec,
        node: process.version,
        nodeEnv,
        time: new Date().toISOString(),
        redis: process.env.REDIS_URL?.trim() ? 'configured' : 'not_configured',
      });
    }
    const redis = process.env.REDIS_URL?.trim() ? 'configured' : 'not_configured';
    const [cargosInflight, sdiInflight, customerDocumentOcrPending, partnerWebhookPending] =
      await Promise.all([
        this.prisma.cargosSubmission.count({
          where: { status: { in: ['PENDING', 'PROCESSING'] } },
        }),
        this.prisma.sdiInvoiceSubmission.count({
          where: { status: { in: ['PENDING', 'PROCESSING'] } },
        }),
        this.prisma.customerDocument.count({
          where: { ocrStatus: 'PENDING', uploadCompletedAt: { not: null }, ocrAppliedAt: null },
        }),
        this.prisma.partnerWebhookDelivery.count({
          where: { status: { in: ['PENDING', 'PROCESSING'] } },
        }),
      ]);
    return {
      status: 'ok',
      service: 'car-rental-api',
      database: 'up',
      apiVersion: API_VERSION,
      uptimeSec,
      node: process.version,
      nodeEnv,
      time: new Date().toISOString(),
      redis,
      queues: {
        cargosInflight,
        sdiInflight,
        customerDocumentOcrPending,
        partnerWebhookPending,
      },
    };
  }
}
