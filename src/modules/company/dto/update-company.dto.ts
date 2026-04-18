import { createZodDto } from 'nestjs-zod';
import { UpdateCompanyDtoSchema } from '@tact/types';

export class UpdateCompanyDto extends createZodDto(UpdateCompanyDtoSchema) {}
