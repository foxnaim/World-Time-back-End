import { createZodDto } from 'nestjs-zod';
import { InviteEmployeeDtoSchema } from '@worktime/types';

export class InviteEmployeeDto extends createZodDto(InviteEmployeeDtoSchema) {}
