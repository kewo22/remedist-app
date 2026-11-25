import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiSuccess } from '@remedist/shared';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';
import { WithMeta } from '../responses/with-meta';

const DEFAULT_MESSAGE = 'Success';

/** Wraps every successful handler result as `{ success, statusCode, message, data, meta? }`. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, targets)) {
      return next.handle();
    }

    const message = this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, targets) ?? DEFAULT_MESSAGE;
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((result): ApiSuccess<unknown> => {
        const envelope: ApiSuccess<unknown> = {
          success: true,
          // Read after the handler ran, so @HttpCode and res.status() are respected.
          statusCode: response.statusCode,
          message,
          data: result instanceof WithMeta ? result.data : (result ?? null),
        };
        if (result instanceof WithMeta) {
          envelope.meta = result.meta;
        }
        return envelope;
      }),
    );
  }
}
