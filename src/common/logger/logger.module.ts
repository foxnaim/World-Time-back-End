import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const EXCLUDED_PATHS = ['/health', '/metrics', '/api/docs'];

function isExcluded(url: string | undefined): boolean {
  if (!url) return false;
  return EXCLUDED_PATHS.some(
    (p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`),
  );
}

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        pinoHttp: {
          level: cfg.get<string>('LOG_LEVEL') ?? 'info',
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const headerId =
              (req.headers['x-request-id'] as string | undefined) ??
              (req.headers['X-Request-Id'] as unknown as string | undefined);
            const id = headerId && headerId.length > 0 ? headerId : randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          customProps: (req: IncomingMessage) => {
            const anyReq = req as IncomingMessage & { id?: string };
            return {
              requestId: anyReq.id,
              request: {
                method: req.method,
                url: req.url,
              },
            };
          },
          autoLogging: {
            ignore: (req: IncomingMessage) => isExcluded(req.url),
          },
          serializers: {
            req(
              req: IncomingMessage & {
                id?: string;
                method?: string;
                url?: string;
              },
            ) {
              return {
                id: req.id,
                method: req.method,
                url: req.url,
              };
            },
            res(res: ServerResponse & { statusCode?: number }) {
              return {
                statusCode: res.statusCode,
              };
            },
          },
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            '*.password',
            '*.token',
            '*.initData',
          ],
          customSuccessMessage: (
            req: IncomingMessage,
            res: ServerResponse & { statusCode: number },
          ) =>
            res.statusCode >= 400
              ? `warn: ${req.method} ${req.url} ${res.statusCode}`
              : `${req.method} ${req.url}`,
          customLogLevel: (
            req: IncomingMessage,
            res: ServerResponse & { statusCode: number },
            err?: Error,
          ) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
          transport:
            process.env.NODE_ENV === 'production'
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                  },
                },
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
