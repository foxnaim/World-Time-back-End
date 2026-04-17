import { Global, Module } from '@nestjs/common';

import { QueueService } from './queue.service';

/**
 * QueueModule — BullMQ wiring is stubbed out for the MVP.
 *
 * TODO: re-introduce the full BullMQ module (with `@nestjs/bullmq`,
 * `bullmq`, and per-queue processors under ./processors) once the
 * dependencies are added to package.json and the processor files are
 * restored. The previous implementation lived in git history.
 *
 * For now QueueService ships a no-op sync-fallback API so call sites can
 * keep compiling without a broker.
 */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}

export { QUEUES } from './queues';
