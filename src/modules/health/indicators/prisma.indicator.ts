import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from '../../../common/prisma.service';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async pingCheck(key: string, options: { timeout?: number } = {}): Promise<HealthIndicatorResult> {
    const timeout = options.timeout ?? 5_000;
    const start = Date.now();
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Prisma ping timed out after ${timeout}ms`)), timeout),
        ),
      ]);
      return this.getStatus(key, true, {
        responseTimeMs: Date.now() - start,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HealthCheckError(`${key} check failed`, this.getStatus(key, false, { message }));
    }
  }
}
