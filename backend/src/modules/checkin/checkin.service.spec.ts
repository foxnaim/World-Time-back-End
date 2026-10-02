import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { CheckinService } from './checkin.service';

/**
 * Geofence rules of CheckinService.scan. Prisma, QrService and BotService are
 * stubbed: the token is always valid and the employee always active, so the
 * only thing that decides the outcome is the company and request location.
 */

const OFFICE = { latitude: 43.238949, longitude: 76.889709 };
/** ~55 m north of the office: inside 100 m radius + 50 m buffer. */
const NEAR = { latitude: 43.239449, longitude: 76.889709 };
/** ~1.1 km north of the office: outside it. */
const FAR = { latitude: 43.248949, longitude: 76.889709 };

function makeService(company: { latitude: number | null; longitude: number | null }) {
  const tx = {
    qRToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    checkIn: {
      create: jest.fn(async () => ({ id: 'checkin-1', timestamp: new Date() })),
    },
  };
  const prisma = {
    employee: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'emp-1',
        status: 'ACTIVE',
        user: { firstName: 'Ann', lastName: null },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'Office',
        geofenceRadiusM: 100,
        workStartHour: 9,
        ...company,
      }),
    },
    checkIn: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async () => ({ id: 'checkin-2', timestamp: new Date() })),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const qr = {
    verify: jest.fn().mockResolvedValue({ companyId: 'company-1', tokenId: 'tok-1' }),
  };
  const bot = { notifyUser: jest.fn().mockResolvedValue(undefined) };
  const service = new CheckinService(prisma as any, qr as any, bot as any);
  return { service, prisma };
}

describe('CheckinService.scan geofence', () => {
  describe('company with coordinates', () => {
    it('accepts a scan inside the radius', async () => {
      const { service, prisma } = makeService(OFFICE);
      const result = await service.scan('user-1', { token: 'tok', ...NEAR });
      expect(result.id).toBe('checkin-1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a scan outside the radius', async () => {
      const { service, prisma } = makeService(OFFICE);
      await expect(service.scan('user-1', { token: 'tok', ...FAR })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a scan without coordinates', async () => {
      const { service, prisma } = makeService(OFFICE);
      await expect(service.scan('user-1', { token: 'tok' })).rejects.toThrow(
        new BadRequestException(
          'Location is required to check in at this office. Share your location and scan again.',
        ),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a scan with only one coordinate', async () => {
      const { service, prisma } = makeService(OFFICE);
      await expect(
        service.scan('user-1', { token: 'tok', latitude: NEAR.latitude }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('company without coordinates (no geofence)', () => {
    const NO_GEOFENCE = { latitude: null, longitude: null };

    it('accepts a scan without coordinates', async () => {
      const { service, prisma } = makeService(NO_GEOFENCE);
      const result = await service.scan('user-1', { token: 'tok' });
      expect(result.id).toBe('checkin-1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('accepts a scan from any distance', async () => {
      const { service, prisma } = makeService(NO_GEOFENCE);
      const result = await service.scan('user-1', { token: 'tok', ...FAR });
      expect(result.id).toBe('checkin-1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});

describe('CheckinService.manualCreate', () => {
  it('has no geofence by design: a MANAGER correction is recorded without any location', async () => {
    const { service, prisma } = makeService(OFFICE);
    prisma.employee.findUnique
      .mockResolvedValueOnce({
        id: 'emp-1',
        companyId: 'company-1',
        user: { firstName: 'Ann', lastName: null },
        company: { name: 'Office', workStartHour: 9 },
      })
      .mockResolvedValueOnce({ role: 'MANAGER' });

    const result = await service.manualCreate('manager-1', 'MANAGER' as any, {
      employeeId: 'emp-1',
      type: 'OUT',
    } as any);

    expect(result.id).toBe('checkin-2');
    expect(prisma.checkIn.create).toHaveBeenCalledTimes(1);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });
});
