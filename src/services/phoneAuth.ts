import { UserWalletProfile, db, signUpWithPhone, signInWithPhone, logoutUser } from './firebase';
import { backendApi, mapBackendMeToProfile } from './backendApi';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import { canRegisterNewAccountOnDevice, recordAccountRegistrationOnDevice } from './deviceSecurity';

export interface AppUser {
  uid: string;
  userCode?: string;
  referralCode?: string;
  displayName: string | null;
  email: string | null;
  phoneNumber: string | null;
  photoURL: string | null;
  provider: 'google' | 'phone';
  /** Server-verified PostgreSQL role returned by /api/me. */
  isAdmin?: boolean;
  status?: 'active' | 'suspended' | 'banned';
  suspendedUntil?: string | null;
  deactivationReason?: string | null;
}

export interface StoredPhoneAccount {
  uid: string;
  userCode: string; // Unique permanent ID, e.g. "USER-10842"
  phoneNumber: string; // Normalized 11 digits: e.g. 01712345678
  password: string;
  displayName: string;
  balance: number; // Starts at ৳ 100
  initialBonus: number; // ৳ 100 welcome bonus
  lockedPrincipal: number; // Welcome bonus + first deposit bonus + referral bonuses + rewards (cannot be withdrawn)
  totalDeposited: number;
  firstDepositBonusEarned?: number; // Extra bonus % received on first deposit
  hasDeposited?: boolean;
  rewardBonusEarned?: number;
  referralCode: string; // User's referral code (same as userCode)
  referredBy?: string; // Referrer's userCode
  referredByUid?: string; // Referrer's UID
  referralCount: number; // Total friends invited
  referralBonusEarned: number; // Cumulative 100% invite bonus earned from invited friends' first deposits
  inviteBonusBalance?: number; // Active non-withdrawable, non-profitable invite bonus balance
  firstDepositReferralRewarded?: boolean; // True once referrer has received 100% invite bonus for this user's first deposit
  status?: 'active' | 'suspended' | 'banned'; // active, suspended (temporary), banned (permanent)
  suspendedUntil?: string | null; // ISO timestamp for temporary suspension expiration
  deactivationReason?: string | null; // Reason why user was deactivated
  createdAt: string;
  updatedAt: string;
}

export interface AccountSuspensionInfo {
  isDeactivated: boolean;
  isBanned?: boolean;
  isSuspended?: boolean;
  reason?: string;
  suspendedUntil?: string | null;
  remainingMinutes?: number;
}

/**
 * Checks whether an account is currently banned or temporarily suspended
 */
export function checkAccountSuspensionStatus(account?: {
  status?: string;
  suspendedUntil?: string | null;
  deactivationReason?: string | null;
} | null): AccountSuspensionInfo {
  if (!account) return { isDeactivated: false };

  if (account.status === 'banned') {
    return {
      isDeactivated: true,
      isBanned: true,
      reason: account.deactivationReason || 'এডমিন কর্তৃক অ্যাকাউন্টটি স্থায়ীভাবে ডিঅ্যাক্টিভ (Banned) করা হয়েছে।',
    };
  }

  if (account.status === 'suspended' && account.suspendedUntil) {
    const expiry = new Date(account.suspendedUntil).getTime();
    const now = Date.now();
    if (expiry > now) {
      const remainingMs = expiry - now;
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
      return {
        isDeactivated: true,
        isSuspended: true,
        reason: account.deactivationReason || 'অ্যাকাউন্টটি সাময়িকভাবে ডিঅ্যাক্টিভ রাখা হয়েছে।',
        suspendedUntil: account.suspendedUntil,
        remainingMinutes,
      };
    }
  }

  return { isDeactivated: false };
}

export interface ReferralRecord {
  id: string;
  referrerUid?: string;
  referrerCode: string;
  referredUid?: string;
  referredUserCode: string;
  referredPhone: string;
  referredName?: string;
  firstDepositAmount?: number;
  bonusAmount: number;
  status?: 'pending_deposit' | 'rewarded';
  createdAt: string;
  rewardedAt?: string;
}

const STORAGE_ACCOUNTS_KEY = 'aviator_phone_accounts_v1';
const STORAGE_SESSION_KEY = 'aviator_active_phone_session_v1';
const STORAGE_REFERRALS_KEY = 'aviator_referrals_records_v1';

// Format and normalize phone numbers for auth and display
export function normalizePhoneNumber(phone: string): { cleanPhone: string; displayPhone: string } {
  let clean = phone.replace(/[^0-9]/g, '');
  if (clean.startsWith('880')) {
    clean = '0' + clean.slice(3);
  } else if (clean.startsWith('88') && clean.length > 11) {
    clean = clean.slice(2);
  }
  const displayPhone = clean.length === 11
    ? `${clean.slice(0, 5)}-${clean.slice(5)}`
    : clean;
  return { cleanPhone: clean, displayPhone };
}

