import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface PgLikeError {
  code?: string;
  constraint?: string;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Invalid request payload.',
      code: 'VALIDATION_ERROR',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const pgErr = err as PgLikeError | null;
  if (pgErr && typeof pgErr.code === 'string') {
    if (pgErr.code === '23505') {
      res.status(409).json({
        error: 'A conflicting record already exists.',
        code: 'CONFLICT',
      });
      return;
    }
    if (pgErr.code === '23514' || pgErr.code === '22P02') {
      res.status(400).json({
        error: 'Invalid input or insufficient balance constraint.',
        code: 'INVALID_DATA',
      });
      return;
    }
  }

  if (!env.isProduction) {
    console.error('[API Error]', err);
  } else {
    console.error('[API Error]', err instanceof Error ? err.message : 'Unknown error');
  }

  res.status(500).json({
    error: 'Internal server error.',
    code: 'INTERNAL_ERROR',
  });
}
