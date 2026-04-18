import { createZodDto } from 'nestjs-zod';
import { CreateCompanyDtoSchema } from '@tact/types';

/**
 * NestJS DTO wrapper around the shared Zod schema so it can be used with
 * `@Body()` + the global ZodValidationPipe.
 */
export class CreateCompanyDto extends createZodDto(CreateCompanyDtoSchema) {}
