import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../config/env.ts';
import { HttpError } from '../middleware/errorHandler.ts';

export interface VerifiedFirebaseIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export type TokenVerifier = (idToken: string) => Promise<VerifiedFirebaseIdentity>;

function getFirebaseAdminApp() {
  if (!env.firebaseProjectId) {
    throw new HttpError(
      500,
      'AUTH_CONFIG_ERROR',
      'Firebase project ID is not configured on the server.'
    );
  }

  if (getApps().length > 0) {
    return getApp();
  }

  // Initializing with only projectId requires zero IAM roles, zero service account keys,
  // and works on every Firebase tier (Spark / Starter / Blaze) for RS256 ID token verification.
  return initializeApp({ projectId: env.firebaseProjectId });
}

export const defaultTokenVerifier: TokenVerifier = async (
  idToken: string
): Promise<VerifiedFirebaseIdentity> => {
  if (!idToken || idToken.length < 20 || idToken.length > 8192) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid authentication token.');
  }

  try {
    const app = getFirebaseAdminApp();
    // checkRevoked = false intentionally: uses Google's public x509 keys with zero IAM/billing needed.
    const decoded = await getAuth(app).verifyIdToken(idToken, false);

    if (!decoded.uid) {
      throw new HttpError(401, 'INVALID_TOKEN', 'Authentication token missing subject.');
    }

    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email.toLowerCase() : null,
      emailVerified: decoded.email_verified === true,
      name: typeof decoded.name === 'string' ? decoded.name : null,
      picture: typeof decoded.picture === 'string' ? decoded.picture : null,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication token is invalid or expired.');
  }
};
