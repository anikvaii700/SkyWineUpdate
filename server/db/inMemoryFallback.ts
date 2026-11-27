import crypto from 'node:crypto';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

interface UserRow {
  firebase_uid: string;
  user_code: string;
  email: string | null;
  display_name: string;
  phone_number: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended' | 'banned';
  referral_code: string;
  referred_by_uid: string | null;
  first_deposit_rewarded: boolean;
  created_at: Date;
  updated_at: Date;
}

interface WalletRow {
  user_id: string;
  balance: string;
  invite_bonus_locked: string;
  total_deposited: string;
  total_withdrawn: string;
  version: number;
  updated_at: Date;
}

interface WalletTxRow {
  id: string;
  user_id: string;
  type: string;
  direction: 'credit' | 'debit';
  amount: string;
  balance_before: string;
  balance_after: string;
  reference_type: string | null;
  reference_id: string | null;
  idempotency_key: string | null;
  note: string | null;
  created_by: string;
  created_at: Date;
}

interface DepositRow {
  id: string;
  user_id: string;
  method: 'bkash' | 'nagad' | 'rocket';
  target_number: string;
  sender_number: string;
  trx_id: string;
  normalized_trx_id: string;
  amount: string;
  status: 'pending' | 'approved' | 'rejected';
  is_first_deposit: boolean;
  bonus_percent: string;
  bonus_amount: string;
  total_credited: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  admin_note: string | null;
  created_at: Date;
  updated_at: Date;
}

