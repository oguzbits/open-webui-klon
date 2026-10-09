import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
// eslint-disable-next-line no-restricted-imports -- STATUS_CODES is a lookup table, no connection is opened
import { STATUS_CODES } from 'node:http';
import { PinoLogger } from 'nestjs-pino';

import { ProviderError, type ProviderErrorReason } from '../http/safe-fetch/provider-error.js';

export interface ProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  errors?: string[];
  /** Set for 502 when a model provider could not be used. */
  reason?: ProviderErrorReason;
}

interface Description {
  status: number;
  detail: string;
  errors?: string[];
  reason?: ProviderErrorReason;
}

const GENERIC_SERVER_ERROR = 'Internal server error';

function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null || !('status' in exception)) {
    return undefined;
  }
  const { status } = exception;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ProblemDetailsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const { status, detail, errors, reason } = this.describe(exception);

    if (reason !== undefined) {
      this.logger.warn({ reason }, 'Model provider call failed');
    } else if (status >= 500) {
      this.logger.error({ err: exception }, 'Unhandled exception');
    }

    const problem: ProblemDetails = {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Error',
      status,
      detail,
      // originalUrl keeps the global prefix; request.path is relative to the router mount.
      instance: request.originalUrl.split('?')[0] ?? request.path,
      requestId: typeof request.id === 'string' ? request.id : '',
      ...(errors ? { errors } : {}),
      ...(reason ? { reason } : {}),
    };
    response.status(status).type('application/problem+json').send(JSON.stringify(problem));
  }

  private describe(exception: unknown): Description {
    if (exception instanceof ProviderError) {
      // Fixed text: the message of the error may name hosts or echo parts of the provider answer.
      return {
        status: 502,
        detail: 'The model provider could not be used',
        reason: exception.reason,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && 'message' in body) {
        const { message } = body;
        if (Array.isArray(message)) {
          return {
            status,
            detail: 'Request validation failed',
            errors: message.filter((item): item is string => typeof item === 'string'),
          };
        }
        if (typeof message === 'string') return { status, detail: message };
      }
      return { status, detail: exception.message };
    }
    // Errors from Express middleware (for example "payload too large") carry a 4xx status.
    const clientStatus = clientErrorStatus(exception);
    if (clientStatus !== undefined) {
      return { status: clientStatus, detail: STATUS_CODES[clientStatus] ?? 'Client error' };
    }
    return { status: 500, detail: GENERIC_SERVER_ERROR };
  }
}
