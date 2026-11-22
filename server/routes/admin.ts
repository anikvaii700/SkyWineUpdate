import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import { adminActionLimiter } from '../middleware/rateLimit.ts';
import {
  adminAdjustUserBalance,
  approveDepositRequest,
  completeWithdrawalRequest,
  getPublicPaymentSettings,
  recordAuditLog,
  rejectDepositRequest,
  rejectWithdrawalRequest,
} from '../services/walletLedger.ts';

const uuidParamSchema = z.string().uuid('Invalid request identifier.');

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  status: z.enum(['all', 'pending', 'approved', 'completed', 'rejected']).default('all'),
  search: z.string().trim().max(80).optional(),
});

const approveBodySchema = z
  .object({
    adminNote: z.string().trim().max(300).optional(),
  })
  .strict();

const rejectBodySchema = z
  .object({
    rejectionReason: z.string().trim().min(3, 'Rejection reason is required.').max(300),
  })
  .strict();

const updateStatusSchema = z
  .object({
    status: z.enum(['active', 'suspended', 'banned']),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

const updateRoleSchema = z
  .object({
    role: z.enum(['user', 'admin']),
  })
  .strict();

const adjustBalanceSchema = z
  .object({
    direction: z.enum(['credit', 'debit']),
    amount: z
      .number()
      .finite()
      .positive()
      .max(1_000_000)
      .refine((v) => Math.round(v * 100) === v * 100, 'Amount supports up to 2 decimal places.'),
    reason: z.string().trim().min(4, 'Audit reason is required.').max(300),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
  })
  .strict();

const gatewayConfigSchema = z
  .object({
    number: z.string().trim().max(24),
    accountType: z.enum(['Personal', 'Agent', 'Merchant']),
    instructions: z.string().trim().max(300),
    isActive: z.boolean(),
  })
  .strict();

const updatePaymentSettingsSchema = z
  .object({
    bkash: gatewayConfigSchema,
    nagad: gatewayConfigSchema,
    rocket: gatewayConfigSchema,
    minDeposit: z.number().finite().positive().max(1_000_000),
    maxDeposit: z.number().finite().positive().max(1_000_000),
    minWithdrawal: z.number().finite().positive().max(1_000_000),
    maxWithdrawal: z.number().finite().positive().max(1_000_000),
    firstDepositBonusPercent: z.number().finite().min(0).max(200),
    noticeText: z.string().trim().max(600),
    withdrawalNoticeText: z.string().trim().max(600),
    marqueeNotice: z.string().trim().max(600),
    telegramChannel: z
      .string()
      .trim()
      .max(200)
      .refine((v) => v === '' || v.startsWith('https://'), 'Must be empty or a valid https:// URL.'),
    telegramSupport: z
      .string()
      .trim()
      .max(200)
      .refine((v) => v === '' || v.startsWith('https://'), 'Must be empty or a valid https:// URL.'),
  })
  .strict()
  .refine((v) => v.maxDeposit >= v.minDeposit, {
    message: 'maxDeposit must be >= minDeposit.',
    path: ['maxDeposit'],
  })
  .refine((v) => v.maxWithdrawal >= v.minWithdrawal, {
    message: 'maxWithdrawal must be >= minWithdrawal.',
    path: ['maxWithdrawal'],
  });

function getClientIp(req: AuthenticatedRequest): string | null {
  return req.ip || null;
}

export function createAdminRouter(): Router {
  const router = Router();
  router.use(adminActionLimiter);

  router.get('/overview', async (_req, res, next) => {
    try {
      const [usersCount, pendingDep, pendingWd, totals] = await Promise.all([
        query(`SELECT COUNT(*)::int AS total_users FROM users`),
        query(`SELECT COUNT(*)::int AS cnt FROM deposit_requests WHERE status = 'pending'`),
        query(`SELECT COUNT(*)::int AS cnt FROM withdrawal_requests WHERE status = 'pending'`),
        query(
          `SELECT
             COALESCE(SUM(total_deposited), 0)::numeric(14,2) AS total_deposited,
             COALESCE(SUM(total_withdrawn), 0)::numeric(14,2) AS total_withdrawn,
             COALESCE(SUM(balance), 0)::numeric(14,2) AS total_wallet_liability
           FROM wallets`
        ),
      ]);

      res.json({
        overview: {
          totalUsers: usersCount.rows[0]?.total_users ?? 0,
          pendingDeposits: pendingDep.rows[0]?.cnt ?? 0,
          pendingWithdrawals: pendingWd.rows[0]?.cnt ?? 0,
          totalDeposited: Number(totals.rows[0]?.total_deposited ?? 0),
          totalWithdrawn: Number(totals.rows[0]?.total_withdrawn ?? 0),
          totalWalletLiability: Number(totals.rows[0]?.total_wallet_liability ?? 0),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/users', async (req, res, next) => {
    try {
      const { limit, offset, search } = paginationSchema.parse(req.query);
      const pattern = search ? `%${search}%` : null;

      const result = await query(
        `SELECT u.firebase_uid, u.user_code, u.email, u.display_name, u.phone_number,
                u.role, u.status, u.referral_code, u.first_deposit_rewarded, u.created_at,
                w.balance, w.invite_bonus_locked, w.total_deposited, w.total_withdrawn
           FROM users u
           JOIN wallets w ON w.user_id = u.firebase_uid
          WHERE ($1::text IS NULL
                 OR u.user_code ILIKE $1
                 OR u.email ILIKE $1
                 OR u.phone_number ILIKE $1
                 OR u.display_name ILIKE $1)
          ORDER BY u.created_at DESC
          LIMIT $2 OFFSET $3`,
        [pattern, limit, offset]
      );

      res.json({ users: result.rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/users/:uid', async (req, res, next) => {
    try {
      const uid = z.string().trim().min(1).max(128).parse(req.params.uid);
      const [userRes, walletRes, txRes, depRes, wdRes] = await Promise.all([
        query(
          `SELECT firebase_uid, user_code, email, display_name, phone_number,
                  role, status, referral_code, referred_by_uid, first_deposit_rewarded, created_at, updated_at
             FROM users WHERE firebase_uid = $1`,
          [uid]
        ),
        query(`SELECT * FROM wallets WHERE user_id = $1`, [uid]),
        query(
          `SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [uid]
        ),
        query(
          `SELECT * FROM deposit_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
          [uid]
        ),
        query(
          `SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
          [uid]
        ),
      ]);

      if (userRes.rows.length === 0) {
        throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.');
      }

      res.json({
        user: userRes.rows[0],
        wallet: walletRes.rows[0] || null,
        transactions: txRes.rows,
        deposits: depRes.rows,
        withdrawals: wdRes.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/users/:uid/status', async (req: AuthenticatedRequest, res, next) => {
    try {
      const targetUid = z.string().trim().min(1).max(128).parse(req.params.uid);
      const body = updateStatusSchema.parse(req.body);

      if (targetUid === req.authUser!.firebaseUid && body.status !== 'active') {
        throw new HttpError(400, 'SELF_RESTRICT_BLOCKED', 'You cannot suspend or ban your own admin account.');
      }

      const updated = await withTransaction(async (client) => {
        const resUpdate = await client.query(
          `UPDATE users SET status = $2, updated_at = NOW() WHERE firebase_uid = $1 RETURNING firebase_uid, user_code, status`,
          [targetUid, body.status]
        );
        if (resUpdate.rows.length === 0) {
          throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.');
        }
        await recordAuditLog(client, {
          adminUid: req.authUser!.firebaseUid,
          action: 'UPDATE_USER_STATUS',
          targetUserId: targetUid,
          entityType: 'user',
          entityId: targetUid,
          details: { status: body.status, reason: body.reason },
          ipAddress: getClientIp(req),
        });
        return resUpdate.rows[0];
      });

      res.json({ user: updated });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/users/:uid/role', async (req: AuthenticatedRequest, res, next) => {
    try {
      const targetUid = z.string().trim().min(1).max(128).parse(req.params.uid);
      const body = updateRoleSchema.parse(req.body);

      if (targetUid === req.authUser!.firebaseUid && body.role !== 'admin') {
        throw new HttpError(400, 'SELF_DEMOTE_BLOCKED', 'You cannot remove your own admin role.');
      }

      const updated = await withTransaction(async (client) => {
        const resUpdate = await client.query(
          `UPDATE users SET role = $2, updated_at = NOW() WHERE firebase_uid = $1 RETURNING firebase_uid, user_code, role`,
          [targetUid, body.role]
        );
        if (resUpdate.rows.length === 0) {
          throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.');
        }
        await recordAuditLog(client, {
          adminUid: req.authUser!.firebaseUid,
          action: 'UPDATE_USER_ROLE',
          targetUserId: targetUid,
          entityType: 'user',
          entityId: targetUid,
          details: { role: body.role },
          ipAddress: getClientIp(req),
        });
        return resUpdate.rows[0];
      });

      res.json({ user: updated });
    } catch (err) {
      next(err);
    }
  });

  router.post('/users/:uid/adjust-balance', async (req: AuthenticatedRequest, res, next) => {
    try {
      const targetUid = z.string().trim().min(1).max(128).parse(req.params.uid);
      const body = adjustBalanceSchema.parse(req.body);
      const result = await adminAdjustUserBalance(
        req.authUser!.firebaseUid,
        targetUid,
        body,
        getClientIp(req)
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/deposits', async (req, res, next) => {
    try {
      const { limit, offset, status } = paginationSchema.parse(req.query);
      const filterStatus = status === 'all' ? null : status;
      const result = await query(
        `SELECT d.*, u.user_code, u.display_name, u.email, u.phone_number
           FROM deposit_requests d
           JOIN users u ON u.firebase_uid = d.user_id
          WHERE ($1::text IS NULL OR d.status = $1)
          ORDER BY d.created_at DESC
          LIMIT $2 OFFSET $3`,
        [filterStatus, limit, offset]
      );
      res.json({ deposits: result.rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/deposits/:id/approve', async (req: AuthenticatedRequest, res, next) => {
    try {
      const requestId = uuidParamSchema.parse(req.params.id);
      const body = approveBodySchema.parse(req.body ?? {});
      const result = await approveDepositRequest(
        req.authUser!.firebaseUid,
        requestId,
        body.adminNote,
        getClientIp(req)
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/deposits/:id/reject', async (req: AuthenticatedRequest, res, next) => {
    try {
      const requestId = uuidParamSchema.parse(req.params.id);
      const body = rejectBodySchema.parse(req.body);
      const deposit = await rejectDepositRequest(
        req.authUser!.firebaseUid,
        requestId,
        body.rejectionReason,
        getClientIp(req)
      );
      res.json({ deposit });
    } catch (err) {
      next(err);
    }
  });

  router.get('/withdrawals', async (req, res, next) => {
    try {
      const { limit, offset, status } = paginationSchema.parse(req.query);
      const filterStatus = status === 'all' ? null : status;
      const result = await query(
        `SELECT w.*, u.user_code, u.display_name, u.email, u.phone_number
           FROM withdrawal_requests w
           JOIN users u ON u.firebase_uid = w.user_id
          WHERE ($1::text IS NULL OR w.status = $1)
          ORDER BY w.created_at DESC
          LIMIT $2 OFFSET $3`,
        [filterStatus, limit, offset]
      );
      res.json({ withdrawals: result.rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/withdrawals/:id/complete', async (req: AuthenticatedRequest, res, next) => {
    try {
      const requestId = uuidParamSchema.parse(req.params.id);
      const body = approveBodySchema.parse(req.body ?? {});
      const withdrawal = await completeWithdrawalRequest(
        req.authUser!.firebaseUid,
        requestId,
        body.adminNote,
        getClientIp(req)
      );
      res.json({ withdrawal });
    } catch (err) {
      next(err);
    }
  });

  router.post('/withdrawals/:id/reject', async (req: AuthenticatedRequest, res, next) => {
    try {
      const requestId = uuidParamSchema.parse(req.params.id);
      const body = rejectBodySchema.parse(req.body);
      const result = await rejectWithdrawalRequest(
        req.authUser!.firebaseUid,
        requestId,
        body.rejectionReason,
        getClientIp(req)
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/settings/payment', async (_req, res, next) => {
    try {
      const paymentSettings = await getPublicPaymentSettings();
      res.json({ paymentSettings });
    } catch (err) {
      next(err);
    }
  });

  router.put('/settings/payment', async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = updatePaymentSettingsSchema.parse(req.body);
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO payment_settings (
             id, bkash_number, bkash_type, bkash_instructions, bkash_active,
             nagad_number, nagad_type, nagad_instructions, nagad_active,
             rocket_number, rocket_type, rocket_instructions, rocket_active,
             min_deposit, max_deposit, min_withdrawal, max_withdrawal,
             first_deposit_bonus_percent, notice_text, withdrawal_notice_text,
             marquee_notice, telegram_channel, telegram_support, updated_by, updated_at
           )
           VALUES (
             1, $1, $2, $3, $4,
             $5, $6, $7, $8,
             $9, $10, $11, $12,
             $13, $14, $15, $16,
             $17, $18, $19,
             $20, $21, $22, $23, NOW()
           )
           ON CONFLICT (id) DO UPDATE SET
             bkash_number = EXCLUDED.bkash_number,
             bkash_type = EXCLUDED.bkash_type,
             bkash_instructions = EXCLUDED.bkash_instructions,
             bkash_active = EXCLUDED.bkash_active,
             nagad_number = EXCLUDED.nagad_number,
             nagad_type = EXCLUDED.nagad_type,
             nagad_instructions = EXCLUDED.nagad_instructions,
             nagad_active = EXCLUDED.nagad_active,
             rocket_number = EXCLUDED.rocket_number,
             rocket_type = EXCLUDED.rocket_type,
             rocket_instructions = EXCLUDED.rocket_instructions,
             rocket_active = EXCLUDED.rocket_active,
             min_deposit = EXCLUDED.min_deposit,
             max_deposit = EXCLUDED.max_deposit,
             min_withdrawal = EXCLUDED.min_withdrawal,
             max_withdrawal = EXCLUDED.max_withdrawal,
             first_deposit_bonus_percent = EXCLUDED.first_deposit_bonus_percent,
             notice_text = EXCLUDED.notice_text,
             withdrawal_notice_text = EXCLUDED.withdrawal_notice_text,
             marquee_notice = EXCLUDED.marquee_notice,
             telegram_channel = EXCLUDED.telegram_channel,
             telegram_support = EXCLUDED.telegram_support,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
          [
            body.bkash.number,
            body.bkash.accountType,
            body.bkash.instructions,
            body.bkash.isActive,
            body.nagad.number,
            body.nagad.accountType,
            body.nagad.instructions,
            body.nagad.isActive,
            body.rocket.number,
            body.rocket.accountType,
            body.rocket.instructions,
            body.rocket.isActive,
            body.minDeposit.toFixed(2),
            body.maxDeposit.toFixed(2),
            body.minWithdrawal.toFixed(2),
            body.maxWithdrawal.toFixed(2),
            body.firstDepositBonusPercent.toFixed(2),
            body.noticeText,
            body.withdrawalNoticeText,
            body.marqueeNotice,
            body.telegramChannel,
            body.telegramSupport,
            req.authUser!.firebaseUid,
          ]
        );

        await recordAuditLog(client, {
          adminUid: req.authUser!.firebaseUid,
          action: 'UPDATE_PAYMENT_SETTINGS',
          entityType: 'payment_settings',
          entityId: '1',
          details: {
            firstDepositBonusPercent: body.firstDepositBonusPercent,
            minDeposit: body.minDeposit,
            maxDeposit: body.maxDeposit,
          },
          ipAddress: getClientIp(req),
        });
      });

      const paymentSettings = await getPublicPaymentSettings();
      res.json({ paymentSettings });
    } catch (err) {
      next(err);
    }
  });

  router.get('/audit-logs', async (req, res, next) => {
    try {
      const { limit, offset } = paginationSchema.parse(req.query);
      const result = await query(
        `SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      res.json({ logs: result.rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