interface WithdrawalRow {
  id: string;
  user_id: string;
  method: 'bkash' | 'nagad' | 'rocket';
  personal_number: string;
  amount: string;
  status: 'pending' | 'completed' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  admin_note: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ReferralRow {
  id: string;
  referrer_uid: string;
  referred_uid: string;
  status: 'pending' | 'rewarded';
  reward_amount: string;
  deposit_request_id: string | null;
  created_at: Date;
  rewarded_at: Date | null;
}

interface PaymentSettingsRow {
  id: number;
  bkash_number: string;
  bkash_type: 'Personal' | 'Agent' | 'Merchant';
  bkash_instructions: string;
  bkash_active: boolean;
  nagad_number: string;
  nagad_type: 'Personal' | 'Agent' | 'Merchant';
  nagad_instructions: string;
  nagad_active: boolean;
  rocket_number: string;
  rocket_type: 'Personal' | 'Agent' | 'Merchant';
  rocket_instructions: string;
  rocket_active: boolean;
  min_deposit: string;
  max_deposit: string;
  min_withdrawal: string;
  max_withdrawal: string;
  first_deposit_bonus_percent: string;
  notice_text: string;
  withdrawal_notice_text: string;
  marquee_notice: string;
  telegram_channel: string;
  telegram_support: string;
  updated_by: string | null;
  updated_at: Date;
}

interface AuditLogRow {
  id: number;
  admin_uid: string;
  action: string;
  target_user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: Date;
}

interface EmailOtpRow {
  email: string;
  code_hash: string;
  salt: string;
  expires_at: Date;
  attempts: number;
  sent_at: Date;
  consumed_at: Date | null;
}

interface PhoneAccountRow {
  phone_number: string;
  user_uid: string;
  password_hash: string;
  password_salt: string;
  phone_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

interface StoreState {
  users: Map<string, UserRow>;
  wallets: Map<string, WalletRow>;
  walletTransactions: WalletTxRow[];
  depositRequests: Map<string, DepositRow>;
  withdrawalRequests: Map<string, WithdrawalRow>;
  referrals: Map<string, ReferralRow>;
  paymentSettings: PaymentSettingsRow | null;
  auditLogs: AuditLogRow[];
  auditLogSeq: number;
  emailOtps: Map<string, EmailOtpRow>;
  phoneAccounts: Map<string, PhoneAccountRow>;
}

function createDefaultPaymentSettings(): PaymentSettingsRow {
  return {
    id: 1,
    bkash_number: '',
    bkash_type: 'Personal',
    bkash_instructions: 'বিকাশ অ্যাপ থেকে "Send Money" করুন।',
    bkash_active: true,
    nagad_number: '',
    nagad_type: 'Personal',
    nagad_instructions: 'নগদ অ্যাপ থেকে "Send Money" করুন।',
    nagad_active: true,
    rocket_number: '',
    rocket_type: 'Personal',
    rocket_instructions: 'রকেট অ্যাপ থেকে "Send Money" করুন।',
    rocket_active: true,
    min_deposit: '100.00',
    max_deposit: '25000.00',
    min_withdrawal: '200.00',
    max_withdrawal: '25000.00',
    first_deposit_bonus_percent: '50.00',
    notice_text:
      'টাকা পাঠানোর পর ট্রানজেকশন আইডি (TrxID) দিয়ে সাবমিট করুন। অ্যাডমিন নিশ্চিত করে ১-৩ মিনিটের মধ্যে ব্যালেন্স অ্যাড করে দিবে।',
    withdrawal_notice_text:
      'উত্তোলন দেওয়ার পর এডমিন ভেরিফাই করে ৫-১৫ মিনিটের মধ্যে টাকা পাঠিয়ে দিবে। শুধুমাত্র পার্সোনাল বিকাশ/নগদ/রকেট নম্বর ব্যবহার করুন।',
    marquee_notice: 'স্বাগতম SkyWin BD অফিসিয়াল মোবাইল অ্যাপে!',
    telegram_channel: '',
    telegram_support: '',
    updated_by: null,
    updated_at: new Date(),
  };
}

function cloneStore(src: StoreState): StoreState {
  return {
    users: new Map(Array.from(src.users.entries()).map(([k, v]) => [k, { ...v }])),
    wallets: new Map(Array.from(src.wallets.entries()).map(([k, v]) => [k, { ...v }])),
    walletTransactions: src.walletTransactions.map((t) => ({ ...t })),
    depositRequests: new Map(Array.from(src.depositRequests.entries()).map(([k, v]) => [k, { ...v }])),
    withdrawalRequests: new Map(
      Array.from(src.withdrawalRequests.entries()).map(([k, v]) => [k, { ...v }])
    ),
    referrals: new Map(Array.from(src.referrals.entries()).map(([k, v]) => [k, { ...v }])),
    paymentSettings: src.paymentSettings ? { ...src.paymentSettings } : null,
    auditLogs: src.auditLogs.map((l) => ({ ...l })),
    auditLogSeq: src.auditLogSeq,
    emailOtps: new Map(Array.from(src.emailOtps.entries()).map(([k, v]) => [k, { ...v }])),
    phoneAccounts: new Map(Array.from(src.phoneAccounts.entries()).map(([k, v]) => [k, { ...v }])),
  };
}

let activeStore: StoreState = {
  users: new Map(),
  wallets: new Map(),
  walletTransactions: [],
  depositRequests: new Map(),
  withdrawalRequests: new Map(),
  referrals: new Map(),
  paymentSettings: createDefaultPaymentSettings(),
  auditLogs: [],
  auditLogSeq: 1,
  emailOtps: new Map(),
  phoneAccounts: new Map(),
};

function makeResult<T extends QueryResultRow>(rows: unknown[]): QueryResult<T> {
  return {
    rows: rows as T[],
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  };
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function toFixedMoney(val: number): string {
  return val.toFixed(2);
}

function executeInMemoryQuery<T extends QueryResultRow = QueryResultRow>(
  store: StoreState,
  rawSql: string,
  params: readonly unknown[] = []
): QueryResult<T> {
  const sql = normalizeSql(rawSql);
  const upper = sql.toUpperCase();

  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') {
    return makeResult<T>([]);
  }

  if (upper === 'SELECT 1') {
    return makeResult<T>([{ '?column?': 1 }]);
  }

  // payment_settings
  if (sql.includes('FROM payment_settings WHERE id = 1')) {
    return makeResult<T>(store.paymentSettings ? [{ ...store.paymentSettings }] : []);
  }

  if (sql.startsWith('INSERT INTO payment_settings (id) VALUES (1)')) {
    if (!store.paymentSettings) {
      store.paymentSettings = createDefaultPaymentSettings();
    }
    return makeResult<T>(sql.includes('RETURNING') ? [{ ...store.paymentSettings }] : []);
  }

  if (sql.startsWith('INSERT INTO payment_settings (')) {
    const now = new Date();
    store.paymentSettings = {
      id: 1,
      bkash_number: String(params[0] ?? ''),
      bkash_type: (params[1] as PaymentSettingsRow['bkash_type']) || 'Personal',
      bkash_instructions: String(params[2] ?? ''),
      bkash_active: Boolean(params[3]),
      nagad_number: String(params[4] ?? ''),
      nagad_type: (params[5] as PaymentSettingsRow['nagad_type']) || 'Personal',
      nagad_instructions: String(params[6] ?? ''),
      nagad_active: Boolean(params[7]),
      rocket_number: String(params[8] ?? ''),
      rocket_type: (params[9] as PaymentSettingsRow['rocket_type']) || 'Personal',
      rocket_instructions: String(params[10] ?? ''),
      rocket_active: Boolean(params[11]),
      min_deposit: String(params[12] ?? '100.00'),
      max_deposit: String(params[13] ?? '25000.00'),
      min_withdrawal: String(params[14] ?? '200.00'),
      max_withdrawal: String(params[15] ?? '25000.00'),
      first_deposit_bonus_percent: String(params[16] ?? '50.00'),
      notice_text: String(params[17] ?? ''),
      withdrawal_notice_text: String(params[18] ?? ''),
      marquee_notice: String(params[19] ?? ''),
      telegram_channel: String(params[20] ?? ''),
      telegram_support: String(params[21] ?? ''),
      updated_by: params[22] ? String(params[22]) : null,
      updated_at: now,
    };
    return makeResult<T>([]);
  }

  // users
  if (sql.startsWith('SELECT * FROM users WHERE firebase_uid = $1')) {
    const u = store.users.get(String(params[0]));
    return makeResult<T>(u ? [{ ...u }] : []);
  }

  if (sql.startsWith('SELECT firebase_uid, user_code, email, display_name, phone_number, role, status, referral_code, referred_by_uid, first_deposit_rewarded, created_at, updated_at FROM users WHERE firebase_uid = $1')) {
    const u = store.users.get(String(params[0]));
    return makeResult<T>(u ? [{ ...u }] : []);
  }

  if (sql.startsWith("SELECT firebase_uid FROM users WHERE role = 'admin' LIMIT 1")) {
    const admin = Array.from(store.users.values()).find((u) => u.role === 'admin');
    return makeResult<T>(admin ? [{ firebase_uid: admin.firebase_uid }] : []);
  }

  if (sql.startsWith('SELECT firebase_uid FROM users WHERE UPPER(referral_code) = $1')) {
    const code = String(params[0] ?? '').toUpperCase();
    const match = Array.from(store.users.values()).find(
      (u) => u.referral_code.toUpperCase() === code
    );
    return makeResult<T>(match ? [{ firebase_uid: match.firebase_uid }] : []);
  }

  if (sql.startsWith('SELECT 1 FROM users WHERE firebase_uid = $1 OR phone_number = $2')) {
    const uid = String(params[0]);
    const phone = String(params[1]);
    const match = Array.from(store.users.values()).find(
      (u) => u.firebase_uid === uid || u.phone_number === phone
    );
    return makeResult<T>(match ? [{ '?column?': 1 }] : []);
  }

  if (sql.startsWith('SELECT 1 FROM users WHERE user_code = $1 OR referral_code = $1')) {
    const code = String(params[0]);
    const match = Array.from(store.users.values()).find(
      (u) => u.user_code === code || u.referral_code === code
    );
    return makeResult<T>(match ? [{ '?column?': 1 }] : []);
  }

  if (sql.startsWith('INSERT INTO users (')) {
    const uid = String(params[0]);
    const userCode = String(params[1]);
    const email = params[2] ? String(params[2]) : null;
    const displayName = String(params[3] || 'Player');
    const phoneNumber = params[4] ? String(params[4]) : null;
    const role = (params[5] === 'admin' ? 'admin' : 'user') as 'user' | 'admin';
    const referralCode = String(params[6]);
    const referredByUid = params[7] ? String(params[7]) : null;

    if (store.users.has(uid)) {
      const err = new Error('Duplicate user uid') as Error & { code?: string };
      err.code = '23505';
      throw err;
    }

    for (const existing of store.users.values()) {
      if (existing.user_code === userCode || existing.referral_code === referralCode) {
        const err = new Error('Duplicate key') as Error & { code?: string };
        err.code = '23505';
        throw err;
      }
    }

    const now = new Date();
    const row: UserRow = {
      firebase_uid: uid,
      user_code: userCode,
      email,
      display_name: displayName,
      phone_number: phoneNumber,
      role,
      status: 'active',
      referral_code: referralCode,
      referred_by_uid: referredByUid,
      first_deposit_rewarded: false,
      created_at: now,
      updated_at: now,
    };
    store.users.set(uid, row);
    return makeResult<T>([{ ...row }]);
  }

  if (sql.startsWith('UPDATE users SET role = $2, email = $3, display_name = $4, phone_number = $5')) {
    const u = store.users.get(String(params[0]));
    if (!u) return makeResult<T>([]);
    u.role = params[1] === 'admin' ? 'admin' : 'user';
    u.email = params[2] ? String(params[2]) : null;
    u.display_name = String(params[3] || 'Player');
    u.phone_number = params[4] ? String(params[4]) : null;
    u.updated_at = new Date();
    return makeResult<T>([{ ...u }]);
  }

  if (sql.startsWith('UPDATE users SET display_name = $2, phone_number = $3, referred_by_uid = $4')) {
    const u = store.users.get(String(params[0]));
    if (!u) return makeResult<T>([]);
    u.display_name = String(params[1] || 'Player');
    u.phone_number = params[2] ? String(params[2]) : null;
    u.referred_by_uid = params[3] ? String(params[3]) : null;
    u.updated_at = new Date();
    return makeResult<T>([{ ...u }]);
  }

  if (sql.startsWith('UPDATE users SET first_deposit_rewarded = TRUE')) {
    const u = store.users.get(String(params[0]));
    if (u) {
      u.first_deposit_rewarded = true;
      u.updated_at = new Date();
    }
    return makeResult<T>([]);
  }

  if (sql.startsWith('UPDATE users SET status = $2')) {
    const u = store.users.get(String(params[0]));
    if (!u) return makeResult<T>([]);
    u.status = params[1] as UserRow['status'];
    u.updated_at = new Date();
    return makeResult<T>([{ firebase_uid: u.firebase_uid, user_code: u.user_code, status: u.status }]);
  }

  if (sql.startsWith('UPDATE users SET role = $2, updated_at = NOW()')) {
    const u = store.users.get(String(params[0]));
    if (!u) return makeResult<T>([]);
    u.role = params[1] as UserRow['role'];
    u.updated_at = new Date();
    return makeResult<T>([{ firebase_uid: u.firebase_uid, user_code: u.user_code, role: u.role }]);
  }

  if (sql.startsWith('SELECT COUNT(*)::int AS total_users FROM users')) {
    return makeResult<T>([{ total_users: store.users.size }]);
  }

  if (sql.includes('FROM users u JOIN wallets w ON w.user_id = u.firebase_uid')) {
    const pattern = params[0] ? String(params[0]).replace(/^%|%$/g, '').toLowerCase() : null;
    const limit = Number(params[1] ?? 50);
    const offset = Number(params[2] ?? 0);
    const rows = Array.from(store.users.values())
      .filter((u) => {
        if (!pattern) return true;
        return (
          u.user_code.toLowerCase().includes(pattern) ||
          (u.email && u.email.toLowerCase().includes(pattern)) ||
          (u.phone_number && u.phone_number.toLowerCase().includes(pattern)) ||
          u.display_name.toLowerCase().includes(pattern)
        );
      })
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(offset, offset + limit)
      .map((u) => {
        const w = store.wallets.get(u.firebase_uid);
        return {
          ...u,
          balance: w?.balance ?? '0.00',
          invite_bonus_locked: w?.invite_bonus_locked ?? '0.00',
          total_deposited: w?.total_deposited ?? '0.00',
          total_withdrawn: w?.total_withdrawn ?? '0.00',
        };
      });
    return makeResult<T>(rows);
  }

  // wallets
  if (sql.startsWith('INSERT INTO wallets (user_id) VALUES ($1)')) {
    const uid = String(params[0]);
    if (!store.wallets.has(uid)) {
      store.wallets.set(uid, {
        user_id: uid,
        balance: '0.00',
        invite_bonus_locked: '0.00',
        total_deposited: '0.00',
        total_withdrawn: '0.00',
        version: 1,
        updated_at: new Date(),
      });
    }
    const w = store.wallets.get(uid)!;
    return makeResult<T>(sql.includes('RETURNING') ? [{ ...w }] : []);
  }

  if (sql.startsWith('SELECT * FROM wallets WHERE user_id = $1')) {
    const w = store.wallets.get(String(params[0]));
    return makeResult<T>(w ? [{ ...w }] : []);
  }

  if (sql.startsWith('UPDATE wallets SET balance = $2, invite_bonus_locked = $3')) {
    const w = store.wallets.get(String(params[0]));
    if (!w) return makeResult<T>([]);
    w.balance = String(params[1]);
    w.invite_bonus_locked = String(params[2]);
    w.total_deposited = String(params[3]);
    w.total_withdrawn = String(params[4]);
    w.version += 1;
    w.updated_at = new Date();
    return makeResult<T>([{ ...w }]);
  }

  if (sql.startsWith('UPDATE wallets SET total_withdrawn = total_withdrawn + $2')) {
    const w = store.wallets.get(String(params[0]));
    if (w) {
      const next = Number.parseFloat(w.total_withdrawn) + Number.parseFloat(String(params[1]));
      w.total_withdrawn = toFixedMoney(next);
      w.updated_at = new Date();
    }
    return makeResult<T>([]);
  }

  if (sql.includes('FROM wallets') && sql.includes('total_wallet_liability')) {
    let totalDeposited = 0;
    let totalWithdrawn = 0;
    let totalBalance = 0;
    for (const w of store.wallets.values()) {
      totalDeposited += Number.parseFloat(w.total_deposited);
      totalWithdrawn += Number.parseFloat(w.total_withdrawn);
      totalBalance += Number.parseFloat(w.balance);
    }
    return makeResult<T>([
      {
        total_deposited: toFixedMoney(totalDeposited),
        total_withdrawn: toFixedMoney(totalWithdrawn),
        total_wallet_liability: toFixedMoney(totalBalance),
      },
    ]);
  }

  // wallet_transactions
  if (sql.startsWith('SELECT * FROM wallet_transactions WHERE idempotency_key = $1')) {
    const key = String(params[0]);
    const match = store.walletTransactions.find((t) => t.idempotency_key === key);
    return makeResult<T>(match ? [{ ...match }] : []);
  }

  if (sql.startsWith('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3')) {
    const uid = String(params[0]);
    const limit = Number(params[1] ?? 30);
    const offset = Number(params[2] ?? 0);
    const rows = store.walletTransactions
      .filter((t) => t.user_id === uid)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(offset, offset + limit)
      .map((t) => ({ ...t }));
    return makeResult<T>(rows);
  }

  if (sql.startsWith('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50')) {
    const uid = String(params[0]);
    const rows = store.walletTransactions
      .filter((t) => t.user_id === uid)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, 50)
      .map((t) => ({ ...t }));
    return makeResult<T>(rows);
  }

