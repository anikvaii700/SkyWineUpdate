import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { financialMutationLimiter } from '../middleware/rateLimit.ts';
import {
  getWalletWithTransactions,
  submitDepositRequest,
  submitWithdrawalRequest,
  updateUserProfile,
} from '../services/walletLedger.ts';

const paymentMethodSchema = z.enum(['bkash', 'nagad', 'rocket']);

const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s]{10,16}$/, 'Invalid mobile number format.')
      .optional(),
    referralCode: z.string().trim().min(3).max(32).optional(),
  })
  .strict();

const createDepositSchema = z
  .object({
    method: paymentMethodSchema,
    senderNumber: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s]{10,16}$/, 'Invalid sender mobile number.'),
    trxId: z
      .string()
      .trim()
      .min(4, 'Transaction ID is too short.')
      .max(64, 'Transaction ID is too long.')
      .regex(/^[A-Za-z0-9\-_]+$/, 'Transaction ID contains invalid characters.'),
    amount: z
      .number()
      .finite()
      .positive()
      .max(1_000_000)
      .refine((v) => Math.round(v * 100) === v * 100, 'Amount supports up to 2 decimal places.'),
  })
  .strict();

const createWithdrawalSchema = z
  .object({
    method: paymentMethodSchema,
    personalNumber: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s]{10,16}$/, 'Invalid personal mobile number.'),
    amount: z
      .number()
      .finite()
      .positive()
      .max(1_000_000)
      .refine((v) => Math.round(v * 100) === v * 100, 'Amount supports up to 2 decimal places.'),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
  })
  .strict();

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

export function createWalletRouter(requireAuth: RequestHandler): Router {
  const router = Router();

  router.get('/me', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.authUser!;
      const { wallet } = await getWalletWithTransactions(user.firebaseUid, 1, 0);
      res.json({
        user: {
          uid: user.firebaseUid,
          userCode: user.userCode,
          email: user.email,
          displayName: user.displayName,
          phoneNumber: user.phoneNumber,
          role: user.role,
          isAdmin: user.role === 'admin',
          status: user.status,
          referralCode: user.referralCode,
          firstDepositRewarded: user.firstDepositRewarded,
          createdAt: user.createdAt,
        },
        wallet,
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/me/profile', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = updateProfileSchema.parse(req.body);
      const updated = await updateUserProfile(req.authUser!.firebaseUid, body);
      res.json({
        user: {
          uid: updated.firebaseUid,
          userCode: updated.userCode,
          email: updated.email,
          displayName: updated.displayName,
          phoneNumber: updated.phoneNumber,
          role: updated.role,
          isAdmin: updated.role === 'admin',
          referralCode: updated.referralCode,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/wallet', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { limit, offset } = paginationSchema.parse(req.query);
      const data = await getWalletWithTransactions(req.authUser!.firebaseUid, limit, offset);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  router.get('/deposits', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { limit, offset } = paginationSchema.parse(req.query);
      const result = await query(
        `SELECT id, method, target_number, sender_number, trx_id, amount, status,
                is_first_deposit, bonus_percent, bonus_amount, total_credited,
                rejection_reason, created_at, updated_at
           FROM deposit_requests
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [req.authUser!.firebaseUid, limit, offset]
      );
      res.json({ deposits: result.rows });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/deposits',
    requireAuth,
    financialMutationLimiter,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const body = createDepositSchema.parse(req.body);
        const deposit = await submitDepositRequest(req.authUser!.firebaseUid, body);
        res.status(201).json({ deposit });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get('/withdrawals', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { limit, offset } = paginationSchema.parse(req.query);
      const result = await query(
        `SELECT id, method, personal_number, amount, status,
                rejection_reason, created_at, updated_at
           FROM withdrawal_requests
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [req.authUser!.firebaseUid, limit, offset]
      );
      res.json({ withdrawals: result.rows });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/withdrawals',
    requireAuth,
    financialMutationLimiter,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const body = createWithdrawalSchema.parse(req.body);
        const result = await submitWithdrawalRequest(req.authUser!.firebaseUid, body);
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get('/referrals', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const uid = req.authUser!.firebaseUid;
      const result = await query(
        `SELECT r.id, r.status, r.reward_amount, r.created_at, r.rewarded_at,
                u.firebase_uid AS referred_uid,
                u.user_code AS referred_user_code,
                u.display_name AS referred_name,
                u.phone_number AS referred_phone,
                COALESCE(first_deposit.amount, 0) AS first_deposit_amount
           FROM referrals r
           JOIN users u ON u.firebase_uid = r.referred_uid
           LEFT JOIN LATERAL (
             SELECT d.amount
               FROM deposit_requests d
              WHERE d.user_id = r.referred_uid
                AND d.status = 'approved'
                AND d.is_first_deposit = TRUE
              ORDER BY d.reviewed_at ASC
              LIMIT 1
           ) AS first_deposit ON TRUE
          WHERE r.referrer_uid = $1
          ORDER BY r.created_at DESC
          LIMIT 100`,
        [uid]
      );
      const referrals = result.rows.map((row) => ({
        id: String(row.id),
        status: row.status === 'rewarded' ? 'rewarded' : 'pending',
        bonus_amount: Number(row.reward_amount || 0),
        created_at: new Date(String(row.created_at)).toISOString(),
        rewarded_at: row.rewarded_at ? new Date(String(row.rewarded_at)).toISOString() : null,
        referred_uid: String(row.referred_uid),
        referred_user_code: String(row.referred_user_code),
        referred_name: String(row.referred_name || 'Player'),
        referred_phone: row.referred_phone ? String(row.referred_phone) : '',
        first_deposit_amount: Number(row.first_deposit_amount || 0),
      }));
      res.json({
        referralCode: req.authUser!.referralCode,
        referrals,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
