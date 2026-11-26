import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../config/env.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { verifyPhoneSessionToken } from './phoneAuth.ts';

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

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export const defaultTokenVerifier: TokenVerifier = async (idToken: string): Promise<VerifiedFirebaseIdentity> => {
  if (!idToken || idToken.length < 20 || idToken.length > 8192) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid authentication token.');
  }

  if (idToken.startsWith('skywin_phone_v1.')) {
    return verifyPhoneSessionToken(idToken);
  }

  try {
    const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(idToken, false);
    if (!decoded.uid) {
      throw new HttpError(401, 'INVALID_TOKEN', 'Authentication token missing subject.');
    }

    const email = typeof decoded.email === 'string' ? decoded.email.toLowerCase() : null;
    // A phone number is trusted only when Firebase itself verified it through Phone Auth.
    // The app's legacy phone/password alias is not proof of phone ownership.
    const verifiedPhone = typeof decoded.phone_number === 'string' ? decoded.phone_number : null;

    return {
      uid: decoded.uid,
      email,
      emailVerified: decoded.email_verified === true,
      name: typeof decoded.name === 'string' ? decoded.name : null,
      picture: typeof decoded.picture === 'string' ? decoded.picture : null,
      phoneNumber: verifiedPhone,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication token is invalid or expired.');
  }
};
