import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaHealthIndicator } from './indicators/prisma.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';

interface BasicHealthResponse {
  status: 'ok';
  version: string;
  uptime: number;
  timestamp: string;
}

interface LivenessResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

@Controller()
export class HealthController {
  private readonly version: string =
    process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.0.0';

  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
  ) {}

  @Get('health')
  @Public()
  basic(): BasicHealthResponse {
    return {
      status: 'ok',
      version: this.version,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('healthz/live')
  @Public()
  live(): LivenessResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('healthz/ready')
  @Public()
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    const checks = [
      (): Promise<Record<string, unknown>> =>
        this.prismaIndicator.pingCheck('database', { timeout: 1_500 }),
    ];
    if (this.redisIndicator.isConfigured()) {
      checks.push(
        (): Promise<Record<string, unknown>> => this.redisIndicator.pingCheck('redis'),
      );
    }
    return this.health.check(checks as never);
  }
}
