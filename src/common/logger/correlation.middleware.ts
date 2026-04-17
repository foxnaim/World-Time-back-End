import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const REQUEST_ID_HEADER = 'X-Request-Id';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming =
      (req.headers['x-request-id'] as string | undefined) ??
      (req.headers['X-Request-Id'.toLowerCase()] as string | undefined);

    const id = incoming && incoming.trim().length > 0 ? incoming.trim() : uuidv4();

    (req as Request & { id?: string }).id = id;
    res.setHeader(REQUEST_ID_HEADER, id);

    next();
  }
}
