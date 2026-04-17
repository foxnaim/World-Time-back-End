import {
  Controller,
  Get,
  Header,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';

@Controller('metrics')
export class MetricsController extends PrometheusController {
  constructor(private readonly config: ConfigService) {
    super();
  }

  @Get()
  @Public()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async index(@Req() req: Request, @Res() res: Response): Promise<unknown> {
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
    return super.index(res);
  }
}
