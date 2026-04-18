/**
 * Diagnostic: reproduce /start failure via in-process handler chain
 * (no live Telegram traffic).
 *
 * Run from repo root:
 *   pnpm --filter @tact/api exec tsx scripts/debug-start.ts
 *
 * IMPORTANT: this script imports from `../dist/*.js`, not `../src/*.ts`.
 * Reason: `tsx` (esbuild under the hood) does NOT emit TypeScript's
 * `design:paramtypes` decorator metadata — Nest's DI needs it. The
 * `nest build` output in `backend/dist` was produced by `tsc` and
 * carries the metadata, so we load that instead. Keep `dist/` fresh
 * before running (`pnpm --filter @tact/api build`) if code changed.
 *
 * Strategy:
 *   1. Load backend/.env so @nestjs/config + Prisma see real creds.
 *   2. Force TELEGRAM_BOT_TOKEN='' BEFORE booting so TelegrafModule
 *      picks the `launchOptions: false` branch — no polling, no HTTP.
 *   3. Boot AppModule as a bare application context (no Express listen).
 *   4. Resolve StartHandler, UserMiddleware, PrismaService from DI.
 *   5. Build a fake Telegraf Context, run middleware, call start().
 *   6. Spy ctx.reply so replies print locally, never hit Telegram.
 */
import { config as loadEnv } from 'dotenv';
import * as path from 'path';

// --- Env bootstrap (must happen before any Nest/compiled-dist import) ----
const BACKEND_DIR = path.resolve(__dirname, '..');
loadEnv({ path: path.join(BACKEND_DIR, '.env') });

// Disable bot polling before Nest/Telegraf look at config.
process.env.TELEGRAM_BOT_TOKEN = '';

// chdir so any relative file lookups (logs, Prisma engine) behave as in `pnpm dev`.
process.chdir(BACKEND_DIR);

// --- Deferred requires from dist so decorator metadata is present --------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NestFactory } = require('@nestjs/core');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Logger } = require('@nestjs/common');

const distRoot = path.join(BACKEND_DIR, 'dist');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require(path.join(distRoot, 'app.module.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { StartHandler } = require(
  path.join(distRoot, 'modules/telegram/handlers/start.handler.js'),
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UserMiddleware } = require(
  path.join(distRoot, 'modules/telegram/middleware/user.middleware.js'),
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaService } = require(path.join(distRoot, 'common/prisma.service.js'));

async function main(): Promise<number> {
  const log = new Logger('debug-start');
  log.log('booting AppModule in application-context mode...');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
    abortOnError: false,
  });

  try {
    const startHandler = app.get(StartHandler, { strict: false });
    const userMw = app.get(UserMiddleware, { strict: false });
    const prisma = app.get(PrismaService, { strict: false });

    log.log(
      `resolved: StartHandler=${!!startHandler}, UserMiddleware=${!!userMw}, Prisma=${!!prisma}`,
    );

    // --- Build fake Telegraf Context --------------------------------------
    const ctx: any = {
      from: {
        id: 999999999,
        first_name: 'Test',
        last_name: null,
        username: null,
        is_bot: false,
        language_code: 'ru',
      },
      message: { text: '/start' },
      state: {},
      // startPayload is normally set by Telegraf when /start has an argument.
      startPayload: undefined,
      reply: async (text: string, extra?: unknown) => {
        const preview =
          typeof text === 'string' ? text.slice(0, 120) : String(text);
        console.log('REPLY:', preview, extra ? 'WITH_KEYBOARD' : 'NO_KB');
        return { message_id: 1 };
      },
    };

    // --- Run UserMiddleware to populate ctx.state.user --------------------
    log.log('running UserMiddleware...');
    const mwFn = userMw.use();
    await mwFn(ctx, async () => undefined);
    log.log(
      `middleware done; ctx.state.user=${
        ctx.state.user
          ? `id=${ctx.state.user.id} tgId=${ctx.state.user.telegramId}`
          : 'NULL'
      }`,
    );

    // --- Invoke the handler ----------------------------------------------
    log.log('invoking StartHandler.start(ctx)...');
    try {
      await startHandler.start(ctx);
      log.log('StartHandler.start returned cleanly.');
    } catch (err) {
      console.error('\n=== StartHandler threw ===');
      const e = err as Error;
      console.error('name:    ', e?.name);
      console.error('message: ', e?.message);
      console.error('stack:   ');
      console.error(e?.stack);
      const any = err as any;
      if (any?.code) console.error('code:    ', any.code);
      if (any?.meta) console.error('meta:    ', JSON.stringify(any.meta));
      if (any?.clientVersion) console.error('client:  ', any.clientVersion);
      throw err;
    }

    return 0;
  } finally {
    try {
      await app.close();
    } catch (closeErr) {
      console.warn('app.close failed:', (closeErr as Error).message);
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('\n=== debug-start FAILED ===');
    console.error((err as Error)?.stack ?? err);
    process.exit(1);
  });
