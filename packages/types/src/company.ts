import { z } from 'zod';
import { EmployeeRoleSchema, EmployeeStatusSchema } from './enums.js';

/** kebab-case slug, e.g. "acme-corp" */
const SlugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case');

/** Reasonable subset check for IANA timezone strings (e.g. "Europe/Moscow"). */
const TimezoneSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z]+(?:\/[A-Za-z_+\-0-9]+){0,2}$|^UTC$/, 'must be a valid IANA timezone');

export const CreateCompanyDtoSchema = z.object({
  name: z.string().min(2).max(80),
  slug: SlugSchema,
  address: z.string().min(1).max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  geofenceRadiusM: z.number().int().min(20).max(2000).optional(),
  timezone: TimezoneSchema,
  workStartHour: z.number().int().min(0).max(23),
  workEndHour: z.number().int().min(0).max(23),
});
export type CreateCompanyDto = z.infer<typeof CreateCompanyDtoSchema>;

/** Late-arrival penalty configuration — editable via the company-update path. */
export const LatePenaltyConfigSchema = z.object({
  latePenaltyEnabled: z.boolean().optional(),
  latePenaltyGraceMin: z.number().int().min(0).max(240).optional(),
  latePenaltyAmount: z.number().nonnegative().nullable().optional(),
  latePenaltyPercent: z.number().min(0).max(100).nullable().optional(),
});

export const UpdateCompanyDtoSchema = CreateCompanyDtoSchema.partial().merge(
  LatePenaltyConfigSchema,
);
export type UpdateCompanyDto = z.infer<typeof UpdateCompanyDtoSchema>;

export const CompanyResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  address: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  geofenceRadiusM: z.number().int().nullable().optional(),
  timezone: z.string(),
  workStartHour: z.number().int(),
  workEndHour: z.number().int(),
  ownerUserId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CompanyResponse = z.infer<typeof CompanyResponseSchema>;

export const InviteEmployeeDtoSchema = z
  .object({
    phone: z
      .string()
      .regex(/^\+?[1-9]\d{6,14}$/, 'E.164 phone expected')
      .optional(),
    userTelegramId: z.coerce.bigint().optional(),
    position: z.string().min(1).max(120).optional(),
    monthlySalary: z.number().nonnegative().optional(),
    hourlyRate: z.number().nonnegative().optional(),
    role: EmployeeRoleSchema,
  })
  .refine((d) => d.phone !== undefined || d.userTelegramId !== undefined, {
    message: 'either phone or userTelegramId is required',
    path: ['phone'],
  });
export type InviteEmployeeDto = z.infer<typeof InviteEmployeeDtoSchema>;

/** A single row of a bulk-invite request. */
export const BulkInviteRowSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  position: z.string().min(1).max(120).optional(),
  role: z.enum(['MANAGER', 'STAFF']).optional(),
});
export type BulkInviteRow = z.infer<typeof BulkInviteRowSchema>;

/** Body for `POST /api/companies/:id/invites/bulk`. */
export const BulkInviteDtoSchema = z.object({
  rows: z.array(BulkInviteRowSchema).min(1).max(100),
});
export type BulkInviteDto = z.infer<typeof BulkInviteDtoSchema>;

/** One generated invite returned by the bulk endpoint. */
export const BulkInviteResultSchema = z.object({
  name: z.string().nullable(),
  position: z.string().nullable(),
  role: EmployeeRoleSchema,
  token: z.string(),
  url: z.string(),
});
export type BulkInviteResult = z.infer<typeof BulkInviteResultSchema>;

export const EmployeeResponseSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  telegramId: z.coerce.bigint().nullable().optional(),
  phone: z.string().nullable().optional(),
  fullName: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  monthlySalary: z.number().nullable().optional(),
  hourlyRate: z.number().nullable().optional(),
  role: EmployeeRoleSchema,
  status: EmployeeStatusSchema,
  invitedAt: z.string().datetime().nullable().optional(),
  joinedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EmployeeResponse = z.infer<typeof EmployeeResponseSchema>;
