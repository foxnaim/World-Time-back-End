import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsController } from './metrics.controller';
import { customMetricsProviders } from './custom-metrics';

@Module({
  imports: [
    PrometheusModule.register({
      controller: MetricsController,
      defaultMetrics: {
        enabled: true,
      },
      defaultLabels: {
        app: 'worktime-api',
      },
    }),
  ],
  providers: [...customMetricsProviders],
  exports: [...customMetricsProviders],
})
export class MetricsModule {}
