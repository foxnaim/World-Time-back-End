import { createZodDto } from 'nestjs-zod';
import { UpdateCompanyDtoSchema } from '@worktime/types';

export class UpdateCompanyDto extends createZodDto(UpdateCompanyDtoSchema) {}
