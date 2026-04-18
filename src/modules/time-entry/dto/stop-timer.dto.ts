import { createZodDto } from 'nestjs-zod';
import { StopTimerDtoSchema } from '@tact/types';

export class StopTimerDto extends createZodDto(StopTimerDtoSchema) {}
