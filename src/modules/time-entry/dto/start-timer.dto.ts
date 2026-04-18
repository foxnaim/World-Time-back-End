import { createZodDto } from 'nestjs-zod';
import { StartTimerDtoSchema } from '@tact/types';

export class StartTimerDto extends createZodDto(StartTimerDtoSchema) {}
