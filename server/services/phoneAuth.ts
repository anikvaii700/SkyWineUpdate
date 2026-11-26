import crypto from 'node:crypto';
import { query, withTransaction } from '../db/pool.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import type { VerifiedFirebaseIdentity } from './firebaseAuth.ts';
import {
  ensureUserAndWallet,
  getWalletWithTransactions,
  normalizePhone,
  updateUserProfile,
} from './walletLedger.ts';

const PHONE_TOKEN_PREFIX = 'skywin_phone_v1.';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DUMMY_SALT = '00000000000000000000000000000000';

// Read SESSION_SECRET from env if provided; otherwise generate a strong per-process secret in memory.
const SESSION_SIGNING_KEY =
  (process.env.SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');

interface PhoneSessionPayload {
  uid: string;
  phoneNumber: string;
  name: string;
  iat: number;
  exp: number;
}

export function normalizeBdPhone(rawPhone: string): string {
  const clean = normalizePhone(rawPhone);
  if (!/^01[3-9][0-9]{8}$/.test(clean)) {
    throw new HttpError(
      400,
      'INVALID_PHONE_NUMBER',
      'সঠিক ১১ ডিজিটের বাংলাদেশি মোবাইল নাম্বার দিন (যেমন: 017XXXXXXXX)।'
    );
  }
  return clean;
}

function hashPasswordScrypt(password: string, saltHex: string): string {
  return crypto.scryptSync(password, saltHex, 64).toString('hex');
}

function verifyPasswordScrypt(password: string, saltHex: string, storedHashHex: string): boolean {
  const computedHex = hashPasswordScrypt(password, saltHex);
  const a = Buffer.from(computedHex, 'hex');
  const b = Buffer.from(storedHashHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signPayload(encodedPayload: string): string {
  return crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(encodedPayload)
    .digest('base64url');
}

export function issuePhoneSessionToken(input: {
  uid: string;
  phoneNumber: string;
  displayName: string;
}): string {
  const now = Date.now();
  const payload: PhoneSessionPayload = {
    uid: input.uid,
    phoneNumber: input.phoneNumber,
    name: input.displayName,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = signPayload(encoded);
  return `${PHONE_TOKEN_PREFIX}${encoded}.${sig}`;
}

export function verifyPhoneSessionToken(token: string): VerifiedFirebaseIdentity {
  if (!token.startsWith(PHONE_TOKEN_PREFIX)) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid authentication token.');
  }

  const body = token.slice(PHONE_TOKEN_PREFIX.length);
  const dotIdx = body.indexOf('.');
  if (dotIdx <= 0 || dotIdx === body.length - 1) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Malformed session token.');
  }

  const encodedPayload = body.slice(0, dotIdx);
  const providedSig = body.slice(dotIdx + 1);
  const expectedSig = signPayload(encodedPayload);

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Session signature is invalid.');
  }

  let parsed: PhoneSessionPayload;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as PhoneSessionPayload;
  } catch {
    throw new HttpError(401, 'INVALID_TOKEN', 'Session payload is invalid.');
  }

  if (
    !parsed ||
    typeof parsed.uid !== 'string' ||
    !parsed.uid.startsWith('phone_') ||
    typeof parsed.phoneNumber !== 'string' ||
    typeof parsed.exp !== 'number' ||
    parsed.exp <= Date.now()
  ) {
    throw new HttpError(401, 'TOKEN_EXPIRED', 'আপনার সেশন মেয়াদ শেষ হয়েছে। অনুগ্রহ করে আবার লগইন করুন।');
  }

  return {
    uid: parsed.uid,
    email: null,
    emailVerified: false,
    name: typeof parsed.name === 'string' && parsed.name ? parsed.name : `User ${parsed.phoneNumber}`,
    picture: null,
    phoneNumber: parsed.phoneNumber,
  };
}

