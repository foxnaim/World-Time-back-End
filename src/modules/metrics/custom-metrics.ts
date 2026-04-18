import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';

export const CHECKINS_TOTAL = 'checkins_total';
export const QR_ROTATIONS_TOTAL = 'qr_rotations_total';
export const AUTH_ATTEMPTS_TOTAL = 'auth_attempts_total';
export const BOT_MESSAGES_TOTAL = 'bot_messages_total';
export const HTTP_REQUEST_DURATION_SECONDS = 'http_request_duration_seconds';

export const checkinsTotalProvider = makeCounterProvider({
  name: CHECKINS_TOTAL,
  help: 'Total number of employee check-ins processed',
  labelNames: ['type', 'company'] as const,
});

export const qrRotationsTotalProvider = makeCounterProvider({
  name: QR_ROTATIONS_TOTAL,
  help: 'Total number of QR code rotations issued',
  labelNames: ['company'] as const,
});

export const authAttemptsTotalProvider = makeCounterProvider({
  name: AUTH_ATTEMPTS_TOTAL,
  help: 'Total number of authentication attempts',
  labelNames: ['result'] as const,
});

export const botMessagesTotalProvider = makeCounterProvider({
  name: BOT_MESSAGES_TOTAL,
  help: 'Total number of Telegram bot messages handled',
  labelNames: [] as const,
});

// http_request_duration_seconds histogram is provided by
// @willsoto/nestjs-prometheus default metrics; declaring the provider here
// would conflict with the auto-registered one. Kept as a named constant so
// callers can reference it via injection if needed.
export const httpRequestDurationSecondsProvider = makeHistogramProvider({
  name: 'http_request_duration_seconds_custom',
  help: 'Custom HTTP request duration histogram (seconds)',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const customMetricsProviders = [
  checkinsTotalProvider,
  qrRotationsTotalProvider,
  authAttemptsTotalProvider,
  botMessagesTotalProvider,
];