  if (sql.startsWith('INSERT INTO wallet_transactions (')) {
    const idempotencyKey = params[8] ? String(params[8]) : null;
    if (
      idempotencyKey &&
      store.walletTransactions.some((t) => t.idempotency_key === idempotencyKey)
    ) {
      const err = new Error('Duplicate idempotency_key') as Error & { code?: string };
      err.code = '23505';
      throw err;
    }
    const row: WalletTxRow = {
      id: crypto.randomUUID(),
      user_id: String(params[0]),
      type: String(params[1]),
      direction: params[2] === 'debit' ? 'debit' : 'credit',
      amount: String(params[3]),
      balance_before: String(params[4]),
      balance_after: String(params[5]),
      reference_type: params[6] ? String(params[6]) : null,
      reference_id: params[7] ? String(params[7]) : null,
      idempotency_key: idempotencyKey,
      note: params[9] ? String(params[9]) : null,
      created_by: String(params[10]),
      created_at: new Date(),
    };
    store.walletTransactions.push(row);
    return makeResult<T>([{ ...row }]);
  }

  // deposit_requests
  if (sql.startsWith("SELECT COUNT(*)::int AS cnt FROM deposit_requests WHERE status = 'pending'")) {
    const cnt = Array.from(store.depositRequests.values()).filter((d) => d.status === 'pending').length;
    return makeResult<T>([{ cnt }]);
  }

