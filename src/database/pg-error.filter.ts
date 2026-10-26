import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

interface PgError {
  code?: string;
  message: string;
}

// Maps database rule violations to HTTP. Business rules such as four-eyes
// and append-only audit are enforced in PostgreSQL (see migrations) and
// surface here with these SQLSTATEs.
const STATUS_BY_SQLSTATE: Record<string, HttpStatus> = {
  AO403: HttpStatus.FORBIDDEN, // custom: forbidden action (e.g. four-eyes)
  AO409: HttpStatus.CONFLICT, // custom: invalid state transition
  '42501': HttpStatus.FORBIDDEN, // insufficient_privilege, incl. RLS violations
  '23505': HttpStatus.CONFLICT, // unique_violation
  '23503': HttpStatus.BAD_REQUEST, // foreign_key_violation
  '23514': HttpStatus.BAD_REQUEST, // check_violation
};

@Catch()
export class PgErrorFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const code = (exception as PgError)?.code;
    const status = code ? STATUS_BY_SQLSTATE[code] : undefined;
    if (status === undefined) {
      super.catch(exception, host);
      return;
    }
    const res = host.switchToHttp().getResponse();
    res.status(status).json({ statusCode: status, message: (exception as PgError).message, code });
  }
}
