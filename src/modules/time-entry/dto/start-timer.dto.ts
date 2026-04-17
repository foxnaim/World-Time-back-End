import { createZodDto } from 'nestjs-zod';
import { StartTimerDtoSchema } from '@worktime/types';

export class StartTimerDto extends createZodDto(StartTimerDtoSchema) {}
