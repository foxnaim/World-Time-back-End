import { createZodDto } from 'nestjs-zod';
import { CreateProjectDtoSchema } from '@tact/types';

/**
 * NestJS DTO wrapper around the shared Zod schema so it can be used with
 * `@Body()` + the global ZodValidationPipe.
 */
export class CreateProjectDto extends createZodDto(CreateProjectDtoSchema) {}
