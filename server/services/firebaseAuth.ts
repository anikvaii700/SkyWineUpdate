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
  phoneNumber?: string | null;
}

export type TokenVerifier = (idToken: string) => Promise<VerifiedFirebaseIdentity>;

function getFirebaseAdminApp() {
  if (!env.firebaseProjectId) {
    throw new HttpError(500, 'AUTH_CONFIG_ERROR', 'Firebase project ID is not configured on the server.');
  }
  if (getApps().length > 0) return getApp();
  return initializeApp({ projectId: env.firebaseProjectId });
}

export const defaultTokenVerifier: TokenVerifier = async (idToken: string): Promise<VerifiedFirebaseIdentity> => {
  if (!idToken || idToken.length < 20 || idToken.length > 8192) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid authentication token.');
  }

  try {
    const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(idToken, false);
    if (!decoded.uid) {
      throw new HttpError(401, 'INVALID_TOKEN', 'Authentication token missing subject.');
    }

    const email = typeof decoded.email === 'string' ? decoded.email.toLowerCase() : null;
    // The app maps phone numbers to a Firebase Email/Password alias.
    // Only extract the phone from the verified Firebase token, never from request payloads.
    const phoneAlias = email?.match(/^user_(01[0-9]{9})@phone\\.aviator\\.bd$/i);
    const verifiedPhone = typeof decoded.phone_number === 'string' ? decoded.phone_number : null;

    return {
      uid: decoded.uid,
      email,
      emailVerified: decoded.email_verified === true,
      name: typeof decoded.name === 'string' ? decoded.name : null,
      picture: typeof decoded.picture === 'string' ? decoded.picture : null,
      phoneNumber: verifiedPhone || phoneAlias?.[1] || null,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication token is invalid or expired.');
  }
};
