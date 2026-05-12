import { createZodDto } from 'nestjs-zod';
import { BulkUpdateEmployeesDtoSchema } from '@tact/types';

/**
 * NestJS DTO wrapper around the shared Zod schema for bulk employee updates.
 *
 * Body shape:
 * `{ employeeIds: string[]; departmentId?: string | null; shiftId?: string | null; status?: 'ACTIVE' | 'INACTIVE' }`
 * A present key is applied; an absent key is left untouched; `null` clears the relation.
 */
export class BulkUpdateEmployeesDto extends createZodDto(BulkUpdateEmployeesDtoSchema) {}
