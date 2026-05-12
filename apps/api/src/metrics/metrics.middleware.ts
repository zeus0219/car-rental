import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    res.on('finish', () => {
      const url = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
      if (url.startsWith('/v1/health') || url.startsWith('/v1/metrics')) {
        return;
      }
      const code = res.statusCode;
      if (!code) {
        return;
      }
      this.metrics.recordHttpResponse(req.method, code);
    });
    next();
  }
}
