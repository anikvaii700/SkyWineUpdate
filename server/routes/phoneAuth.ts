import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { phoneAuthLimiter } from '../middleware/rateLimit.ts';
import { loginWithPhonePassword, signupWithPhonePassword } from '../services/phoneAuth.ts';

export const PHONE_SESSION_COOKIE_NAME = 'skywin_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]?.split(',')[0]?.trim()
    : forwardedProto?.split(',')[0]?.trim();
  return req.secure || proto === 'https';
}

function setPhoneSessionCookie(req: Request, res: Response, token: string): void {
  const encoded = encodeURIComponent(token);
  const expiresUtc = new Date(Date.now() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000).toUTCString();
  const baseParts = [
    `${PHONE_SESSION_COOKIE_NAME}=${encoded}`,
    'Path=/',
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
    `Expires=${expiresUtc}`,
    'HttpOnly',
  ];
  if (isHttpsRequest(req)) {
    baseParts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    baseParts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', baseParts.join('; '));
}

function clearPhoneSessionCookie(req: Request, res: Response): void {
  const baseParts = [
    `${PHONE_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
  ];
  if (isHttpsRequest(req)) {
    baseParts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    baseParts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', baseParts.join('; '));
}

const phoneSignupSchema = z
  .object({
    phone: z.string().trim().min(10, 'সঠিক ১১ ডিজিটের মোবাইল নাম্বার দিন।').max(20),
    password: z.string().min(6, 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।').max(128),
    displayName: z.string().trim().max(80).optional(),
    referralCode: z.string().trim().max(32).optional(),
  })
  .strict();

const phoneLoginSchema = z
  .object({
    phone: z.string().trim().min(10, 'সঠিক ১১ ডিজিটের মোবাইল নাম্বার দিন।').max(20),
    password: z.string().min(6, 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।').max(128),
    referralCode: z.string().trim().max(32).optional(),
  })
  .strict();

export function createPhoneAuthRouter(): Router {
  const router = Router();

  router.post('/auth/phone-signup', phoneAuthLimiter, async (req, res, next) => {
    try {
      const body = phoneSignupSchema.parse(req.body);
      const result = await signupWithPhonePassword({
        phone: body.phone,
        password: body.password,
        displayName: body.displayName,
        referralCode: body.referralCode,
      });
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/phone-login', phoneAuthLimiter, async (req, res, next) => {
    try {
      const body = phoneLoginSchema.parse(req.body);
      const result = await loginWithPhonePassword({
        phone: body.phone,
        password: body.password,
        referralCode: body.referralCode,
      });
      setPhoneSessionCookie(req, res, result.token);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/logout', (req, res) => {
    clearPhoneSessionCookie(req, res);
    res.json({ ok: true });
  });

  return router;
}
