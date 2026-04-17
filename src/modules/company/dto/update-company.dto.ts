import { createZodDto } from 'nestjs-zod';
import { UpdateCompanyDto as UpdateCompanyDtoSchema } from '@worktime/types';

export class UpdateCompanyDto extends createZodDto(UpdateCompanyDtoSchema) {}
