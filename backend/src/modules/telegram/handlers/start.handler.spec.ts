import { BadRequestException } from '@nestjs/common';

import { clearSession, getSession } from '../session';
import { LOCATION_MAX_AGE_MS, StartHandler } from './start.handler';

/**
 * `/start qr_<token>` — the Telegram deep link a QR scan opens. The handler may
 * reuse a location the user shared in the chat, but only a fresh one: a
 * session lives 24 h, and an old location must not pass the office geofence.
 *
 * CheckinService.scan is stubbed to behave like an office with a geofence:
 * it refuses a scan without coordinates, as the real service does.
 */

const TELEGRAM_ID = BigInt(7001);
const QR_CODE = 'AbCdEfGhIjKlMnOpQrStU';
const OFFICE = { lat: 43.238949, lng: 76.889709 };

function makeHandler() {
  const checkin = {
    scan: jest.fn(async (_userId: string, dto: { latitude?: number; longitude?: number }) => {
      if (dto.latitude == null || dto.longitude == null) {
        throw new BadRequestException('Location is required to check in at this office.');
      }
      return { id: 'checkin-1', type: 'IN', timestamp: new Date().toISOString() };
    }),
  };
  const handler = new StartHandler({} as any, checkin as any, {} as any);
  const ctx = {
    state: { user: { id: 'user-1', telegramId: TELEGRAM_ID, employees: [] } },
    startPayload: `qr_${QR_CODE}`,
    from: { id: Number(TELEGRAM_ID) },
    reply: jest.fn().mockResolvedValue(undefined),
  };
  return { handler, checkin, ctx };
}

describe('StartHandler QR deep link — location freshness', () => {
  afterEach(() => clearSession(TELEGRAM_ID));

  it('uses a location shared within the limit and checks in', async () => {
    getSession(TELEGRAM_ID).lastLocation = { ...OFFICE, at: Date.now() - 30_000 };
    const { handler, checkin, ctx } = makeHandler();

    await handler.start(ctx as any);

    expect(checkin.scan).toHaveBeenCalledWith('user-1', {
      token: QR_CODE,
      latitude: OFFICE.lat,
      longitude: OFFICE.lng,
    });
    expect(ctx.reply.mock.calls[0][0]).toMatch(/^✅ Приход зафиксирован/);
  });

  it('drops a stale location and asks for the location again', async () => {
    getSession(TELEGRAM_ID).lastLocation = {
      ...OFFICE,
      at: Date.now() - (LOCATION_MAX_AGE_MS + 1_000),
    };
    const { handler, checkin, ctx } = makeHandler();

    await handler.start(ctx as any);

    expect(checkin.scan).toHaveBeenCalledWith('user-1', {
      token: QR_CODE,
      latitude: undefined,
      longitude: undefined,
    });
    expect(ctx.reply.mock.calls[0][0]).toMatch(/Пришли геолокацию/);
    expect(getSession(TELEGRAM_ID).pendingQr).toBe(QR_CODE);
  });

  it('asks for the location when none was shared', async () => {
    const { handler, checkin, ctx } = makeHandler();

    await handler.start(ctx as any);

    expect(checkin.scan).toHaveBeenCalledWith('user-1', {
      token: QR_CODE,
      latitude: undefined,
      longitude: undefined,
    });
    expect(ctx.reply.mock.calls[0][0]).toMatch(/Пришли геолокацию/);
    expect(getSession(TELEGRAM_ID).pendingQr).toBe(QR_CODE);
  });
});
