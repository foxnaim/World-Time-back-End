import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AcceptInviteSchema = z.object({
  token: z.string().min(1, 'token is required'),
});

export class AcceptInviteDto extends createZodDto(AcceptInviteSchema) {}
