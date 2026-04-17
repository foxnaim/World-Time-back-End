import { Module } from '@nestjs/common';

import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';

/**
 * ProjectModule
 *
 * PrismaModule is registered as @Global() in the root, so PrismaService can
 * be injected without an explicit import here.
 */
@Module({
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
