import { Router } from 'express';
import { z } from 'zod';
import { emailOtpSendLimiter, emailOtpVerifyLimiter } from '../middleware/rateLimit.ts';
import { sendEmailVerificationOtp, verifyEmailVerificationOtp } from '../services/emailOtp.ts';

const emailSchema = z.string().trim().email().max(254);
const verifySchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\\d{6}$/),
}).strict();

export function createEmailOtpRouter(): Router {
  const router = Router();

  router.post('/auth/email-otp/send', emailOtpSendLimiter, async (req, res, next) => {
    try {
      const email = emailSchema.parse((req.body as { email?: unknown })?.email);
      await sendEmailVerificationOtp(email);
      res.status(202).json({ ok: true, message: 'Verification code sent.' });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/email-otp/verify', emailOtpVerifyLimiter, async (req, res, next) => {
    try {
      const body = verifySchema.parse(req.body);
      await verifyEmailVerificationOtp(body.email, body.code);
      res.json({ ok: true, verified: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