  if (sql.startsWith("SELECT COUNT(*)::int AS cnt FROM deposit_requests WHERE user_id = $1 AND status = 'pending'")) {
    const uid = String(params[0]);
    const cnt = Array.from(store.depositRequests.values()).filter(
      (d) => d.user_id === uid && d.status === 'pending'
    ).length;
    return makeResult<T>([{ cnt }]);
  }

  if (sql.startsWith('SELECT * FROM deposit_requests WHERE id = $1')) {
    const row = store.depositRequests.get(String(params[0]));
    return makeResult<T>(row ? [{ ...row }] : []);
  }

  if (sql.includes('FROM deposit_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3')) {
    const uid = String(params[0]);
    const limit = Number(params[1] ?? 30);
    const offset = Number(params[2] ?? 0);
    const rows = Array.from(store.depositRequests.values())
      .filter((d) => d.user_id === uid)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(offset, offset + limit)
      .map((d) => ({ ...d }));
    return makeResult<T>(rows);
  }

  if (sql.startsWith('SELECT * FROM deposit_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30')) {
    const uid = String(params[0]);
    const rows = Array.from(store.depositRequests.values())
      .filter((d) => d.user_id === uid)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, 30)
      .map((d) => ({ ...d }));
    return makeResult<T>(rows);
  }