// Generate unique 5-digit User ID code, e.g. "USER-10842"
export function generateUniqueUserCode(existingAccounts: Record<string, StoredPhoneAccount>): string {
  const existingCodes = new Set(Object.values(existingAccounts).map((a) => a.userCode?.toUpperCase()));
  for (let i = 0; i < 500; i++) {
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    const candidate = `USER-${randomNum}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }
  return `USER-${Date.now().toString().slice(-5)}`;
}

// Get all stored referral records
export function getStoredReferralRecords(): ReferralRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_REFERRALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Save referral record
export function saveReferralRecord(record: ReferralRecord): void {
  try {
    const current = getStoredReferralRecords();
    localStorage.setItem(STORAGE_REFERRALS_KEY, JSON.stringify([record, ...current]));
  } catch (e) {
    console.warn('Failed to save referral record:', e);
  }
}

// Load all saved phone accounts with auto-migration for userCode & locked balance
export function getStoredPhoneAccounts(): Record<string, StoredPhoneAccount> {
  try {
    const raw = localStorage.getItem(STORAGE_ACCOUNTS_KEY);
    if (!raw) return {};
    const accounts: Record<string, StoredPhoneAccount> = JSON.parse(raw);
    let hasChanges = false;

    // Migrate any legacy accounts without userCode or lockedPrincipal
    for (const key of Object.keys(accounts)) {
      const acc = accounts[key];
      if (!acc.userCode) {
        acc.userCode = `USER-${acc.phoneNumber ? acc.phoneNumber.slice(-5) : Math.floor(10000 + Math.random() * 90000)}`;
        hasChanges = true;
      }
      if (!acc.referralCode) {
        acc.referralCode = acc.userCode;
        hasChanges = true;
      }
      if (acc.initialBonus === undefined) {
        acc.initialBonus = 100;
        hasChanges = true;
      }
      if (acc.referralBonusEarned === undefined) {
        acc.referralBonusEarned = 0;
        hasChanges = true;
      }
      if (acc.inviteBonusBalance === undefined) {
        acc.inviteBonusBalance = acc.referralBonusEarned || 0;
        hasChanges = true;
      }
      const minLocked =
        (acc.initialBonus !== undefined ? acc.initialBonus : 100) +
        (acc.inviteBonusBalance || 0) +
        (acc.firstDepositBonusEarned || 0) +
        (acc.rewardBonusEarned || 0);
      if (acc.lockedPrincipal === undefined || acc.lockedPrincipal < minLocked) {
        acc.lockedPrincipal = minLocked;
        hasChanges = true;
      }
      if (acc.totalDeposited === undefined) {
        acc.totalDeposited = 0;
        hasChanges = true;
      }
      if (acc.referralCount === undefined) {
        acc.referralCount = 0;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      saveStoredPhoneAccounts(accounts);
    }
    return accounts;
  } catch {
    return {};
  }
}

// Save accounts map
export function saveStoredPhoneAccounts(accounts: Record<string, StoredPhoneAccount>): void {
  try {
    localStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch (e) {
    console.warn('Failed to save phone accounts to localStorage:', e);
  }
}

// Register a new mobile number account
// Starts with ৳ 100 welcome bonus balance!
// Supports referral code: referrer gets ৳ 50 bonus commission!
async function getServerPhoneAccount(phone: string): Promise<{ user: AppUser; profile: UserWalletProfile }> {
  const me = await backendApi.getMe();
  const firebaseUser = (await import('./firebase')).auth.currentUser;
  const profile = mapBackendMeToProfile(me, firebaseUser);
  const user: AppUser = {
    uid: me.user.uid,
    userCode: me.user.userCode,
    referralCode: me.user.referralCode,
    displayName: me.user.displayName || `User ${phone}`,
    email: me.user.email,
    phoneNumber: me.user.phoneNumber || phone,
    photoURL: firebaseUser?.photoURL || null,
    provider: 'phone',
    isAdmin: me.user.isAdmin === true,
    status: me.user.status as AppUser['status'],
  };
  return { user, profile };
}

// New phone accounts are authenticated by Firebase Auth, never by Local Storage passwords.
// Wallet and role are provisioned and returned by the Express/PostgreSQL backend.
export async function registerPhoneAccount(
  rawPhone: string,
  pass: string,
  fullName?: string,
  referralCodeInput?: string
): Promise<{ success: boolean; user?: AppUser; profile?: UserWalletProfile; error?: string; referralBonusApplied?: boolean }> {
  const { cleanPhone } = normalizePhoneNumber(rawPhone);
  if (!/^01[0-9]{9}$/.test(cleanPhone)) {
    return { success: false, error: 'সঠিক ১১ ডিজিটের বাংলাদেশি মোবাইল নম্বর দিন।' };
  }
  if (!pass || pass.length < 6) {
    return { success: false, error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' };
  }

  try {
    const { getStoredAppControls } = await import('./appControlService');
    if (!getStoredAppControls().registrationEnabled) {
      return { success: false, error: 'নতুন অ্যাকাউন্ট রেজিস্ট্রেশন সাময়িকভাবে বন্ধ আছে।' };
    }

    // Keep the device registration limit, but do not store credentials locally.
    const deviceCheck = await canRegisterNewAccountOnDevice(cleanPhone);
    if (!deviceCheck.allowed) {
      return { success: false, error: deviceCheck.reason || 'এই ডিভাইসে নতুন অ্যাকাউন্ট তৈরির সীমা পূর্ণ হয়েছে।' };
    }

    await signUpWithPhone(cleanPhone, pass, fullName);
    if (referralCodeInput?.trim()) {
      await backendApi.updateProfile({ referralCode: referralCodeInput.trim() });
    }
    const account = await getServerPhoneAccount(cleanPhone);
    await recordAccountRegistrationOnDevice(cleanPhone);
    try {
      localStorage.removeItem(STORAGE_ACCOUNTS_KEY);
      localStorage.removeItem(STORAGE_SESSION_KEY);
    } catch {}
    return { success: true, ...account, referralBonusApplied: false };
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/email-already-in-use') {
      return { success: false, error: 'এই মোবাইল নম্বরে অ্যাকাউন্ট আগে থেকেই আছে। লগইন করুন।' };
    }
    if (code === 'auth/weak-password') {
      return { success: false, error: 'পাসওয়ার্ড আরও শক্তিশালী করুন।' };
    }
    return { success: false, error: err instanceof Error ? err.message : 'অ্যাকাউন্ট তৈরি করা যায়নি।' };
  }
}

// Phone login is a Firebase Auth sign-in. The server creates/loads the account and
// applies ADMIN_PHONES authorization only after verifying the Firebase ID token.
export async function loginPhoneAccount(
  rawPhone: string,
  pass: string
): Promise<{ success: boolean; user?: AppUser; profile?: UserWalletProfile; error?: string }> {
  const { cleanPhone } = normalizePhoneNumber(rawPhone);
  if (!/^01[0-9]{9}$/.test(cleanPhone)) {
    return { success: false, error: 'সঠিক ১১ ডিজিটের বাংলাদেশি মোবাইল নম্বর দিন।' };
  }
  try {
    await signInWithPhone(cleanPhone, pass);
    const account = await getServerPhoneAccount(cleanPhone);
    try {
      localStorage.removeItem(STORAGE_ACCOUNTS_KEY);
      localStorage.removeItem(STORAGE_SESSION_KEY);
    } catch {}
    return { success: true, ...account };
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return { success: false, error: 'মোবাইল নম্বর অথবা পাসওয়ার্ড সঠিক নয়।' };
    }
    return { success: false, error: err instanceof Error ? err.message : 'লগইন ব্যর্থ হয়েছে।' };
  }
}

// Get currently active phone session on app load
export function getActivePhoneSession(): { user: AppUser; profile: UserWalletProfile } | null {
  // Phone sessions now come from Firebase Auth persistence, never browser Local Storage.
  return null;
}

// Logout phone user
export function logoutPhoneSession(): void {
  try {
    localStorage.removeItem(STORAGE_SESSION_KEY);
    localStorage.removeItem(STORAGE_ACCOUNTS_KEY);
  } catch {}
  void logoutUser().catch(() => {});
}

// Sync phone account balance to local storage and Firestore
export function syncPhoneAccountBalance(uid: string, balance: number): void {
  const rounded = Math.max(0, Math.round(balance * 100) / 100);
  const accounts = getStoredPhoneAccounts();
  for (const key of Object.keys(accounts)) {
    if (accounts[key].uid === uid) {
      accounts[key].balance = rounded;
      accounts[key].updatedAt = new Date().toISOString();
      saveStoredPhoneAccounts(accounts);
      break;
    }
  }

  // Update in Firestore
  try {
    const userRef = doc(db, 'users', uid);
    updateDoc(userRef, {
      balance: rounded,
      updatedAt: new Date().toISOString(),
    }).catch((err) => console.warn('Could not sync phone balance to Firestore:', err));
  } catch (fsErr) {
    console.warn('Error initiating Firestore balance sync:', fsErr);
  }
}

// Update phone balance in local storage when Firestore sends a snapshot
export function updatePhoneAccountBalanceLocally(phoneOrUid: string, balance: number): void {
  const rounded = Math.max(0, Math.round(balance * 100) / 100);
  const accounts = getStoredPhoneAccounts();
  let updated = false;
  for (const key of Object.keys(accounts)) {
    if (accounts[key].uid === phoneOrUid || accounts[key].phoneNumber === phoneOrUid) {
      accounts[key].balance = rounded;
      accounts[key].updatedAt = new Date().toISOString();
      updated = true;
      break;
    }
  }
  if (updated) {
    saveStoredPhoneAccounts(accounts);
  }
}

// Update phone user profile name
export function updatePhoneAccountName(uid: string, newName: string): void {
  const accounts = getStoredPhoneAccounts();
  for (const key of Object.keys(accounts)) {
    if (accounts[key].uid === uid) {
      accounts[key].displayName = newName;
      accounts[key].updatedAt = new Date().toISOString();
      saveStoredPhoneAccounts(accounts);
      break;
    }
  }
}

// Admin: Update user credentials, reset ID or password
export function adminUpdatePhoneAccount(
  identifier: string, // phone, uid, or userCode
  updates: Partial<StoredPhoneAccount>
): { success: boolean; account?: StoredPhoneAccount; error?: string } {
  const accounts = getStoredPhoneAccounts();
  const cleanId = identifier.trim();

  let targetKey: string | null = null;
  for (const key of Object.keys(accounts)) {
    const acc = accounts[key];
    if (
      key === cleanId ||
      acc.phoneNumber === cleanId ||
      acc.uid === cleanId ||
      acc.userCode?.toUpperCase() === cleanId.toUpperCase()
    ) {
      targetKey = key;
      break;
    }
  }

  if (!targetKey) {
    return { success: false, error: 'ইউজার অ্যাকাউন্ট পাওয়া যায়নি' };
  }

  const existing = accounts[targetKey];
  const now = new Date().toISOString();

  // If userCode is changing, ensure it's not duplicate
  if (updates.userCode && updates.userCode !== existing.userCode) {
    const desiredCode = updates.userCode.trim().toUpperCase();
    const isTaken = Object.values(accounts).some(
      (a) => a.uid !== existing.uid && a.userCode?.toUpperCase() === desiredCode
    );
    if (isTaken) {
      return { success: false, error: 'এই ইউজার আইডি অন্য ইউজারের জন্য ব্যবহৃত হচ্ছে।' };
    }
    existing.userCode = desiredCode;
    existing.referralCode = desiredCode;
  }

  if (updates.password !== undefined && updates.password.trim().length >= 4) {
    existing.password = updates.password.trim();
  }
  if (updates.displayName !== undefined) {
    existing.displayName = updates.displayName.trim();
  }
  if (updates.balance !== undefined && !isNaN(updates.balance)) {
    existing.balance = Math.max(0, Math.round(updates.balance * 100) / 100);
  }
  if (updates.lockedPrincipal !== undefined && !isNaN(updates.lockedPrincipal)) {
    existing.lockedPrincipal = Math.max(0, Math.round(updates.lockedPrincipal * 100) / 100);
  }
  if (updates.status !== undefined) {
    existing.status = updates.status;
  }
  if (updates.suspendedUntil !== undefined) {
    existing.suspendedUntil = updates.suspendedUntil;
  }
  if (updates.deactivationReason !== undefined) {
    existing.deactivationReason = updates.deactivationReason;
  }
  existing.updatedAt = now;

  accounts[targetKey] = existing;
  saveStoredPhoneAccounts(accounts);

  // If phone number is changing, remap key
  if (updates.phoneNumber && updates.phoneNumber !== existing.phoneNumber) {
    const { cleanPhone } = normalizePhoneNumber(updates.phoneNumber);
    if (cleanPhone.length === 11) {
      delete accounts[targetKey];
      existing.phoneNumber = cleanPhone;
      existing.uid = `phone_${cleanPhone}`;
      accounts[cleanPhone] = existing;
      saveStoredPhoneAccounts(accounts);
    }
  }

  // Sync updates to Firestore
  try {
    const userDocRef = doc(db, 'users', existing.uid);
    updateDoc(userDocRef, {
      userCode: existing.userCode,
      referralCode: existing.referralCode,
      password: existing.password,
      displayName: existing.displayName,
      balance: existing.balance,
      lockedPrincipal: existing.lockedPrincipal,
      phoneNumber: existing.phoneNumber,
      status: existing.status || 'active',
      suspendedUntil: existing.suspendedUntil || null,
      deactivationReason: existing.deactivationReason || null,
      updatedAt: now,
    }).catch((err) => console.warn('Could not sync user update to Firestore:', err));
  } catch (fsErr) {
    console.warn('Failed to initiate user update in Firestore:', fsErr);
  }

  window.dispatchEvent(new CustomEvent('accounts_updated'));
  return { success: true, account: existing };
}
