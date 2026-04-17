import { CompanyService } from './company.service';

/**
 * Unit tests for CompanyService.
 *
 * Prisma is fully mocked — we only verify that the service wires the expected
 * arguments through and correctly shapes its return payloads.
 */

function makePrisma() {
  return {
    $transaction: jest.fn(async (fn: any) =>
      fn({
        company: {
          create: jest.fn(async ({ data }: any) => ({
            id: 'company-123',
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        },
        employee: {
          create: jest.fn(async ({ data }: any) => ({
            id: 'emp-1',
            ...data,
          })),
        },
      }),
    ),
    company: {
      findUnique: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
}

const inviteTokens = {
  issue: jest.fn(),
  consume: jest.fn(),
  peek: jest.fn(),
  list: jest.fn(),
} as any;

describe('CompanyService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: CompanyService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new CompanyService(prisma as any, inviteTokens);
  });

  describe('create', () => {
    it('creates a company and slugifies its name, attaching the creator as OWNER', async () => {
      const result = await service.create('user-1', {
        name: 'Acme INC!',
        address: '1 Main St',
        latitude: 10,
        longitude: 20,
        geofenceRadiusM: 100,
        timezone: 'Europe/Moscow',
        workStartHour: 9,
        workEndHour: 18,
      } as any);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('Acme INC!');
      // `slugify` lowercases, strips non-alphanumerics, and collapses dashes.
      expect(result.slug).toBe('acme-inc');
      expect(result.ownerId).toBe('user-1');
    });
  });

  describe('findMyCompanies', () => {
    it('returns each company annotated with the caller role', async () => {
      prisma.employee.findMany.mockResolvedValueOnce([
        {
          role: 'OWNER',
          company: { id: 'c1', name: 'One', slug: 'one' },
        },
        {
          role: 'STAFF',
          company: { id: 'c2', name: 'Two', slug: 'two' },
        },
      ]);

      const rows = await service.findMyCompanies('user-1');

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].myRole).toBe('OWNER');
      expect(rows[0].id).toBe('c1');
      expect(rows[1].myRole).toBe('STAFF');
    });

    it('returns an empty array when the user has no active memberships', async () => {
      prisma.employee.findMany.mockResolvedValueOnce([]);
      await expect(service.findMyCompanies('nobody')).resolves.toEqual([]);
    });
  });
});