export async function signupWithPhonePassword(input: {
  phone: string;
  password: string;
  displayName?: string;
  referralCode?: string;
}) {
  const cleanPhone = normalizeBdPhone(input.phone);
  const password = input.password;
  if (!password || password.length < 6 || password.length > 128) {
    throw new HttpError(400, 'INVALID_PASSWORD', 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।');
  }

  const uid = `phone_${cleanPhone}`;
  const cleanName = input.displayName?.trim()
    ? input.displayName.trim().slice(0, 80)
    : `User ${cleanPhone.slice(0, 5)}-${cleanPhone.slice(5)}`;
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPasswordScrypt(password, salt);

  await withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT * FROM phone_accounts WHERE phone_number = $1`,
      [cleanPhone]
    );
    if (existing.rows.length > 0) {
      throw new HttpError(
        409,
        'PHONE_ALREADY_REGISTERED',
        'এই মোবাইল নাম্বার দিয়ে আগে থেকেই অ্যাকাউন্ট খোলা আছে। অনুগ্রহ করে লগইন করুন।'
      );
    }

    await client.query(
      `INSERT INTO phone_accounts (phone_number, user_uid, password_hash, password_salt)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [cleanPhone, uid, passwordHash, salt]
    );
  });

  const identity: VerifiedFirebaseIdentity = {
    uid,
    email: null,
    emailVerified: false,
    name: cleanName,
    picture: null,
    phoneNumber: cleanPhone,
  };

  let dbUser = await ensureUserAndWallet(identity);
  if (input.displayName?.trim() || input.referralCode?.trim()) {
    dbUser = await updateUserProfile(dbUser.firebaseUid, {
      ...(input.displayName?.trim() ? { displayName: cleanName } : {}),
      ...(input.referralCode?.trim() ? { referralCode: input.referralCode.trim() } : {}),
    });
  }

  const { wallet } = await getWalletWithTransactions(dbUser.firebaseUid, 1, 0);
  const token = issuePhoneSessionToken({
    uid: dbUser.firebaseUid,
    phoneNumber: cleanPhone,
    displayName: dbUser.displayName,
  });

  return {
    token,
    user: {
      uid: dbUser.firebaseUid,
      userCode: dbUser.userCode,
      email: dbUser.email,
      displayName: dbUser.displayName,
      phoneNumber: dbUser.phoneNumber,
      role: dbUser.role,
      isAdmin: dbUser.role === 'admin',
      status: dbUser.status,
      referralCode: dbUser.referralCode,
      firstDepositRewarded: dbUser.firstDepositRewarded,
      createdAt: dbUser.createdAt,
    },
    wallet,
  };
}

export async function loginWithPhonePassword(input: {
  phone: string;
  password: string;
  referralCode?: string;
}) {
  const cleanPhone = normalizeBdPhone(input.phone);
  const password = input.password;
  if (!password || password.length < 6 || password.length > 128) {
    throw new HttpError(400, 'INVALID_PASSWORD', 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।');
  }

  const res = await query(
    `SELECT * FROM phone_accounts WHERE phone_number = $1`,
    [cleanPhone]
  );

  if (res.rows.length === 0) {
    // Run scrypt anyway to equalize timing on unknown phone numbers.
    verifyPasswordScrypt(password, DUMMY_SALT, '0'.repeat(128));
    throw new HttpError(
      401,
      'INVALID_PHONE_CREDENTIALS',
      'মোবাইল নাম্বার অথবা পাসওয়ার্ড সঠিক নয়।'
    );
  }

  const account = res.rows[0] as {
    phone_number: string;
    user_uid: string;
    password_hash: string;
    password_salt: string;
  };

  const valid = verifyPasswordScrypt(password, account.password_salt, account.password_hash);
  if (!valid) {
    throw new HttpError(
      401,
      'INVALID_PHONE_CREDENTIALS',
      'মোবাইল নাম্বার অথবা পাসওয়ার্ড সঠিক নয়।'
    );
  }

  const identity: VerifiedFirebaseIdentity = {
    uid: account.user_uid,
    email: null,
    emailVerified: false,
    name: `User ${cleanPhone.slice(0, 5)}-${cleanPhone.slice(5)}`,
    picture: null,
    phoneNumber: cleanPhone,
  };

  let dbUser = await ensureUserAndWallet(identity);
  if (dbUser.status !== 'active') {
    throw new HttpError(
      403,
      'ACCOUNT_RESTRICTED',
      `Account is currently ${dbUser.status}. Contact support.`
    );
  }

  if (input.referralCode?.trim()) {
    dbUser = await updateUserProfile(dbUser.firebaseUid, {
      referralCode: input.referralCode.trim(),
    });
  }

  const { wallet } = await getWalletWithTransactions(dbUser.firebaseUid, 1, 0);
  const token = issuePhoneSessionToken({
    uid: dbUser.firebaseUid,
    phoneNumber: cleanPhone,
    displayName: dbUser.displayName,
  });

  return {
    token,
    user: {
      uid: dbUser.firebaseUid,
      userCode: dbUser.userCode,
      email: dbUser.email,
      displayName: dbUser.displayName,
      phoneNumber: dbUser.phoneNumber,
      role: dbUser.role,
      isAdmin: dbUser.role === 'admin',
      status: dbUser.status,
      referralCode: dbUser.referralCode,
      firstDepositRewarded: dbUser.firstDepositRewarded,
      createdAt: dbUser.createdAt,
    },
    wallet,
  };
}
