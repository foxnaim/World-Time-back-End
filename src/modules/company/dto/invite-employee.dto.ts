import { createZodDto } from 'nestjs-zod';
import { InviteEmployeeDto as InviteEmployeeDtoSchema } from '@worktime/types';

export class InviteEmployeeDto extends createZodDto(InviteEmployeeDtoSchema) {}
