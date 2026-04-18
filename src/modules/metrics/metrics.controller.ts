import { Controller, Get, Header, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { register as promRegister } from 'prom-client';

import { Public } from '../../common/decorators/public.decorator';

/**
 * MetricsController — Prometheus scrape endpoint.
 *
 * Duplicates the tiny surface of `PrometheusController` from
 * `@willsoto/nestjs-prometheus` (which only calls `prom-client`'s global
 * `register.metrics()`) because the base class's `index(response)` signature
 * is incompatible with Nest's `@Req()` / `@Res()` injection — TS rejects the
 * override. Keeping the controller independent lets us add bearer-token auth
 * on top without fighting the type system.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @Public()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async index(@Req() req: Request, @Res() res: Response): Promise<void> {
    const expected = this.config.get<string>('METRICS_TOKEN');
    if (expected) {
      const header = req.headers['authorization'];
      const token =
        typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
          ? header.slice(7).trim()
          : undefined;
      if (!token || token !== expected) {
        throw new UnauthorizedException('Invalid metrics token');
      }
    }
    const body = await promRegister.metrics();
    res.setHeader('Content-Type', promRegister.contentType);
    res.send(body);
  }
}
