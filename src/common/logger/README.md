# Logger

Structured logging via [nestjs-pino](https://github.com/iamolegga/nestjs-pino).

`LoggerModule` is `@Global()`, so inject `PinoLogger` anywhere:

```ts
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class MyService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(MyService.name);
  }

  doThing(): void {
    this.logger.info({ userId: 1 }, 'did a thing');
  }
}
```

HTTP request/response logging is handled automatically by `pino-http`.
Log level is read from the `LOG_LEVEL` env var (defaults to `info`).
In non-production, output is prettified via `pino-pretty`.
