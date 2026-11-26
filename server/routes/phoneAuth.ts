import { Router } from 'express';
import { z } from 'zod';
import { phoneAuthLimiter } from '../middleware/rateLimit.ts';
import { loginWithPhonePassword, signupWithPhonePassword } from '../services/phoneAuth.ts';

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
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
