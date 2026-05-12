import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { MetricsService } from './metrics.service';

@ApiTags('Health')
@SkipThrottle()
@Controller('metrics')
@Public()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @ApiOperation({
    summary: 'Prometheus text exposition (A6) — process + HTTP counters + integration queue gauges',
  })
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): Promise<string> {
    return this.metrics.getMetricsText();
  }
}
