import { createZodDto } from 'nestjs-zod';
import { UpdateProjectDtoSchema } from '@tact/types';

export class UpdateProjectDto extends createZodDto(UpdateProjectDtoSchema) {}
