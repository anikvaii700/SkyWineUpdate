import crypto from 'node:crypto';
import { env } from '../config/env.ts';
import { query, withTransaction } from '../db/pool.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { getFirebaseAdminAuth } from './firebaseAuth.ts';

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function hashCode(email: string, code: string, salt: string): string {
  return crypto.createHmac('sha256', env.emailOtpPepper || salt).update(email + ':' + code + ':' + salt).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendWithResend(email: string, code: string): Promise<void> {
  if (!env.resendApiKey) {
    throw new HttpError(503, 'EMAIL_SERVICE_NOT_CONFIGURED', 'Email service is not configured yet.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.resendFromEmail,
      to: [email],
      subject: 'Your SkyWinBD verification code',
      text: `Your SkyWinBD verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#172033"><h2>SkyWinBD Email Verification</h2><p>Your verification code is:</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px;background:#f2f7f5;border-radius:10px;text-align:center">${code}</div><p>This code expires in 10 minutes. Do not share it with anyone.</p></div>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('[Email OTP] Resend API error:', response.status, body.slice(0, 500));
    throw new HttpError(502, 'EMAIL_SEND_FAILED', 'Could not send the verification email. Please try again later.');
  }
}

export async function sendEmailVerificationOtp(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!env.emailOtpPepper) {
    throw new HttpError(503, 'EMAIL_OTP_NOT_CONFIGURED', 'Email OTP security configuration is missing.');
  }
  const auth = getFirebaseAdminAuth();
  const firebaseUser = await auth.getUserByEmail(email).catch(() => null);
  if (!firebaseUser) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Create your account before requesting an email code.');
  if (firebaseUser.emailVerified) throw new HttpError(409, 'EMAIL_ALREADY_VERIFIED', 'This email address is already verified.');

  const code = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString('hex');
  const codeHash = hashCode(email, code, salt);

  const saved = await withTransaction(async (client) => {
    const current = await client.query(
      'SELECT sent_at FROM email_verification_otps WHERE email = $1 FOR UPDATE',
      [email]
    );
    if (current.rows.length && Date.now() - new Date(String(current.rows[0].sent_at)).getTime() < 60_000) {
      return false;
    }
    await client.query(
      `INSERT INTO email_verification_otps (email, code_hash, salt, expires_at, attempts, sent_at, consumed_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes', 0, NOW(), NULL)
       ON CONFLICT (email) DO UPDATE
         SET code_hash = EXCLUDED.code_hash,
             salt = EXCLUDED.salt,
             expires_at = EXCLUDED.expires_at,
             attempts = 0,
             sent_at = NOW(),
             consumed_at = NULL`,
      [email, codeHash, salt]
    );
    return true;
  });
  if (!saved) throw new HttpError(429, 'OTP_COOLDOWN', 'Please wait 60 seconds before requesting another code.');

  try {
    await sendWithResend(email, code);
  } catch (err) {
    await query('DELETE FROM email_verification_otps WHERE email = $1', [email]);
    throw err;
  }
}

export async function verifyEmailVerificationOtp(rawEmail: string, rawCode: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.trim();
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'INVALID_OTP', 'Enter the 6-digit verification code.');

  const result = await withTransaction(async (client) => {
    const found = await client.query(
      'SELECT code_hash, salt, expires_at, attempts, consumed_at FROM email_verification_otps WHERE email = $1 FOR UPDATE',
      [email]
    );
    if (!found.rows.length) return { error: 'OTP_NOT_FOUND' as const };
    const row = found.rows[0];
    if (row.consumed_at) return { error: 'OTP_ALREADY_USED' as const };
    if (new Date(String(row.expires_at)).getTime() <= Date.now()) return { error: 'OTP_EXPIRED' as const };
    if (Number(row.attempts) >= 5) return { error: 'OTP_ATTEMPTS_EXCEEDED' as const };

    const expected = hashCode(email, code, String(row.salt));
    if (!safeEqual(expected, String(row.code_hash))) {
      await client.query('UPDATE email_verification_otps SET attempts = attempts + 1 WHERE email = $1', [email]);
      return { error: 'OTP_INVALID' as const };
    }
    await client.query('UPDATE email_verification_otps SET consumed_at = NOW() WHERE email = $1', [email]);
    return { error: null as null };
  });

  if (result.error) {
    const messages = {
      OTP_NOT_FOUND: [404, 'OTP_NOT_FOUND', 'Request a verification code first.'],
      OTP_ALREADY_USED: [400, 'OTP_ALREADY_USED', 'This verification code has already been used.'],
      OTP_EXPIRED: [400, 'OTP_EXPIRED', 'The verification code has expired. Request a new one.'],
      OTP_ATTEMPTS_EXCEEDED: [429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect codes. Request a new code.'],
      OTP_INVALID: [400, 'OTP_INVALID', 'The verification code is incorrect.'],
    } as const;
    const [status, errorCode, message] = messages[result.error];
    throw new HttpError(status, errorCode, message);
  }

  const auth = getFirebaseAdminAuth();
  const user = await auth.getUserByEmail(email).catch(() => null);
  if (!user) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Account not found. Please register again.');
  if (!user.emailVerified) await auth.updateUser(user.uid, { emailVerified: true });


}
