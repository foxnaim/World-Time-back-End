import { createZodDto } from 'nestjs-zod';
import { StopTimerDtoSchema } from '@worktime/types';

export class StopTimerDto extends createZodDto(StopTimerDtoSchema) {}