  if (sql.includes('FROM deposit_requests d JOIN users u ON u.firebase_uid = d.user_id')) {
    const filterStatus = params[0] ? String(params[0]) : null;
    const limit = Number(params[1] ?? 50);
    const offset = Number(params[2] ?? 0);
    const rows = Array.from(store.depositRequests.values())
      .filter((d) => !filterStatus || d.status === filterStatus)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(offset, offset + limit)
      .map((d) => {
        const u = store.users.get(d.user_id);
        return {
          ...d,
          user_code: u?.user_code ?? '',
          display_name: u?.display_name ?? 'Player',
          email: u?.email ?? null,
          phone_number: u?.phone_number ?? null,
        };
      });
    return makeResult<T>(rows);
  }

  if (sql.startsWith('INSERT INTO deposit_requests (')) {
    const normalizedTrx = String(params[5]);
    const duplicate = Array.from(store.depositRequests.values()).some(
      (d) => d.normalized_trx_id === normalizedTrx && d.status !== 'rejected'
    );
    if (duplicate) {
      const err = new Error('Duplicate TrxID') as Error & { code?: string };
      err.code = '23505';
      throw err;
    }
    const now = new Date();
    const row: DepositRow = {
      id: crypto.randomUUID(),
      user_id: String(params[0]),
      method: params[1] as DepositRow['method'],
      target_number: String(params[2]),
      sender_number: String(params[3]),
      trx_id: String(params[4]),
      normalized_trx_id: normalizedTrx,
      amount: String(params[6]),
      status: 'pending',
      is_first_deposit: false,
      bonus_percent: '0.00',
      bonus_amount: '0.00',
      total_credited: '0.00',
      reviewed_by: null,
      reviewed_at: null,
      rejection_reason: null,
      admin_note: null,
      created_at: now,
      updated_at: now,
    };
    store.depositRequests.set(row.id, row);
    return makeResult<T>([{ ...row }]);
  }

