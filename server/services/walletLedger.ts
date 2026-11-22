import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../config/env.ts';
import { query, withTransaction } from '../db/pool.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import type { VerifiedFirebaseIdentity } from './firebaseAuth.ts';

export type PaymentMethod = 'bkash' | 'nagad' | 'rocket';
export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'banned';

export interface DbUser {
  firebaseUid: string;
  userCode: string;
  email: string | null;
  displayName: string;
  phoneNumber: string | null;
  role: UserRole;
  status: UserStatus;
  referralCode: string;
  referredByUid: string | null;
  firstDepositRewarded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WalletSummary {
  userId: string;
  balance: number;
  inviteBonusLocked: number;
  withdrawableBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  version: number;
  updatedAt: string;
}

export interface LedgerTransaction {
  id: string;
  userId: string;
  type: string;
  direction: 'credit' | 'debit';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface PublicPaymentSettings {
  bkash: { number: string; accountType: 'Personal' | 'Agent' | 'Merchant'; instructions: string; isActive: boolean };
  nagad: { number: string; accountType: 'Personal' | 'Agent' | 'Merchant'; instructions: string; isActive: boolean };
  rocket: { number: string; accountType: 'Personal' | 'Agent' | 'Merchant'; instructions: string; isActive: boolean };
  minDeposit: number;
  maxDeposit: number;
  minWithdrawal: number;
  maxWithdrawal: number;
  firstDepositBonusPercent: number;
  noticeText: string;
  withdrawalNoticeText: string;
  marqueeNotice: string;
  telegramChannel: string;
  telegramSupport: string;
  updatedAt: string;
}

export function toPaisa(amount: number): number {
  return Math.round(Number(amount) * 100);
}

export function fromPaisa(paisa: number): number {
  return Number((paisa / 100).toFixed(2));
}

export function parseNumeric(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function normalizePhone(raw: string): string {
  let clean = raw.replace(/[^0-9]/g, '');
  if (clean.startsWith('880') && clean.length === 13) {
    clean = '0' + clean.slice(3);
  }
  return clean;
}

export function normalizeTrxId(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function generateUserCode(): string {
  const num = crypto.randomInt(100000, 999999);
  return `USER-${num}`;
}

function mapUserRow(row: Record<string, unknown>): DbUser {
  return {
    firebaseUid: String(row.firebase_uid),
    userCode: String(row.user_code),
    email: row.email ? String(row.email) : null,
    displayName: String(row.display_name || 'Player'),
    phoneNumber: row.phone_number ? String(row.phone_number) : null,
    role: row.role === 'admin' ? 'admin' : 'user',
    status: (row.status as UserStatus) || 'active',
    referralCode: String(row.referral_code),
    referredByUid: row.referred_by_uid ? String(row.referred_by_uid) : null,
    firstDepositRewarded: Boolean(row.first_deposit_rewarded),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapWalletRow(row: Record<string, unknown>): WalletSummary {
  const balancePaisa = toPaisa(parseNumeric(row.balance as string));
  const lockedPaisa = toPaisa(parseNumeric(row.invite_bonus_locked as string));
  const withdrawablePaisa = Math.max(0, balancePaisa - lockedPaisa);
  return {
    userId: String(row.user_id),
    balance: fromPaisa(balancePaisa),
    inviteBonusLocked: fromPaisa(lockedPaisa),
    withdrawableBalance: fromPaisa(withdrawablePaisa),
    totalDeposited: parseNumeric(row.total_deposited as string),
    totalWithdrawn: parseNumeric(row.total_withdrawn as string),
    version: Number(row.version || 1),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapTxRow(row: Record<string, unknown>): LedgerTransaction {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: String(row.type),
    direction: row.direction === 'debit' ? 'debit' : 'credit',
    amount: parseNumeric(row.amount as string),
    balanceBefore: parseNumeric(row.balance_before as string),
    balanceAfter: parseNumeric(row.balance_after as string),
    referenceType: row.reference_type ? String(row.reference_type) : null,
    referenceId: row.reference_id ? String(row.reference_id) : null,
    note: row.note ? String(row.note) : null,
    createdBy: String(row.created_by),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapSettingsRow(row: Record<string, unknown>): PublicPaymentSettings {
  return {
    bkash: {
      number: String(row.bkash_number || ''),
      accountType: (row.bkash_type as 'Personal' | 'Agent' | 'Merchant') || 'Personal',
      instructions: String(row.bkash_instructions || ''),
      isActive: Boolean(row.bkash_active),
    },
    nagad: {
      number: String(row.nagad_number || ''),
      accountType: (row.nagad_type as 'Personal' | 'Agent' | 'Merchant') || 'Personal',
      instructions: String(row.nagad_instructions || ''),
      isActive: Boolean(row.nagad_active),
    },
    rocket: {
      number: String(row.rocket_number || ''),
      accountType: (row.rocket_type as 'Personal' | 'Agent' | 'Merchant') || 'Personal',
      instructions: String(row.rocket_instructions || ''),
      isActive: Boolean(row.rocket_active),
    },
    minDeposit: parseNumeric(row.min_deposit as string),
    maxDeposit: parseNumeric(row.max_deposit as string),
    minWithdrawal: parseNumeric(row.min_withdrawal as string),
    maxWithdrawal: parseNumeric(row.max_withdrawal as string),
    firstDepositBonusPercent: parseNumeric(row.first_deposit_bonus_percent as string),
    noticeText: String(row.notice_text || ''),
    withdrawalNoticeText: String(row.withdrawal_notice_text || ''),
    marqueeNotice: String(row.marquee_notice || ''),
    telegramChannel: String(row.telegram_channel || ''),
    telegramSupport: String(row.telegram_support || ''),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function isBootstrapAdminEmail(identity: VerifiedFirebaseIdentity): boolean {
  if (!identity.email || !identity.emailVerified) return false;
  return env.adminEmails.includes(identity.email.toLowerCase());
}

export async function recordAuditLog(
  client: PoolClient,
  params: {
    adminUid: string;
    action: string;
    targetUserId?: string | null;
    entityType: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO admin_audit_logs
       (admin_uid, action, target_user_id, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      params.adminUid,
      params.action,
      params.targetUserId ?? null,
      params.entityType,
      params.entityId ?? null,
      JSON.stringify(params.details ?? {}),
      params.ipAddress ?? null,
    ]
  );
}

/**
 * Ensures the authenticated Firebase user exists in PostgreSQL with an initialized 0.00 wallet.
 * Never accepts balance or role from client requests; only promotes bootstrap admin emails
 * configured in server-side ADMIN_EMAILS when email_verified is true.
 */
export async function ensureUserAndWallet(identity: VerifiedFirebaseIdentity): Promise<DbUser> {
  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT * FROM users WHERE firebase_uid = $1 FOR UPDATE`,
      [identity.uid]
    );

    const bootstrapAdmin = isBootstrapAdminEmail(identity);

    if (existing.rows.length > 0) {
      const current = mapUserRow(existing.rows[0]);
      const nextRole: UserRole = bootstrapAdmin ? 'admin' : current.role;
      const nextEmail = identity.email ?? current.email;
      const nextName =
        current.displayName && current.displayName !== 'Player'
          ? current.displayName
          : identity.name || 'Player';

      if (nextRole !== current.role || nextEmail !== current.email || nextName !== current.displayName) {
        const updated = await client.query(
          `UPDATE users
             SET role = $2,
                 email = $3,
                 display_name = $4,
                 updated_at = NOW()
           WHERE firebase_uid = $1
           RETURNING *`,
          [identity.uid, nextRole, nextEmail, nextName]
        );
        await client.query(
          `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
          [identity.uid]
        );
        return mapUserRow(updated.rows[0]);
      }

      await client.query(
        `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [identity.uid]
      );
      return current;
    }

    const displayName = (identity.name || identity.email?.split('@')[0] || 'Player').slice(0, 80);
    const initialRole: UserRole = bootstrapAdmin ? 'admin' : 'user';

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateUserCode();
      try {
        const inserted = await client.query(
          `INSERT INTO users
             (firebase_uid, user_code, email, display_name, role, referral_code)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [identity.uid, code, identity.email, displayName, initialRole, code]
        );
        await client.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [identity.uid]);
        return mapUserRow(inserted.rows[0]);
      } catch (err) {
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505' && attempt < 4) continue;
        throw err;
      }
    }

    throw new HttpError(500, 'USER_PROVISION_FAILED', 'Unable to allocate unique user code.');
  });
}

export async function getPublicPaymentSettings(): Promise<PublicPaymentSettings> {
  const res = await query(`SELECT * FROM payment_settings WHERE id = 1`);
  if (res.rows.length === 0) {
    const inserted = await query(
      `INSERT INTO payment_settings (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id = 1 RETURNING *`
    );
    return mapSettingsRow(inserted.rows[0]);
  }
  return mapSettingsRow(res.rows[0]);
}

export async function getWalletWithTransactions(
  userId: string,
  limit = 30,
  offset = 0
): Promise<{ wallet: WalletSummary; transactions: LedgerTransaction[] }> {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.max(0, offset);

  const [walletRes, txRes] = await Promise.all([
    query(`SELECT * FROM wallets WHERE user_id = $1`, [userId]),
    query(
      `SELECT * FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, safeOffset]
    ),
  ]);

  if (walletRes.rows.length === 0) {
    throw new HttpError(404, 'WALLET_NOT_FOUND', 'Wallet not found.');
  }

  return {
    wallet: mapWalletRow(walletRes.rows[0]),
    transactions: txRes.rows.map(mapTxRow),
  };
}

/**
 * Applies a single atomic ledger entry inside an existing DB transaction with SELECT ... FOR UPDATE.
 */
async function applyLedgerEntryTx(
  client: PoolClient,
  params: {
    userId: string;
    type:
      | 'deposit'
      | 'deposit_bonus'
      | 'referral_invite_bonus'
      | 'withdrawal_hold'
      | 'withdrawal_refund'
      | 'admin_credit'
      | 'admin_debit';
    direction: 'credit' | 'debit';
    amountPaisa: number;
    lockAsInviteBonus?: boolean;
    requireWithdrawable?: boolean;
    incrementTotalDeposited?: boolean;
    incrementTotalWithdrawn?: boolean;
    referenceType?: string | null;
    referenceId?: string | null;
    idempotencyKey?: string | null;
    note?: string | null;
    createdBy: string;
  }
): Promise<{ wallet: WalletSummary; transaction: LedgerTransaction; alreadyApplied: boolean }> {
  if (!Number.isInteger(params.amountPaisa) || params.amountPaisa <= 0) {
    throw new HttpError(400, 'INVALID_AMOUNT', 'Amount must be a positive value.');
  }

  if (params.idempotencyKey) {
    const existingTx = await client.query(
      `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
      [params.idempotencyKey]
    );
    if (existingTx.rows.length > 0) {
      const walletRes = await client.query(`SELECT * FROM wallets WHERE user_id = $1`, [
        params.userId,
      ]);
      return {
        wallet: mapWalletRow(walletRes.rows[0]),
        transaction: mapTxRow(existingTx.rows[0]),
        alreadyApplied: true,
      };
    }
  }

  const walletLock = await client.query(
    `SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE`,
    [params.userId]
  );

  if (walletLock.rows.length === 0) {
    throw new HttpError(404, 'WALLET_NOT_FOUND', 'Target user wallet does not exist.');
  }

  const currentRow = walletLock.rows[0];
  const beforePaisa = toPaisa(parseNumeric(currentRow.balance as string));
  const lockedBeforePaisa = toPaisa(parseNumeric(currentRow.invite_bonus_locked as string));
  const totalDepositedBefore = toPaisa(parseNumeric(currentRow.total_deposited as string));
  const totalWithdrawnBefore = toPaisa(parseNumeric(currentRow.total_withdrawn as string));

  let afterPaisa = beforePaisa;
  let lockedAfterPaisa = lockedBeforePaisa;

  if (params.direction === 'credit') {
    afterPaisa = beforePaisa + params.amountPaisa;
    if (params.lockAsInviteBonus) {
      lockedAfterPaisa = lockedBeforePaisa + params.amountPaisa;
    }
  } else {
    if (params.requireWithdrawable) {
      const withdrawablePaisa = Math.max(0, beforePaisa - lockedBeforePaisa);
      if (params.amountPaisa > withdrawablePaisa) {
        throw new HttpError(
          400,
          'INSUFFICIENT_WITHDRAWABLE_BALANCE',
          'Insufficient withdrawable balance (locked invite bonus cannot be withdrawn).'
        );
      }
    }
    if (params.amountPaisa > beforePaisa) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Insufficient wallet balance.');
    }
    afterPaisa = beforePaisa - params.amountPaisa;
    if (lockedAfterPaisa > afterPaisa) {
      lockedAfterPaisa = afterPaisa;
    }
  }

  const totalDepositedAfter = params.incrementTotalDeposited
    ? totalDepositedBefore + params.amountPaisa
    : totalDepositedBefore;
  const totalWithdrawnAfter = params.incrementTotalWithdrawn
    ? totalWithdrawnBefore + params.amountPaisa
    : totalWithdrawnBefore;

  const updatedWallet = await client.query(
    `UPDATE wallets
       SET balance = $2,
           invite_bonus_locked = $3,
           total_deposited = $4,
           total_withdrawn = $5,
           version = version + 1,
           updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [
      params.userId,
      fromPaisa(afterPaisa).toFixed(2),
      fromPaisa(lockedAfterPaisa).toFixed(2),
      fromPaisa(totalDepositedAfter).toFixed(2),
      fromPaisa(totalWithdrawnAfter).toFixed(2),
    ]
  );

  const insertedTx = await client.query(
    `INSERT INTO wallet_transactions
       (user_id, type, direction, amount, balance_before, balance_after, reference_type, reference_id, idempotency_key, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      params.userId,
      params.type,
      params.direction,
      fromPaisa(params.amountPaisa).toFixed(2),
      fromPaisa(beforePaisa).toFixed(2),
      fromPaisa(afterPaisa).toFixed(2),
      params.referenceType ?? null,
      params.referenceId ?? null,
      params.idempotencyKey ?? null,
      params.note ?? null,
      params.createdBy,
    ]
  );

  return {
    wallet: mapWalletRow(updatedWallet.rows[0]),
    transaction: mapTxRow(insertedTx.rows[0]),
    alreadyApplied: false,
  };
}

export async function updateUserProfile(
  userId: string,
  input: { displayName?: string; phoneNumber?: string; referralCode?: string }
): Promise<DbUser> {
  return withTransaction(async (client) => {
    const userRes = await client.query(`SELECT * FROM users WHERE firebase_uid = $1 FOR UPDATE`, [
      userId,
    ]);
    if (userRes.rows.length === 0) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    const current = mapUserRow(userRes.rows[0]);

    const nextDisplayName = input.displayName?.trim() || current.displayName;
    const nextPhone =
      input.phoneNumber !== undefined ? normalizePhone(input.phoneNumber) : current.phoneNumber;

    let referredByUid = current.referredByUid;

    if (input.referralCode && !current.referredByUid && !current.firstDepositRewarded) {
      const normalizedRef = input.referralCode.trim().toUpperCase();
      const referrerRes = await client.query(
        `SELECT firebase_uid FROM users WHERE UPPER(referral_code) = $1 LIMIT 1`,
        [normalizedRef]
      );
      if (referrerRes.rows.length > 0) {
        const refUid = String(referrerRes.rows[0].firebase_uid);
        if (refUid !== userId) {
          referredByUid = refUid;
          await client.query(
            `INSERT INTO referrals (referrer_uid, referred_uid, status)
             VALUES ($1, $2, 'pending')
             ON CONFLICT (referred_uid) DO NOTHING`,
            [refUid, userId]
          );
        }
      }
    }

    const updated = await client.query(
      `UPDATE users
         SET display_name = $2,
             phone_number = $3,
             referred_by_uid = $4,
             updated_at = NOW()
       WHERE firebase_uid = $1
       RETURNING *`,
      [userId, nextDisplayName, nextPhone || null, referredByUid]
    );

    return mapUserRow(updated.rows[0]);
  });
}

export async function submitDepositRequest(
  userId: string,
  input: { method: PaymentMethod; senderNumber: string; trxId: string; amount: number }
) {
  const amountPaisa = toPaisa(input.amount);
  const cleanSender = normalizePhone(input.senderNumber);
  const normalizedTrx = normalizeTrxId(input.trxId);

  if (cleanSender.length < 10 || cleanSender.length > 15) {
    throw new HttpError(400, 'INVALID_PHONE', 'Invalid sender mobile number.');
  }

  return withTransaction(async (client) => {
    const settingsRes = await client.query(`SELECT * FROM payment_settings WHERE id = 1`);
    const settings = mapSettingsRow(settingsRes.rows[0]);
    const gateway = settings[input.method];

    if (!gateway.isActive || !gateway.number) {
      throw new HttpError(400, 'GATEWAY_DISABLED', 'Selected payment method is currently unavailable.');
    }

    const minPaisa = toPaisa(settings.minDeposit);
    const maxPaisa = toPaisa(settings.maxDeposit);
    if (amountPaisa < minPaisa || amountPaisa > maxPaisa) {
      throw new HttpError(
        400,
        'AMOUNT_OUT_OF_RANGE',
        `Deposit amount must be between ${settings.minDeposit} and ${settings.maxDeposit}.`
      );
    }

    const pendingCount = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM deposit_requests WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );
    if (Number(pendingCount.rows[0]?.cnt || 0) >= 5) {
      throw new HttpError(
        429,
        'TOO_MANY_PENDING_DEPOSITS',
        'You already have too many pending deposit requests.'
      );
    }

    try {
      const inserted = await client.query(
        `INSERT INTO deposit_requests
           (user_id, method, target_number, sender_number, trx_id, normalized_trx_id, amount, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING *`,
        [
          userId,
          input.method,
          gateway.number,
          cleanSender,
          input.trxId.trim(),
          normalizedTrx,
          fromPaisa(amountPaisa).toFixed(2),
        ]
      );
      return inserted.rows[0];
    } catch (err) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        throw new HttpError(
          409,
          'DUPLICATE_TRX_ID',
          'This Transaction ID (TrxID) has already been submitted.'
        );
      }
      throw err;
    }
  });
}

export async function approveDepositRequest(
  adminUid: string,
  requestId: string,
  adminNote: string | undefined,
  ipAddress: string | null
) {
  return withTransaction(async (client) => {
    const reqLock = await client.query(
      `SELECT * FROM deposit_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    if (reqLock.rows.length === 0) {
      throw new HttpError(404, 'DEPOSIT_NOT_FOUND', 'Deposit request not found.');
    }

    const deposit = reqLock.rows[0];
    if (deposit.status !== 'pending') {
      throw new HttpError(
        409,
        'DEPOSIT_ALREADY_PROCESSED',
        `Deposit request is already ${deposit.status}.`
      );
    }

    const targetUserId = String(deposit.user_id);
    const depositPaisa = toPaisa(parseNumeric(deposit.amount as string));

    const userLock = await client.query(
      `SELECT * FROM users WHERE firebase_uid = $1 FOR UPDATE`,
      [targetUserId]
    );
    if (userLock.rows.length === 0) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'Deposit owner account not found.');
    }
    const targetUser = mapUserRow(userLock.rows[0]);

    const settingsRes = await client.query(`SELECT * FROM payment_settings WHERE id = 1`);
    const settings = mapSettingsRow(settingsRes.rows[0]);

    const isFirstDeposit = !targetUser.firstDepositRewarded;
    const bonusPercent = isFirstDeposit ? settings.firstDepositBonusPercent : 0;
    const bonusPaisa = isFirstDeposit ? Math.round((depositPaisa * bonusPercent) / 100) : 0;
    const totalCreditedPaisa = depositPaisa + bonusPaisa;

    // 1. Credit deposit principal atomically
    await applyLedgerEntryTx(client, {
      userId: targetUserId,
      type: 'deposit',
      direction: 'credit',
      amountPaisa: depositPaisa,
      incrementTotalDeposited: true,
      referenceType: 'deposit_request',
      referenceId: requestId,
      idempotencyKey: `deposit_approve:${requestId}`,
      note: `Approved ${deposit.method} deposit (${deposit.trx_id})`,
      createdBy: adminUid,
    });

    // 2. Credit first-deposit bonus if eligible
    if (bonusPaisa > 0) {
      await applyLedgerEntryTx(client, {
        userId: targetUserId,
        type: 'deposit_bonus',
        direction: 'credit',
        amountPaisa: bonusPaisa,
        referenceType: 'deposit_request',
        referenceId: requestId,
        idempotencyKey: `deposit_first_bonus:${requestId}`,
        note: `First deposit ${bonusPercent}% bonus`,
        createdBy: adminUid,
      });
    }

    if (isFirstDeposit) {
      await client.query(
        `UPDATE users SET first_deposit_rewarded = TRUE, updated_at = NOW() WHERE firebase_uid = $1`,
        [targetUserId]
      );
    }

    // 3. Award 100% locked invite bonus to referrer on invitee's first approved deposit
    let referrerBonusCredited = 0;
    if (isFirstDeposit && targetUser.referredByUid) {
      const refLock = await client.query(
        `SELECT * FROM referrals WHERE referred_uid = $1 AND status = 'pending' FOR UPDATE`,
        [targetUserId]
      );
      if (refLock.rows.length > 0) {
        const refRow = refLock.rows[0];
        const referrerUid = String(refRow.referrer_uid);
        await applyLedgerEntryTx(client, {
          userId: referrerUid,
          type: 'referral_invite_bonus',
          direction: 'credit',
          amountPaisa: depositPaisa,
          lockAsInviteBonus: true,
          referenceType: 'referral',
          referenceId: String(refRow.id),
          idempotencyKey: `referral_first_deposit:${refRow.id}`,
          note: `100% locked invite bonus from ${targetUser.userCode}`,
          createdBy: adminUid,
        });
        await client.query(
          `UPDATE referrals
             SET status = 'rewarded',
                 reward_amount = $2,
                 deposit_request_id = $3,
                 rewarded_at = NOW()
           WHERE id = $1`,
          [refRow.id, fromPaisa(depositPaisa).toFixed(2), requestId]
        );
        referrerBonusCredited = fromPaisa(depositPaisa);
      }
    }

    // 4. Mark deposit approved
    const updatedDeposit = await client.query(
      `UPDATE deposit_requests
         SET status = 'approved',
             is_first_deposit = $2,
             bonus_percent = $3,
             bonus_amount = $4,
             total_credited = $5,
             reviewed_by = $6,
             reviewed_at = NOW(),
             admin_note = $7,
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        requestId,
        isFirstDeposit,
        bonusPercent.toFixed(2),
        fromPaisa(bonusPaisa).toFixed(2),
        fromPaisa(totalCreditedPaisa).toFixed(2),
        adminUid,
        adminNote?.trim() || null,
      ]
    );

    const updatedWalletRes = await client.query(`SELECT * FROM wallets WHERE user_id = $1`, [
      targetUserId,
    ]);

    await recordAuditLog(client, {
      adminUid,
      action: 'APPROVE_DEPOSIT',
      targetUserId,
      entityType: 'deposit_request',
      entityId: requestId,
      details: {
        amount: fromPaisa(depositPaisa),
        bonusAmount: fromPaisa(bonusPaisa),
        totalCredited: fromPaisa(totalCreditedPaisa),
        referrerBonusCredited,
      },
      ipAddress,
    });

    return {
      deposit: updatedDeposit.rows[0],
      wallet: mapWalletRow(updatedWalletRes.rows[0]),
      referrerBonusCredited,
    };
  });
}

