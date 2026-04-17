import { createZodDto } from 'nestjs-zod';
import { UpdateProjectDtoSchema } from '@worktime/types';

export class UpdateProjectDto extends createZodDto(UpdateProjectDtoSchema) {}
