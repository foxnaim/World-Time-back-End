import { createZodDto } from 'nestjs-zod';
import { BulkInviteDtoSchema } from '@tact/types';

/**
 * NestJS DTO wrapper around the shared Zod schema so it can be used with
 * `@Body()` + the global ZodValidationPipe.
 *
 * Body shape: `{ rows: { name?: string; position?: string; role?: 'MANAGER' | 'STAFF' }[] }`
 * — capped at 100 rows.
 */
export class BulkInviteDto extends createZodDto(BulkInviteDtoSchema) {}