export async function rejectDepositRequest(
  adminUid: string,
  requestId: string,
  rejectionReason: string,
  ipAddress: string | null
) {
  return withTransaction(async (client) => {
    const reqLock = await client.query(
      `SELECT * FROM deposit_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    if (reqLock.rows.length === 0) {
      throw new HttpError(404, 'DEPOSIT_NOT_FOUND', 'Deposit request not found.');
    }
    if (reqLock.rows[0].status !== 'pending') {
      throw new HttpError(
        409,
        'DEPOSIT_ALREADY_PROCESSED',
        `Deposit request is already ${reqLock.rows[0].status}.`
      );
    }

    const updated = await client.query(
      `UPDATE deposit_requests
         SET status = 'rejected',
             rejection_reason = $2,
             reviewed_by = $3,
             reviewed_at = NOW(),
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [requestId, rejectionReason.trim(), adminUid]
    );

    await recordAuditLog(client, {
      adminUid,
      action: 'REJECT_DEPOSIT',
      targetUserId: String(reqLock.rows[0].user_id),
      entityType: 'deposit_request',
      entityId: requestId,
      details: { reason: rejectionReason.trim() },
      ipAddress,
    });

    return updated.rows[0];
  });
}

export async function submitWithdrawalRequest(
  userId: string,
  input: { method: PaymentMethod; personalNumber: string; amount: number; idempotencyKey?: string }
) {
  const amountPaisa = toPaisa(input.amount);
  const cleanNumber = normalizePhone(input.personalNumber);

  if (cleanNumber.length < 10 || cleanNumber.length > 15) {
    throw new HttpError(400, 'INVALID_PHONE', 'Invalid personal mobile number.');
  }

  return withTransaction(async (client) => {
    const settingsRes = await client.query(`SELECT * FROM payment_settings WHERE id = 1`);
    const settings = mapSettingsRow(settingsRes.rows[0]);

    const minPaisa = toPaisa(settings.minWithdrawal);
    const maxPaisa = toPaisa(settings.maxWithdrawal);
    if (amountPaisa < minPaisa || amountPaisa > maxPaisa) {
      throw new HttpError(
        400,
        'AMOUNT_OUT_OF_RANGE',
        `Withdrawal amount must be between ${settings.minWithdrawal} and ${settings.maxWithdrawal}.`
      );
    }

    const pendingCount = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM withdrawal_requests WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );
    if (Number(pendingCount.rows[0]?.cnt || 0) >= 3) {
      throw new HttpError(
        429,
        'TOO_MANY_PENDING_WITHDRAWALS',
        'You already have pending withdrawal requests awaiting review.'
      );
    }

    const created = await client.query(
      `INSERT INTO withdrawal_requests
         (user_id, method, personal_number, amount, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [userId, input.method, cleanNumber, fromPaisa(amountPaisa).toFixed(2)]
    );

    const requestId = String(created.rows[0].id);

    // Atomically lock and deduct withdrawable balance (blocks withdrawing locked invite bonus)
    const { wallet } = await applyLedgerEntryTx(client, {
      userId,
      type: 'withdrawal_hold',
      direction: 'debit',
      amountPaisa,
      requireWithdrawable: true,
      referenceType: 'withdrawal_request',
      referenceId: requestId,
      idempotencyKey: input.idempotencyKey
        ? `withdraw_req:${userId}:${input.idempotencyKey}`
        : `withdraw_hold:${requestId}`,
      note: `Withdrawal hold via ${input.method} (${cleanNumber})`,
      createdBy: userId,
    });

    return {
      withdrawal: created.rows[0],
      wallet,
    };
  });
}

export async function completeWithdrawalRequest(
  adminUid: string,
  requestId: string,
  adminNote: string | undefined,
  ipAddress: string | null
) {
  return withTransaction(async (client) => {
    const reqLock = await client.query(
      `SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    if (reqLock.rows.length === 0) {
      throw new HttpError(404, 'WITHDRAWAL_NOT_FOUND', 'Withdrawal request not found.');
    }
    const row = reqLock.rows[0];
    if (row.status !== 'pending') {
      throw new HttpError(
        409,
        'WITHDRAWAL_ALREADY_PROCESSED',
        `Withdrawal request is already ${row.status}.`
      );
    }

    const amountPaisa = toPaisa(parseNumeric(row.amount as string));
    await client.query(
      `UPDATE wallets
         SET total_withdrawn = total_withdrawn + $2,
             updated_at = NOW()
       WHERE user_id = $1`,
      [row.user_id, fromPaisa(amountPaisa).toFixed(2)]
    );

    const updated = await client.query(
      `UPDATE withdrawal_requests
         SET status = 'completed',
             reviewed_by = $2,
             reviewed_at = NOW(),
             admin_note = $3,
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [requestId, adminUid, adminNote?.trim() || null]
    );

    await recordAuditLog(client, {
      adminUid,
      action: 'COMPLETE_WITHDRAWAL',
      targetUserId: String(row.user_id),
      entityType: 'withdrawal_request',
      entityId: requestId,
      details: { amount: fromPaisa(amountPaisa), method: row.method },
      ipAddress,
    });

    return updated.rows[0];
  });
}

export async function rejectWithdrawalRequest(
  adminUid: string,
  requestId: string,
  rejectionReason: string,
  ipAddress: string | null
) {
  return withTransaction(async (client) => {
    const reqLock = await client.query(
      `SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    if (reqLock.rows.length === 0) {
      throw new HttpError(404, 'WITHDRAWAL_NOT_FOUND', 'Withdrawal request not found.');
    }
    const row = reqLock.rows[0];
    if (row.status !== 'pending') {
      throw new HttpError(
        409,
        'WITHDRAWAL_ALREADY_PROCESSED',
        `Withdrawal request is already ${row.status}.`
      );
    }

    const amountPaisa = toPaisa(parseNumeric(row.amount as string));
    const { wallet } = await applyLedgerEntryTx(client, {
      userId: String(row.user_id),
      type: 'withdrawal_refund',
      direction: 'credit',
      amountPaisa,
      referenceType: 'withdrawal_request',
      referenceId: requestId,
      idempotencyKey: `withdraw_refund:${requestId}`,
      note: `Withdrawal rejected refund: ${rejectionReason.trim()}`,
      createdBy: adminUid,
    });

    const updated = await client.query(
      `UPDATE withdrawal_requests
         SET status = 'rejected',
             rejection_reason = $2,
             reviewed_by = $3,
             reviewed_at = NOW(),
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [requestId, rejectionReason.trim(), adminUid]
    );

    await recordAuditLog(client, {
      adminUid,
      action: 'REJECT_WITHDRAWAL',
      targetUserId: String(row.user_id),
      entityType: 'withdrawal_request',
      entityId: requestId,
      details: { refundAmount: fromPaisa(amountPaisa), reason: rejectionReason.trim() },
      ipAddress,
    });

    return { withdrawal: updated.rows[0], wallet };
  });
}

export async function adminAdjustUserBalance(
  adminUid: string,
  targetUserId: string,
  input: { direction: 'credit' | 'debit'; amount: number; reason: string; idempotencyKey?: string },
  ipAddress: string | null
) {
  const amountPaisa = toPaisa(input.amount);
  return withTransaction(async (client) => {
    const result = await applyLedgerEntryTx(client, {
      userId: targetUserId,
      type: input.direction === 'credit' ? 'admin_credit' : 'admin_debit',
      direction: input.direction,
      amountPaisa,
      referenceType: 'admin_adjustment',
      referenceId: adminUid,
      idempotencyKey: input.idempotencyKey
        ? `admin_adj:${adminUid}:${targetUserId}:${input.idempotencyKey}`
        : null,
      note: input.reason.trim(),
      createdBy: adminUid,
    });

    if (!result.alreadyApplied) {
      await recordAuditLog(client, {
        adminUid,
        action: input.direction === 'credit' ? 'ADMIN_CREDIT_BALANCE' : 'ADMIN_DEBIT_BALANCE',
        targetUserId,
        entityType: 'wallet',
        entityId: targetUserId,
        details: {
          amount: fromPaisa(amountPaisa),
          reason: input.reason.trim(),
          balanceBefore: result.transaction.balanceBefore,
          balanceAfter: result.transaction.balanceAfter,
        },
        ipAddress,
      });
    }

    return result;
  });
}
