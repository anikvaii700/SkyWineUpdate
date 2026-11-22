-- SkyWinBD PostgreSQL Wallet & Admin Ledger Schema (Neon PostgreSQL compatible)
-- Uses PostgreSQL built-in gen_random_uuid() (PostgreSQL 13+, no extensions required).

CREATE TABLE IF NOT EXISTS users (
  firebase_uid TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL DEFAULT 'Player',
  phone_number TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  referral_code TEXT NOT NULL UNIQUE,
  referred_by_uid TEXT REFERENCES users(firebase_uid) ON DELETE SET NULL,
  first_deposit_rewarded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(firebase_uid) ON DELETE CASCADE,
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  invite_bonus_locked NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (invite_bonus_locked >= 0),
  total_deposited NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (total_deposited >= 0),
  total_withdrawn NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (total_withdrawn >= 0),
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(firebase_uid) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN (
      'deposit',
      'deposit_bonus',
      'referral_invite_bonus',
      'withdrawal_hold',
      'withdrawal_refund',
      'admin_credit',
      'admin_debit'
    )
  ),
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  balance_before NUMERIC(14, 2) NOT NULL CHECK (balance_before >= 0),
  balance_after NUMERIC(14, 2) NOT NULL CHECK (balance_after >= 0),
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT UNIQUE,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_created ON wallet_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference ON wallet_transactions (reference_type, reference_id);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(firebase_uid) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('bkash', 'nagad', 'rocket')),
  target_number TEXT NOT NULL,
  sender_number TEXT NOT NULL,
  trx_id TEXT NOT NULL,
  normalized_trx_id TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_first_deposit BOOLEAN NOT NULL DEFAULT FALSE,
  bonus_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (bonus_percent >= 0 AND bonus_percent <= 200),
  bonus_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (bonus_amount >= 0),
  total_credited NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (total_credited >= 0),
  reviewed_by TEXT REFERENCES users(firebase_uid) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevents TrxID replay globally across all users while allowing re-submission only if previously rejected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_active_trx_id
  ON deposit_requests (normalized_trx_id)
  WHERE status <> 'rejected';

CREATE INDEX IF NOT EXISTS idx_deposit_user_created ON deposit_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposit_status_created ON deposit_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(firebase_uid) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('bkash', 'nagad', 'rocket')),
  personal_number TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
  reviewed_by TEXT REFERENCES users(firebase_uid) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_user_created ON withdrawal_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_status_created ON withdrawal_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_uid TEXT NOT NULL REFERENCES users(firebase_uid) ON DELETE CASCADE,
  referred_uid TEXT NOT NULL UNIQUE REFERENCES users(firebase_uid) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rewarded')),
  reward_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (reward_amount >= 0),
  deposit_request_id UUID REFERENCES deposit_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rewarded_at TIMESTAMPTZ,
  CHECK (referrer_uid <> referred_uid)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bkash_number TEXT NOT NULL DEFAULT '',
  bkash_type TEXT NOT NULL DEFAULT 'Personal' CHECK (bkash_type IN ('Personal', 'Agent', 'Merchant')),
  bkash_instructions TEXT NOT NULL DEFAULT 'বিকাশ অ্যাপ থেকে "Send Money" করুন।',
  bkash_active BOOLEAN NOT NULL DEFAULT TRUE,
  nagad_number TEXT NOT NULL DEFAULT '',
  nagad_type TEXT NOT NULL DEFAULT 'Personal' CHECK (nagad_type IN ('Personal', 'Agent', 'Merchant')),
  nagad_instructions TEXT NOT NULL DEFAULT 'নগদ অ্যাপ থেকে "Send Money" করুন।',
  nagad_active BOOLEAN NOT NULL DEFAULT TRUE,
  rocket_number TEXT NOT NULL DEFAULT '',
  rocket_type TEXT NOT NULL DEFAULT 'Personal' CHECK (rocket_type IN ('Personal', 'Agent', 'Merchant')),
  rocket_instructions TEXT NOT NULL DEFAULT 'রকেট অ্যাপ থেকে "Send Money" করুন।',
  rocket_active BOOLEAN NOT NULL DEFAULT TRUE,
  min_deposit NUMERIC(14, 2) NOT NULL DEFAULT 100.00 CHECK (min_deposit > 0),
  max_deposit NUMERIC(14, 2) NOT NULL DEFAULT 25000.00 CHECK (max_deposit >= min_deposit),
  min_withdrawal NUMERIC(14, 2) NOT NULL DEFAULT 200.00 CHECK (min_withdrawal > 0),
  max_withdrawal NUMERIC(14, 2) NOT NULL DEFAULT 25000.00 CHECK (max_withdrawal >= min_withdrawal),
  first_deposit_bonus_percent NUMERIC(5, 2) NOT NULL DEFAULT 50.00 CHECK (first_deposit_bonus_percent >= 0 AND first_deposit_bonus_percent <= 200),
  notice_text TEXT NOT NULL DEFAULT 'টাকা পাঠানোর পর ট্রানজেকশন আইডি (TrxID) দিয়ে সাবমিট করুন। অ্যাডমিন নিশ্চিত করে ১-৩ মিনিটের মধ্যে ব্যালেন্স অ্যাড করে দিবে।',
  withdrawal_notice_text TEXT NOT NULL DEFAULT 'উত্তোলন দেওয়ার পর এডমিন ভেরিফাই করে ৫-১৫ মিনিটের মধ্যে টাকা পাঠিয়ে দিবে। শুধুমাত্র পার্সোনাল বিকাশ/নগদ/রকেট নম্বর ব্যবহার করুন।',
  marquee_notice TEXT NOT NULL DEFAULT 'স্বাগতম SkyWin BD অফিসিয়াল মোবাইল অ্যাপে!',
  telegram_channel TEXT NOT NULL DEFAULT '',
  telegram_support TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_uid TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON admin_audit_logs (admin_uid, created_at DESC);
