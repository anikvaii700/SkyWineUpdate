import type { NextFunction, Request, Response } from 'express';
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

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'MISSING_TOKEN', 'Authorization Bearer token is required.');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new HttpError(401, 'MISSING_TOKEN', 'Authorization Bearer token is empty.');
  }
  return token;
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
      const token = extractBearerToken(req);
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
