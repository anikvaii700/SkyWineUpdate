import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.ts';
import { PHONE_SESSION_COOKIE_NAME } from '../routes/phoneAuth.ts';
import {
  defaultTokenVerifier,
  type TokenVerifier,
  type VerifiedFirebaseIdentity,
} from '../services/firebaseAuth.ts';
import { ensureUserAndWallet, type DbUser } from '../services/walletLedger.ts';
import { HttpError } from './errorHandler.ts';

export interface AuthenticatedRequest extends Request {
  firebaseIdentity?: VerifiedFirebaseIdentity;
  authUser?: DbUser;
}

export interface AuthMiddlewareDeps {
  verifyToken?: TokenVerifier;
  resolveUser?: (identity: VerifiedFirebaseIdentity) => Promise<DbUser>;
}

function readCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      const rawVal = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(rawVal);
      } catch {
        return rawVal;
      }
    }
  }
  return null;
}

function isTrustedCookieMutation(req: Request): boolean {
  const xrw = req.headers['x-requested-with'];
  if (typeof xrw === 'string' && xrw.trim().length > 0) {
    return true;
  }

  const origin = req.headers.origin?.replace(/\/+$/, '');
  if (!origin) return false;

  const forwardedHostRaw = req.headers['x-forwarded-host'];
  const forwardedHost = Array.isArray(forwardedHostRaw)
    ? forwardedHostRaw[0]?.split(',')[0]?.trim()
    : forwardedHostRaw?.split(',')[0]?.trim();
  const ngAllowedHosts = (process.env.NG_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const envUrlHosts: string[] = [];
  for (const rawUrl of [process.env.APP_URL, process.env.SHARED_APP_URL]) {
    if (!rawUrl) continue;
    try {
      envUrlHosts.push(new URL(rawUrl).host);
    } catch {
      // Ignore invalid URL env value.
    }
  }

  const baseHosts = [req.headers.host, forwardedHost, ...ngAllowedHosts, ...envUrlHosts].filter(
    (h): h is string => Boolean(h)
  );
  const allowedHosts = new Set<string>(baseHosts);
  for (const h of baseHosts) {
    const aiStudioMatch = /^ais-(dev|pre|mob)-(.+)$/i.exec(h);
    if (aiStudioMatch) {
      const suffix = aiStudioMatch[2];
      allowedHosts.add(`ais-dev-${suffix}`);
      allowedHosts.add(`ais-pre-${suffix}`);
      allowedHosts.add(`ais-mob-${suffix}`);
    }
  }

  if (Array.from(allowedHosts).some((h) => origin === `https://${h}` || origin === `http://${h}`)) {
    return true;
  }

  return env.allowedOrigins.some((allowed) => allowed.replace(/\/+$/, '') === origin);
}

function extractAuthToken(req: Request): { token: string; source: 'bearer' | 'cookie' } {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new HttpError(401, 'MISSING_TOKEN', 'Authorization Bearer token is empty.');
    }
    return { token, source: 'bearer' };
  }

  const cookieToken = readCookieValue(req.headers.cookie, PHONE_SESSION_COOKIE_NAME);
  if (cookieToken && cookieToken.startsWith('skywin_phone_v1.')) {
    const method = req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !isTrustedCookieMutation(req)) {
      throw new HttpError(403, 'CSRF_FORBIDDEN', 'Cross-site request blocked.');
    }
    return { token: cookieToken, source: 'cookie' };
  }

  throw new HttpError(401, 'MISSING_TOKEN', 'Authorization Bearer token is required.');
}

export function createAuthMiddleware(deps: AuthMiddlewareDeps = {}) {
  const verifyToken = deps.verifyToken ?? defaultTokenVerifier;
  const resolveUser = deps.resolveUser ?? ensureUserAndWallet;

  const requireAuth = async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { token } = extractAuthToken(req);
      const identity = await verifyToken(token);
      const user = await resolveUser(identity);

      if (user.status !== 'active') {
        throw new HttpError(
          403,
          'ACCOUNT_RESTRICTED',
          `Account is currently ${user.status}. Contact support.`
        );
      }

      req.firebaseIdentity = identity;
      req.authUser = user;
      next();
    } catch (err) {
      next(err);
    }
  };

  const requireAdmin = (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
  ): void => {
    if (!req.authUser) {
      next(new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.'));
      return;
    }

    if (req.authUser.role !== 'admin') {
      next(new HttpError(403, 'FORBIDDEN', 'Administrator privileges are required.'));
      return;
    }

    next();
  };

  return { requireAuth, requireAdmin };
}