  if (sql.startsWith("UPDATE deposit_requests SET status = 'approved'")) {
    const row = store.depositRequests.get(String(params[0]));
    if (!row) return makeResult<T>([]);
    const now = new Date();
    row.status = 'approved';
    row.is_first_deposit = Boolean(params[1]);
    row.bonus_percent = String(params[2]);
    row.bonus_amount = String(params[3]);
    row.total_credited = String(params[4]);
    row.reviewed_by = String(params[5]);
    row.reviewed_at = now;
    row.admin_note = params[6] ? String(params[6]) : null;
    row.updated_at = now;
    return makeResult<T>([{ ...row }]);
  }

  if (sql.startsWith("UPDATE deposit_requests SET status = 'rejected'")) {
    const row = store.depositRequests.get(String(params[0]));
    if (!row) return makeResult<T>([]);
    const now = new Date();
    row.status = 'rejected';
    row.rejection_reason = String(params[1]);
    row.reviewed_by = String(params[2]);
    row.reviewed_at = now;
    row.updated_at = now;
    return makeResult<T>([{ ...row }]);
  }

  // withdrawal_requests
  if (sql.startsWith("SELECT COUNT(*)::int AS cnt FROM withdrawal_requests WHERE status = 'pending'")) {
    const cnt = Array.from(store.withdrawalRequests.values()).filter(
      (w) => w.status === 'pending'
    ).length;
    return makeResult<T>([{ cnt }]);
  }

  if (sql.startsWith("SELECT COUNT(*)::int AS cnt FROM withdrawal_requests WHERE user_id = $1 AND status = 'pending'")) {
    const uid = String(params[0]);
    const cnt = Array.from(store.withdrawalRequests.values()).filter(
      (w) => w.user_id === uid && w.status === 'pending'
    ).length;
    return makeResult<T>([{ cnt }]);
  }

  if (sql.startsWith('SELECT * FROM withdrawal_requests WHERE id = $1')) {
    const row = store.withdrawalRequests.get(String(params[0]));
    return makeResult<T>(row ? [{ ...row }] : []);
  }

  if (sql.includes('FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3')) {
    const uid = String(params[0]);
    const limit = Number(params[1] ?? 30);
    const offset = Number(params[2] ?? 0);
    const rows = Array.from(store.withdrawalRequests.values())
      .filter((w) => w.user_id === uid)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(offset, offset + limit)
      .map((w) => ({ ...w }));
    return makeResult<T>(rows);
  }

