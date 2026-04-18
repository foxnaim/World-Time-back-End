import { createZodDto } from 'nestjs-zod';
import { InviteEmployeeDtoSchema } from '@tact/types';

export class InviteEmployeeDto extends createZodDto(InviteEmployeeDtoSchema) {}