  if (sql.startsWith('SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30')) {
    const uid = String(params[0]);
    const rows = Array.from(store.withdrawalRequests.values())
      .filter((w) => w.user_id === uid)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, 30)
      .map((w) => ({ ...w }));
    return makeResult<T>(rows);
  }

  if (sql.includes('FROM withdrawal_requests w JOIN users u ON u.firebase_uid = w.user_id')) {
    const filterStatus = params[0] ? String(params[0]) : null;
    const limit = Number(params[1] ?? 50);
    const offset = Number(params[2] ?? 0);
    const rows = Array.from(store.withdrawalRequests.values())
      .filter((w) => !filterStatus || w.status === filterStatus)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(offset, offset + limit)
      .map((w) => {
        const u = store.users.get(w.user_id);
        return {
          ...w,
          user_code: u?.user_code ?? '',
          display_name: u?.display_name ?? 'Player',
          email: u?.email ?? null,
          phone_number: u?.phone_number ?? null,
        };
      });
    return makeResult<T>(rows);
  }

  if (sql.startsWith('INSERT INTO withdrawal_requests (')) {
    const now = new Date();
    const row: WithdrawalRow = {
      id: crypto.randomUUID(),
      user_id: String(params[0]),
      method: params[1] as WithdrawalRow['method'],
      personal_number: String(params[2]),
      amount: String(params[3]),
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      rejection_reason: null,
      admin_note: null,
      created_at: now,
      updated_at: now,
    };
    store.withdrawalRequests.set(row.id, row);
    return makeResult<T>([{ ...row }]);
  }

  if (sql.startsWith("UPDATE withdrawal_requests SET status = 'completed'")) {
    const row = store.withdrawalRequests.get(String(params[0]));
    if (!row) return makeResult<T>([]);
    const now = new Date();
    row.status = 'completed';
    row.reviewed_by = String(params[1]);
    row.reviewed_at = now;
    row.admin_note = params[2] ? String(params[2]) : null;
    row.updated_at = now;
    return makeResult<T>([{ ...row }]);
  }

  if (sql.startsWith("UPDATE withdrawal_requests SET status = 'rejected'")) {
    const row = store.withdrawalRequests.get(String(params[0]));
    if (!row) return makeResult<T>([]);
    const now = new Date();
    row.status = 'rejected';
    row.rejection_reason = String(params[1]);
    row.reviewed_by = String(params[2]);
    row.reviewed_at = now;
    row.updated_at = now;
    return makeResult<T>([{ ...row }]);
  }

  // referrals
  if (sql.startsWith('INSERT INTO referrals (')) {
    const referrerUid = String(params[0]);
    const referredUid = String(params[1]);
    if (!store.referrals.has(referredUid)) {
      store.referrals.set(referredUid, {
        id: crypto.randomUUID(),
        referrer_uid: referrerUid,
        referred_uid: referredUid,
        status: 'pending',
        reward_amount: '0.00',
        deposit_request_id: null,
        created_at: new Date(),
        rewarded_at: null,
      });
    }
    return makeResult<T>([]);
  }

  if (sql.startsWith("SELECT * FROM referrals WHERE referred_uid = $1 AND status = 'pending'")) {
    const row = store.referrals.get(String(params[0]));
    return makeResult<T>(row && row.status === 'pending' ? [{ ...row }] : []);
  }

  if (sql.startsWith("UPDATE referrals SET status = 'rewarded'")) {
    const id = String(params[0]);
    for (const r of store.referrals.values()) {
      if (r.id === id) {
        r.status = 'rewarded';
        r.reward_amount = String(params[1]);
        r.deposit_request_id = params[2] ? String(params[2]) : null;
        r.rewarded_at = new Date();
        break;
      }
    }
    return makeResult<T>([]);
  }

  if (sql.includes('FROM referrals r JOIN users u ON u.firebase_uid = r.referred_uid')) {
    const referrerUid = String(params[0]);
    const rows = Array.from(store.referrals.values())
      .filter((r) => r.referrer_uid === referrerUid)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, 100)
      .map((r) => {
        const u = store.users.get(r.referred_uid);
        const firstDep = Array.from(store.depositRequests.values())
          .filter((d) => d.user_id === r.referred_uid && d.status === 'approved' && d.is_first_deposit)
          .sort(
            (a, b) =>
              (a.reviewed_at?.getTime() ?? a.created_at.getTime()) -
              (b.reviewed_at?.getTime() ?? b.created_at.getTime())
          )[0];
        return {
          id: r.id,
          status: r.status,
          reward_amount: r.reward_amount,
          created_at: r.created_at,
          rewarded_at: r.rewarded_at,
          referred_uid: r.referred_uid,
          referred_user_code: u?.user_code ?? '',
          referred_name: u?.display_name ?? 'Player',
          referred_phone: u?.phone_number ?? null,
          first_deposit_amount: firstDep ? firstDep.amount : '0',
        };
      });
    return makeResult<T>(rows);
  }

  // admin_audit_logs
  if (sql.startsWith('INSERT INTO admin_audit_logs')) {
    store.auditLogs.push({
      id: store.auditLogSeq++,
      admin_uid: String(params[0]),
      action: String(params[1]),
      target_user_id: params[2] ? String(params[2]) : null,
      entity_type: String(params[3]),
      entity_id: params[4] ? String(params[4]) : null,
      details: params[5] ? (JSON.parse(String(params[5])) as Record<string, unknown>) : {},
      ip_address: params[6] ? String(params[6]) : null,
      created_at: new Date(),
    });
    return makeResult<T>([]);
  }

  if (sql.startsWith('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2')) {
    const limit = Number(params[0] ?? 50);
    const offset = Number(params[1] ?? 0);
    const rows = [...store.auditLogs]
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(offset, offset + limit)
      .map((l) => ({ ...l }));
    return makeResult<T>(rows);
  }

  // email_verification_otps
  if (sql.startsWith('SELECT sent_at FROM email_verification_otps WHERE email = $1')) {
    const row = store.emailOtps.get(String(params[0]));
    return makeResult<T>(row ? [{ sent_at: row.sent_at }] : []);
  }

  if (sql.startsWith('SELECT code_hash, salt, expires_at, attempts, consumed_at FROM email_verification_otps WHERE email = $1')) {
    const row = store.emailOtps.get(String(params[0]));
    return makeResult<T>(row ? [{ ...row }] : []);
  }

  if (sql.startsWith('INSERT INTO email_verification_otps')) {
    const email = String(params[0]);
    const now = new Date();
    store.emailOtps.set(email, {
      email,
      code_hash: String(params[1]),
      salt: String(params[2]),
      expires_at: new Date(now.getTime() + 10 * 60 * 1000),
      attempts: 0,
      sent_at: now,
      consumed_at: null,
    });
    return makeResult<T>([]);
  }

  if (sql.startsWith('UPDATE email_verification_otps SET attempts = attempts + 1 WHERE email = $1')) {
    const row = store.emailOtps.get(String(params[0]));
    if (row) row.attempts += 1;
    return makeResult<T>([]);
  }

  if (sql.startsWith('UPDATE email_verification_otps SET consumed_at = NOW() WHERE email = $1')) {
    const row = store.emailOtps.get(String(params[0]));
    if (row) row.consumed_at = new Date();
    return makeResult<T>([]);
  }

  if (sql.startsWith('DELETE FROM email_verification_otps WHERE email = $1')) {
    store.emailOtps.delete(String(params[0]));
    return makeResult<T>([]);
  }

  // phone_accounts
  if (sql.startsWith('SELECT * FROM phone_accounts WHERE phone_number = $1')) {
    const row = store.phoneAccounts.get(String(params[0]));
    return makeResult<T>(row ? [{ ...row }] : []);
  }

  if (sql.startsWith('INSERT INTO phone_accounts (')) {
    const phoneNumber = String(params[0]);
    const userUid = String(params[1]);
    if (store.phoneAccounts.has(phoneNumber)) {
      const err = new Error('Duplicate phone_number') as Error & { code?: string };
      err.code = '23505';
      throw err;
    }
    const now = new Date();
    const row: PhoneAccountRow = {
      phone_number: phoneNumber,
      user_uid: userUid,
      password_hash: String(params[2]),
      password_salt: String(params[3]),
      phone_verified: Boolean(params[4] ?? false),
      created_at: now,
      updated_at: now,
    };
    store.phoneAccounts.set(phoneNumber, row);
    return makeResult<T>([{ ...row }]);
  }

  console.warn('[InMemoryDB] Unhandled SQL query:', sql);
  return makeResult<T>([]);
}

export async function runInMemoryQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = []
): Promise<QueryResult<T>> {
  return executeInMemoryQuery<T>(activeStore, text, params);
}

let txQueue: Promise<unknown> = Promise.resolve();

export async function runInMemoryTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const run = async (): Promise<T> => {
    const txStore = cloneStore(activeStore);
    const mockClient = {
      query: async <R extends QueryResultRow = QueryResultRow>(
        text: string,
        params: readonly unknown[] = []
      ) => executeInMemoryQuery<R>(txStore, text, params),
      release: () => {},
    } as unknown as PoolClient;

    const result = await callback(mockClient);
    activeStore = txStore;
    return result;
  };

  const next = txQueue.then(run, run);
  txQueue = next.catch(() => {});
  return next;
}
