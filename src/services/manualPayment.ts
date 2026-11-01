import { db } from './firebase';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  updateDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  where,
  addDoc,
} from 'firebase/firestore';
import { syncPhoneAccountBalance } from './phoneAuth';

export interface PaymentGatewayConfig {
  number: string;
  accountType: 'Personal' | 'Agent' | 'Merchant';
  instructions: string;
  isActive: boolean;
}

export interface SystemPaymentSettings {
  bkash: PaymentGatewayConfig;
  nagad: PaymentGatewayConfig;
  rocket: PaymentGatewayConfig;
  noticeText: string;
  adminPin: string;
  marqueeNotice?: string;
  withdrawalNoticeText?: string;
  telegramChannel?: string;
  telegramSupport?: string;
  firstDepositBonusPercent?: number; // প্রথম ডিপোজিটে কত % বোনাস পাবে (e.g. 50%, 100%, 20%)
}

export interface ManualDepositRequest {
  id: string;
  userId: string;
  userCode?: string; // Player's User ID, e.g. "USER-10842"
  userIdentifier: string;
  method: 'bkash' | 'nagad' | 'rocket';
  targetNumber: string;
  senderNumber: string;
  trxId: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
  rejectionReason?: string;
  adminNote?: string;
  isFirstDeposit?: boolean;
  bonusPercent?: number;
  bonusAmount?: number;
  totalCredited?: number;
  hasDeposited?: boolean;
}

export interface ManualWithdrawalRequest {
  id: string;
  userId: string;
  userCode?: string; // Player's User ID, e.g. "USER-10842"
  userIdentifier: string;
  method: 'bkash' | 'nagad' | 'rocket';
  personalNumber: string; // শুধুমাত্র পার্সোনাল নম্বর (No agent)
  amount: number;
  status: 'pending' | 'completed' | 'rejected';
  createdAt: string;
  updatedAt: string;
  adminNote?: string;
  rejectionReason?: string;
}

const STORAGE_SETTINGS_KEY = 'aviator_payment_settings_v2';
const STORAGE_REQUESTS_KEY = 'aviator_manual_deposit_requests_v2';
const STORAGE_WITHDRAWAL_REQUESTS_KEY = 'aviator_manual_withdrawal_requests_v2';

export const DEFAULT_PAYMENT_SETTINGS: SystemPaymentSettings = {
  bkash: {
    number: '01712-345678',
    accountType: 'Personal',
    instructions: 'বিকাশ অ্যাপ থেকে "Send Money" করুন।',
    isActive: true,
  },
  nagad: {
    number: '01812-345678',
    accountType: 'Personal',
    instructions: 'নগদ অ্যাপ থেকে "Send Money" করুন।',
    isActive: true,
  },
  rocket: {
    number: '01912-345678',
    accountType: 'Personal',
    instructions: 'রকেট অ্যাপ থেকে "Send Money" করুন।',
    isActive: true,
  },
  noticeText: 'টাকা পাঠানোর পর ট্রানজেকশন আইডি (TrxID) দিয়ে সাবমিট করুন। অ্যাডমিন নিশ্চিত করে ১-৩ মিনিটের মধ্যে ব্যালেন্স অ্যাড করে দিবে।',
  adminPin: '1234',
  marqueeNotice: '🎉 স্বাগতম SkyWin BD অফিসিয়াল মোবাইল গেমে! ৳ ৫০০ ডিপোজিট করলেই পাচ্ছেন আকর্ষণীয় বোনাস! বিকাশ, নগদ ও রকেটে ১-৩ মিনিটে দ্রুত পেমেন্ট সম্পন্ন হয়। উপভোগ করুন সেরা ক্র্যাশ গেম ও সেরা জয়! 🚀',
  withdrawalNoticeText: 'উত্তোলন দেওয়ার পর এডমিন ভেরিফাই করে ৫-১৫ মিনিটের মধ্যে টাকা পাঠিয়ে দিবে। শুধুমাত্র পার্সোনাল বিকাশ/নগদ/রকেট নম্বর ব্যবহার করুন।',
  telegramChannel: 'https://t.me/SkyWinBD_Channel',
  telegramSupport: 'https://t.me/SkyWinBD_Support',
  firstDepositBonusPercent: 50, // Default 50% extra bonus on first deposit
};

// Get current payment settings from storage or defaults
export function getStoredPaymentSettings(): SystemPaymentSettings {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_PAYMENT_SETTINGS,
        ...parsed,
        bkash: { ...DEFAULT_PAYMENT_SETTINGS.bkash, ...(parsed.bkash || {}) },
        nagad: { ...DEFAULT_PAYMENT_SETTINGS.nagad, ...(parsed.nagad || {}) },
        rocket: { ...DEFAULT_PAYMENT_SETTINGS.rocket, ...(parsed.rocket || {}) },
        telegramChannel: parsed.telegramChannel || DEFAULT_PAYMENT_SETTINGS.telegramChannel,
        telegramSupport: parsed.telegramSupport || DEFAULT_PAYMENT_SETTINGS.telegramSupport,
        firstDepositBonusPercent:
          typeof parsed.firstDepositBonusPercent === 'number'
            ? parsed.firstDepositBonusPercent
            : DEFAULT_PAYMENT_SETTINGS.firstDepositBonusPercent,
      };
    }
  } catch (e) {
    console.warn('Failed to parse payment settings from localStorage:', e);
  }
  return DEFAULT_PAYMENT_SETTINGS;
}

export function formatTelegramLink(input?: string, fallback = ''): string {
  if (!input || !input.trim()) return fallback;
  const trimmed = input.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  if (trimmed.startsWith('t.me/')) {
    return `https://${trimmed}`;
  }
  const cleanHandle = trimmed.replace(/^@/, '');
  return `https://t.me/${cleanHandle}`;
}

// Save payment settings locally and in Firestore
export async function savePaymentSettings(newSettings: SystemPaymentSettings): Promise<void> {
  try {
    const sanitizedSettings: SystemPaymentSettings = {
      ...newSettings,
      telegramChannel: formatTelegramLink(newSettings.telegramChannel, DEFAULT_PAYMENT_SETTINGS.telegramChannel),
      telegramSupport: formatTelegramLink(newSettings.telegramSupport, DEFAULT_PAYMENT_SETTINGS.telegramSupport),
    };
    localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(sanitizedSettings));
    window.dispatchEvent(new CustomEvent('payment_settings_updated', { detail: sanitizedSettings }));

    // Sync to Firestore
    try {
      const settingsRef = doc(db, 'system', 'payment_settings');
      await setDoc(settingsRef, {
        ...sanitizedSettings,
        updatedAt: new Date().toISOString(),
      });
    } catch (fsErr) {
      console.warn('Could not sync payment settings to Firestore:', fsErr);
    }
  } catch (e) {
    console.error('Error saving payment settings:', e);
    throw e;
  }
}

// Fetch remote settings from Firestore if available
export async function syncPaymentSettingsFromFirestore(): Promise<SystemPaymentSettings> {
  try {
    const settingsRef = doc(db, 'system', 'payment_settings');
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      const data = snap.data() as SystemPaymentSettings;
      const merged: SystemPaymentSettings = {
        ...DEFAULT_PAYMENT_SETTINGS,
        ...data,
        bkash: { ...DEFAULT_PAYMENT_SETTINGS.bkash, ...(data.bkash || {}) },
        nagad: { ...DEFAULT_PAYMENT_SETTINGS.nagad, ...(data.nagad || {}) },
        rocket: { ...DEFAULT_PAYMENT_SETTINGS.rocket, ...(data.rocket || {}) },
      };
      localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(merged));
      if (merged.marqueeNotice) {
        localStorage.setItem('aviator_marquee_text', merged.marqueeNotice);
        window.dispatchEvent(new Event('marquee_text_updated'));
      }
      window.dispatchEvent(new CustomEvent('payment_settings_updated', { detail: merged }));
      return merged;
    }
  } catch (e) {
    console.warn('Could not fetch payment settings from Firestore:', e);
  }
  return getStoredPaymentSettings();
}

// Real-time listener for settings (notices, numbers, marquee title)
export function subscribeToPaymentSettings(
  callback: (settings: SystemPaymentSettings) => void
): () => void {
  try {
    const settingsRef = doc(db, 'system', 'payment_settings');
    return onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as SystemPaymentSettings;
        const merged: SystemPaymentSettings = {
          ...DEFAULT_PAYMENT_SETTINGS,
          ...data,
          bkash: { ...DEFAULT_PAYMENT_SETTINGS.bkash, ...(data.bkash || {}) },
          nagad: { ...DEFAULT_PAYMENT_SETTINGS.nagad, ...(data.nagad || {}) },
          rocket: { ...DEFAULT_PAYMENT_SETTINGS.rocket, ...(data.rocket || {}) },
        };
        localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(merged));
        if (merged.marqueeNotice) {
          localStorage.setItem('aviator_marquee_text', merged.marqueeNotice);
          window.dispatchEvent(new Event('marquee_text_updated'));
        }
        window.dispatchEvent(new CustomEvent('payment_settings_updated', { detail: merged }));
        callback(merged);
      }
    });
  } catch (err) {
    console.warn('subscribeToPaymentSettings error:', err);
    return () => {};
  }
}

// Load all stored deposit requests
export function getStoredDepositRequests(): ManualDepositRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_REQUESTS_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Failed to parse deposit requests from localStorage:', e);
  }
  return [];
}

// Save requests list
function saveDepositRequestsToStorage(requests: ManualDepositRequest[]): void {
  try {
    localStorage.setItem(STORAGE_REQUESTS_KEY, JSON.stringify(requests));
    window.dispatchEvent(new CustomEvent('deposit_requests_updated', { detail: requests }));
  } catch (e) {
    console.warn('Failed to save deposit requests to localStorage:', e);
  }
}

// Submit a new deposit request
export async function submitManualDepositRequest(params: {
  userId: string;
  userCode?: string;
  userIdentifier: string;
  method: 'bkash' | 'nagad' | 'rocket';
  targetNumber: string;
  senderNumber: string;
  trxId: string;
  amount: number;
}): Promise<{ success: boolean; request?: ManualDepositRequest; error?: string }> {
  const { userId, userCode, userIdentifier, method, targetNumber, senderNumber, trxId, amount } = params;

  if (!userId || userId.startsWith('guest') || userId === 'guest') {
    return { success: false, error: 'এড মানি (রিচার্জ) করতে হলে প্রথমে একটি একাউন্ট তৈরি বা লগইন করতে হবে।' };
  }

  if (!amount || amount < 50) {
    return { success: false, error: 'নূন্যতম ডিপোজিটের পরিমাণ ৫০ ৳ হতে হবে।' };
  }

  const cleanSender = senderNumber.replace(/[^0-9]/g, '');
  if (cleanSender.length < 11) {
    return { success: false, error: 'অনুগ্রহ করে সঠিক ১১ ডিজিটের প্রেরক নম্বর লিখুন (যেমন: 017xxxxxxxx)।' };
  }

  const cleanTrx = trxId.trim().toUpperCase();
  if (!cleanTrx || cleanTrx.length < 5) {
    return { success: false, error: 'অনুগ্রহ করে সঠিক ট্রানজেকশন আইডি (TrxID) দিন।' };
  }

  const now = new Date().toISOString();
  const requestId = `dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const newRequest: ManualDepositRequest = {
    id: requestId,
    userId,
    userCode: userCode || '',
    userIdentifier: userIdentifier || cleanSender,
    method,
    targetNumber,
    senderNumber: cleanSender,
    trxId: cleanTrx,
    amount,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  // Check if identical TrxID is already submitted
  const allRequests = getStoredDepositRequests();
  const duplicate = allRequests.find(
    (r) => r.trxId.toUpperCase() === cleanTrx && r.status !== 'rejected'
  );
  if (duplicate) {
    return {
      success: false,
      error: 'এই ট্রানজেকশন আইডি (TrxID) ইতিমধ্যে জমা দেওয়া হয়েছে। অনুগ্রহ করে নতুন ট্রানজেকশন আইডি ব্যবহার করুন।',
    };
  }

  // Prepend new request
  const updated = [newRequest, ...allRequests];
  saveDepositRequestsToStorage(updated);

  // Sync to Firestore
  try {
    const docRef = doc(db, 'deposit_requests', requestId);
    await setDoc(docRef, newRequest);
  } catch (err) {
    console.warn('Could not sync manual deposit request to Firestore:', err);
  }

  return { success: true, request: newRequest };
}

// Helper to find and return a user's Firestore DocumentReference and DocumentSnapshot
export async function findUserDocInFirestore(params: {
  userId?: string;
  senderPhone?: string;
  userCode?: string;
}) {
  const { userId, senderPhone, userCode } = params;
  const cleanPhone = (senderPhone || '').replace(/[^0-9]/g, '');
  const cleanCode = (userCode || '').trim().toUpperCase();

  // 1. Try userId directly if provided
  if (userId && !userId.startsWith('guest_')) {
    try {
      const ref = doc(db, 'users', userId);
      const snap = await getDoc(ref);
      if (snap.exists()) return { ref, snap, foundBy: 'userId' };
    } catch {}
  }

  // 2. Try phone_{cleanPhone}
  if (cleanPhone) {
    try {
      const phoneRef = doc(db, 'users', `phone_${cleanPhone}`);
      const phoneSnap = await getDoc(phoneRef);
      if (phoneSnap.exists()) return { ref: phoneRef, snap: phoneSnap, foundBy: 'phone_prefix' };
    } catch {}
  }

  // 3. Try cleanPhone directly as doc ID
  if (cleanPhone) {
    try {
      const rawRef = doc(db, 'users', cleanPhone);
      const rawSnap = await getDoc(rawRef);
      if (rawSnap.exists()) return { ref: rawRef, snap: rawSnap, foundBy: 'cleanPhone' };
    } catch {}
  }

  // 4. Query collection 'users' where phoneNumber == cleanPhone
  if (cleanPhone) {
    try {
      const qPhone = query(collection(db, 'users'), where('phoneNumber', '==', cleanPhone), limit(1));
      const qSnap = await getDocs(qPhone);
      if (!qSnap.empty) {
        return { ref: qSnap.docs[0].ref, snap: qSnap.docs[0], foundBy: 'query_phone' };
      }
    } catch {}
  }

  // 5. Query collection 'users' where userCode == cleanCode
  if (cleanCode) {
    try {
      const qCode = query(collection(db, 'users'), where('userCode', '==', cleanCode), limit(1));
      const qSnap = await getDocs(qCode);
      if (!qSnap.empty) {
        return { ref: qSnap.docs[0].ref, snap: qSnap.docs[0], foundBy: 'query_code' };
      }
    } catch {}
  }

  // 6. Query collection 'users' where uid == userId
  if (userId) {
    try {
      const qUid = query(collection(db, 'users'), where('uid', '==', userId), limit(1));
      const qSnap = await getDocs(qUid);
      if (!qSnap.empty) {
        return { ref: qSnap.docs[0].ref, snap: qSnap.docs[0], foundBy: 'query_uid' };
      }
    } catch {}
  }

  return null;
}

// Approve deposit request and credit balance to user
// Note: Cash-in amount is added to lockedPrincipal (cannot be directly withdrawn, only profits above it can be withdrawn)
export async function approveManualDepositRequest(
  requestId: string,
  adminNote?: string
): Promise<{
  success: boolean;
  request?: ManualDepositRequest;
  error?: string;
  isFirstDeposit?: boolean;
  bonusPercent?: number;
  bonusAmount?: number;
  totalCredited?: number;
}> {
  let requests = getStoredDepositRequests();
  let index = requests.findIndex((r) => r.id === requestId);
  let target: ManualDepositRequest | null = index !== -1 ? requests[index] : null;

  // Fallback: If not in local storage, fetch directly from Firestore
  if (!target) {
    try {
      const reqDoc = await getDoc(doc(db, 'deposit_requests', requestId));
      if (reqDoc.exists()) {
        target = reqDoc.data() as ManualDepositRequest;
        requests = [target, ...requests];
        index = 0;
      }
    } catch (err) {
      console.warn('Could not fetch deposit request from Firestore:', err);
    }
  }

  if (!target) {
    return { success: false, error: 'রিকোয়েস্টটি পাওয়া যায়নি।' };
  }

  if (target.status === 'approved') {
    return { success: false, error: 'এই রিকোয়েস্টটি ইতিমধ্যে অনুমোদিত হয়েছে।' };
  }

  const now = new Date().toISOString();
  target.status = 'approved';
  target.updatedAt = now;
  if (adminNote) target.adminNote = adminNote;

  if (index !== -1) {
    requests[index] = target;
  } else {
    requests = [target, ...requests];
  }
  saveDepositRequestsToStorage(requests);

  // Credit the user's balance and update lockedPrincipal & totalDeposited
  const creditedAmount = target.amount;
  const targetUserId = target.userId;
  const cleanSender = (target.senderNumber || '').replace(/[^0-9]/g, '');
  const targetUserCode = (target.userCode || '').trim();

  // Load configured First Deposit Bonus % from settings
  const paymentSettings = getStoredPaymentSettings();
  const bonusPercent =
    typeof paymentSettings.firstDepositBonusPercent === 'number'
      ? Math.max(0, paymentSettings.firstDepositBonusPercent)
      : 50;

  // 1. Credit User in Firestore (CRITICAL: Cross-device persistent balance update)
  let resolvedDocRef: any = null;
  let newBalance = creditedAmount;
  let isFirstDeposit = false;
  let bonusAmount = 0;
  let totalAmountToCredit = creditedAmount;

  try {
    const found = await findUserDocInFirestore({
      userId: targetUserId,
      senderPhone: cleanSender,
      userCode: targetUserCode,
    });

    if (found) {
      resolvedDocRef = found.ref;
      const curData = found.snap.data() || {};
      const curBal = typeof curData.balance === 'number' ? curData.balance : 0;
      const curDep = typeof curData.totalDeposited === 'number' ? curData.totalDeposited : 0;
      const refBonus = typeof curData.referralBonusEarned === 'number' ? curData.referralBonusEarned : 0;
      const welcomeBonus = curData.initialBonus !== undefined ? curData.initialBonus : 100;
      const existingFirstBonus = typeof curData.firstDepositBonusEarned === 'number' ? curData.firstDepositBonusEarned : 0;
      const rewardBonus = typeof curData.rewardBonusEarned === 'number' ? curData.rewardBonusEarned : 0;

      // Determine if this is the user's first deposit
      isFirstDeposit = curDep <= 0 && curData.hasDeposited !== true && existingFirstBonus <= 0;
      if (isFirstDeposit && bonusPercent > 0) {
        bonusAmount = Math.round((creditedAmount * (bonusPercent / 100)) * 100) / 100;
        totalAmountToCredit = Math.round((creditedAmount + bonusAmount) * 100) / 100;
      }

      const updatedFirstBonus = isFirstDeposit ? (existingFirstBonus + bonusAmount) : existingFirstBonus;
      newBalance = Math.round((curBal + totalAmountToCredit) * 100) / 100;
      const newDep = Math.round((curDep + creditedAmount) * 100) / 100;

      // RULE: All extra money (welcome bonus, first deposit bonus, referral commission, spin rewards) are LOCKED and cannot be withdrawn!
      const totalLockedBonus = welcomeBonus + refBonus + updatedFirstBonus + rewardBonus;

      await setDoc(
        resolvedDocRef,
        {
          balance: newBalance,
          totalDeposited: newDep,
          hasDeposited: true,
          firstDepositBonusEarned: updatedFirstBonus,
          lockedPrincipal: totalLockedBonus,
          updatedAt: now,
        },
        { merge: true }
      );
    } else {
      // User doc not found in Firestore yet: create it with credited balance & bonus!
      const finalUid = targetUserId && !targetUserId.startsWith('guest_') ? targetUserId : `phone_${cleanSender}`;
      resolvedDocRef = doc(db, 'users', finalUid);
      isFirstDeposit = true;
      if (bonusPercent > 0) {
        bonusAmount = Math.round((creditedAmount * (bonusPercent / 100)) * 100) / 100;
        totalAmountToCredit = Math.round((creditedAmount + bonusAmount) * 100) / 100;
      }
      newBalance = totalAmountToCredit;
      const welcomeBonus = 100;
      const totalLockedBonus = welcomeBonus + bonusAmount;

      const newDocData = {
        id: finalUid,
        uid: finalUid,
        phoneNumber: cleanSender,
        userCode: targetUserCode || `USER-${cleanSender.slice(-5)}`,
        displayName: target.userIdentifier || `User ${cleanSender}`,
        balance: totalAmountToCredit,
        initialBonus: welcomeBonus,
        firstDepositBonusEarned: bonusAmount,
        hasDeposited: true,
        lockedPrincipal: totalLockedBonus,
        totalDeposited: creditedAmount,
        referralCode: targetUserCode || `USER-${cleanSender.slice(-5)}`,
        referralCount: 0,
        referralBonusEarned: 0,
        provider: 'phone',
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(resolvedDocRef, newDocData, { merge: true });
    }

    // Record wallet transaction in Firestore subcollection
    if (resolvedDocRef) {
      try {
        await addDoc(collection(db, 'users', resolvedDocRef.id, 'transactions'), {
          id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'deposit',
          amount: creditedAmount,
          bonusAmount: isFirstDeposit ? bonusAmount : 0,
          bonusPercent: isFirstDeposit ? bonusPercent : 0,
          isFirstDeposit,
          totalCredited: totalAmountToCredit,
          method: target.method,
          status: 'completed',
          trxId: target.trxId,
          accountNumber: target.senderNumber,
          timestamp: Date.now(),
          createdAt: now,
        });
      } catch (txErr) {
        console.warn('Could not record transaction in Firestore:', txErr);
      }
    }
  } catch (fsErr) {
    console.error('Critical error crediting balance in Firestore:', fsErr);
  }

  // 2. Also update local phone accounts on current device if exists
  try {
    const rawAccounts = localStorage.getItem('aviator_phone_accounts_v1');
    if (rawAccounts) {
      const accounts = JSON.parse(rawAccounts);
      for (const phoneKey of Object.keys(accounts)) {
        if (
          accounts[phoneKey].uid === targetUserId ||
          accounts[phoneKey].phoneNumber === cleanSender ||
          (resolvedDocRef && accounts[phoneKey].uid === resolvedDocRef.id)
        ) {
          accounts[phoneKey].balance = (accounts[phoneKey].balance || 0) + totalAmountToCredit;
          accounts[phoneKey].totalDeposited = (accounts[phoneKey].totalDeposited || 0) + creditedAmount;
          if (isFirstDeposit && bonusAmount > 0) {
            accounts[phoneKey].firstDepositBonusEarned = (accounts[phoneKey].firstDepositBonusEarned || 0) + bonusAmount;
          }
          accounts[phoneKey].hasDeposited = true;
          const welcome = accounts[phoneKey].initialBonus !== undefined ? accounts[phoneKey].initialBonus : 100;
          const ref = accounts[phoneKey].referralBonusEarned || 0;
          const fBonus = accounts[phoneKey].firstDepositBonusEarned || 0;
          accounts[phoneKey].lockedPrincipal = welcome + ref + fBonus;
          accounts[phoneKey].updatedAt = now;
          localStorage.setItem('aviator_phone_accounts_v1', JSON.stringify(accounts));
          break;
        }
      }
    }
  } catch (err) {
    console.warn('Error crediting local phone account:', err);
  }

  // 3. Update Firestore deposit_requests record
  try {
    const reqRef = doc(db, 'deposit_requests', requestId);
    const approvedNote = isFirstDeposit && bonusAmount > 0
      ? `প্রথম ডিপোজিট অনুমোদিত (+${bonusPercent}% এক্সট্রা বোনাস: ৳${bonusAmount.toLocaleString()})`
      : (adminNote || 'Approved by admin');

    target.status = 'approved';
    target.updatedAt = now;
    target.adminNote = approvedNote;
    target.isFirstDeposit = isFirstDeposit;
    target.bonusPercent = isFirstDeposit ? bonusPercent : 0;
    target.bonusAmount = isFirstDeposit ? bonusAmount : 0;
    target.totalCredited = totalAmountToCredit;

    await setDoc(
      reqRef,
      {
        ...target,
        status: 'approved',
        updatedAt: now,
        adminNote: approvedNote,
        creditedAmount,
        bonusAmount: isFirstDeposit ? bonusAmount : 0,
        bonusPercent: isFirstDeposit ? bonusPercent : 0,
        isFirstDeposit,
        totalCredited: totalAmountToCredit,
        targetDocId: resolvedDocRef ? resolvedDocRef.id : targetUserId,
      },
      { merge: true }
    );
  } catch (fsErr) {
    console.warn('Could not update Firestore deposit request status:', fsErr);
  }

  // 4. Dispatch balance credited event for immediate UI update in active session
  window.dispatchEvent(
    new CustomEvent('balance_credited', {
      detail: {
        userId: targetUserId,
        docId: resolvedDocRef ? resolvedDocRef.id : targetUserId,
        phone: cleanSender,
        amount: totalAmountToCredit,
        originalAmount: creditedAmount,
        bonusAmount: isFirstDeposit ? bonusAmount : 0,
        bonusPercent: isFirstDeposit ? bonusPercent : 0,
        isFirstDeposit,
        requestId,
      },
    })
  );

  return {
    success: true,
    request: target,
    isFirstDeposit,
    bonusPercent: isFirstDeposit ? bonusPercent : 0,
    bonusAmount: isFirstDeposit ? bonusAmount : 0,
    totalCredited: totalAmountToCredit,
  };
}

// Reject deposit request
export async function rejectManualDepositRequest(
  requestId: string,
  reason = 'ভুল বা অসত্য ট্রানজেকশন আইডি'
): Promise<{ success: boolean; request?: ManualDepositRequest; error?: string }> {
  const requests = getStoredDepositRequests();
  const index = requests.findIndex((r) => r.id === requestId);

  if (index === -1) {
    return { success: false, error: 'রিকোয়েস্টটি পাওয়া যায়নি।' };
  }

  const now = new Date().toISOString();
  requests[index].status = 'rejected';
  requests[index].rejectionReason = reason;
  requests[index].updatedAt = now;

  saveDepositRequestsToStorage(requests);

  // Update Firestore record
  try {
    const reqRef = doc(db, 'deposit_requests', requestId);
    await updateDoc(reqRef, {
      status: 'rejected',
      rejectionReason: reason,
      updatedAt: now,
    });
  } catch (fsErr) {
    console.warn('Could not update Firestore rejection status:', fsErr);
  }

  return { success: true, request: requests[index] };
}

// Fetch all requests from Firestore and merge
export async function syncDepositRequestsFromFirestore(): Promise<ManualDepositRequest[]> {
  try {
    const colRef = collection(db, 'deposit_requests');
    const q = query(colRef, limit(100));
    const snap = await getDocs(q);
    const remoteList: ManualDepositRequest[] = [];
    snap.forEach((d) => {
      remoteList.push(d.data() as ManualDepositRequest);
    });

    if (remoteList.length > 0) {
      const local = getStoredDepositRequests();
      // Merge by ID, prefer newer updatedAt
      const map = new Map<string, ManualDepositRequest>();
      local.forEach((r) => map.set(r.id, r));
      remoteList.forEach((r) => {
        const existing = map.get(r.id);
        if (!existing || new Date(r.updatedAt) >= new Date(existing.updatedAt)) {
          map.set(r.id, r);
        }
      });

      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      saveDepositRequestsToStorage(merged);
      return merged;
    }
  } catch (err) {
    console.warn('Could not sync deposit requests from Firestore:', err);
  }
  return getStoredDepositRequests();
}

// ======================== WITHDRAWAL FUNCTIONS ========================

// Load all stored withdrawal requests
export function getStoredWithdrawalRequests(): ManualWithdrawalRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_WITHDRAWAL_REQUESTS_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Failed to parse withdrawal requests from localStorage:', e);
  }
  return [];
}

// Save withdrawal requests list
function saveWithdrawalRequestsToStorage(requests: ManualWithdrawalRequest[]): void {
  try {
    localStorage.setItem(STORAGE_WITHDRAWAL_REQUESTS_KEY, JSON.stringify(requests));
    window.dispatchEvent(new CustomEvent('withdrawal_requests_updated', { detail: requests }));
  } catch (e) {
    console.warn('Failed to save withdrawal requests to localStorage:', e);
  }
}

// Submit a new manual withdrawal request
export async function submitManualWithdrawalRequest(params: {
  userId: string;
  userCode?: string;
  userIdentifier: string;
  method: 'bkash' | 'nagad' | 'rocket';
  personalNumber: string;
  amount: number;
}): Promise<{ success: boolean; request?: ManualWithdrawalRequest; error?: string }> {
  const { userId, userCode, userIdentifier, method, personalNumber, amount } = params;

  if (!userId || userId.startsWith('guest') || userId === 'guest') {
    return { success: false, error: 'উইথড্র করতে হলে প্রথমে একটি একাউন্ট তৈরি বা লগইন করতে হবে।' };
  }

  if (!amount || amount < 500) {
    return {
      success: false,
      error: 'ক্যাশআউট মিনিমাম ৫০০ টাকা হতে হবে। ক্যাশআউট করার জন্য একাউন্টে নূন্যতম ৫০০ টাকা উত্তোলনযোগ্য লাভ থাকতে হবে।',
    };
  }

  const cleanPersonalNumber = personalNumber.replace(/[^0-9]/g, '');
  if (cleanPersonalNumber.length < 11) {
    return { success: false, error: 'অনুগ্রহ করে সঠিক ১১ ডিজিটের পার্সোনাল নম্বর লিখুন (যেমন: 017xxxxxxxx)।' };
  }

  // ১। ডিপোজিট ছাড়া উইথড্র সম্পূর্ণ ব্লক (নূন্যতম ১ বার ডিপোজিট বাধ্যতামূলক)
  let hasValidDeposit = false;

  // Check 1: Check deposit requests in localStorage
  try {
    const deposits = getStoredDepositRequests();
    const approvedDeposit = deposits.find(
      (d) =>
        d.status === 'approved' &&
        (d.userId === userId ||
          (userCode && d.userCode && d.userCode.toUpperCase() === userCode.toUpperCase()) ||
          d.senderNumber.includes(cleanPersonalNumber) ||
          (d.userIdentifier && d.userIdentifier.includes(cleanPersonalNumber)))
    );
    if (approvedDeposit) {
      hasValidDeposit = true;
    }
  } catch {}

  // Check 2: Check local phone accounts
  if (!hasValidDeposit) {
    try {
      const rawAccounts = localStorage.getItem('aviator_phone_accounts_v1');
      if (rawAccounts) {
        const accounts = JSON.parse(rawAccounts);
        for (const k of Object.keys(accounts)) {
          const acc = accounts[k];
          if (
            acc.uid === userId ||
            acc.phoneNumber === cleanPersonalNumber ||
            (userCode && acc.userCode && acc.userCode.toUpperCase() === userCode.toUpperCase())
          ) {
            if (acc.hasDeposited || (acc.totalDeposited && acc.totalDeposited > 0)) {
              hasValidDeposit = true;
              break;
            }
          }
        }
      }
    } catch {}
  }

  // Check 3: Check Firestore if not yet found
  if (!hasValidDeposit) {
    try {
      const userSnap = await getDoc(doc(db, 'users', userId));
      if (userSnap.exists()) {
        const udata = userSnap.data();
        if (udata && (udata.hasDeposited || (udata.totalDeposited && udata.totalDeposited > 0))) {
          hasValidDeposit = true;
        }
      }
    } catch {}
  }

  if (!hasValidDeposit) {
    return {
      success: false,
      error: '🚫 ডিপোজিট ছাড়া উইথড্র সম্পূর্ণ বন্ধ! উইথড্র করার জন্য আপনার একাউন্টে নূন্যতম ১ বার সফল ডিপোজিট করা বাধ্যতামূলক।',
    };
  }

  const now = new Date().toISOString();
  const requestId = `wth_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const newRequest: ManualWithdrawalRequest = {
    id: requestId,
    userId,
    userCode: userCode || '',
    userIdentifier: userIdentifier || cleanPersonalNumber,
    method,
    personalNumber: cleanPersonalNumber,
    amount,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  const allRequests = getStoredWithdrawalRequests();
  const updated = [newRequest, ...allRequests];
  saveWithdrawalRequestsToStorage(updated);

  // Sync to Firestore
  try {
    const docRef = doc(db, 'withdrawal_requests', requestId);
    await setDoc(docRef, newRequest);
  } catch (err) {
    console.warn('Could not sync manual withdrawal request to Firestore:', err);
  }

  return { success: true, request: newRequest };
}

// Complete withdrawal request: Admin has verified and sent money to user's personal number
export async function completeManualWithdrawalRequest(
  requestId: string,
  adminNote?: string
): Promise<{ success: boolean; request?: ManualWithdrawalRequest; error?: string }> {
  let requests = getStoredWithdrawalRequests();
  let index = requests.findIndex((r) => r.id === requestId);
  let target: ManualWithdrawalRequest | null = index !== -1 ? requests[index] : null;

  if (!target) {
    try {
      const snap = await getDoc(doc(db, 'withdrawal_requests', requestId));
      if (snap.exists()) {
        target = snap.data() as ManualWithdrawalRequest;
        requests = [target, ...requests];
        index = 0;
      }
    } catch {}
  }

  if (!target) {
    return { success: false, error: 'উত্তোলন রিকোয়েস্টটি পাওয়া যায়নি।' };
  }

  if (target.status === 'completed') {
    return { success: false, error: 'এই রিকোয়েস্টটি ইতিমধ্যে সম্পন্ন হয়েছে।' };
  }

  const now = new Date().toISOString();
  target.status = 'completed';
  target.updatedAt = now;
  if (adminNote) target.adminNote = adminNote;

  if (index !== -1) {
    requests[index] = target;
  } else {
    requests = [target, ...requests];
  }
  saveWithdrawalRequestsToStorage(requests);

  // Sync to Firestore
  try {
    const docRef = doc(db, 'withdrawal_requests', requestId);
    await setDoc(
      docRef,
      {
        ...target,
        status: 'completed',
        updatedAt: now,
        adminNote: adminNote || 'টাকা সফলভাবে পাঠানো হয়েছে (Completed by admin)',
      },
      { merge: true }
    );
  } catch (fsErr) {
    console.warn('Could not update Firestore withdrawal status:', fsErr);
  }

  return { success: true, request: target };
}

// Reject withdrawal request: Admin rejects and automatically refunds the deducted balance back to user
export async function rejectManualWithdrawalRequest(
  requestId: string,
  reason = 'ভুল তথ্য বা একাউন্ট সংক্রান্ত সমস্যা'
): Promise<{ success: boolean; request?: ManualWithdrawalRequest; error?: string }> {
  let requests = getStoredWithdrawalRequests();
  let index = requests.findIndex((r) => r.id === requestId);
  let target: ManualWithdrawalRequest | null = index !== -1 ? requests[index] : null;

  if (!target) {
    try {
      const snap = await getDoc(doc(db, 'withdrawal_requests', requestId));
      if (snap.exists()) {
        target = snap.data() as ManualWithdrawalRequest;
        requests = [target, ...requests];
        index = 0;
      }
    } catch {}
  }

  if (!target) {
    return { success: false, error: 'উত্তোলন রিকোয়েস্টটি পাওয়া যায়নি।' };
  }

  if (target.status === 'rejected') {
    return { success: false, error: 'এই রিকোয়েস্টটি ইতিমধ্যে বাতিল করা হয়েছে।' };
  }

  const now = new Date().toISOString();
  target.status = 'rejected';
  target.rejectionReason = reason;
  target.updatedAt = now;

  if (index !== -1) {
    requests[index] = target;
  } else {
    requests = [target, ...requests];
  }
  saveWithdrawalRequestsToStorage(requests);

  // REFUND THE USER BALANCE!
  const refundedAmount = target.amount;
  const targetUserId = target.userId;
  const cleanPhone = (target.personalNumber || '').replace(/[^0-9]/g, '');

  // 1. Firestore user doc refund using findUserDocInFirestore
  let resolvedDocRef: any = null;
  try {
    const found = await findUserDocInFirestore({
      userId: targetUserId,
      senderPhone: cleanPhone,
      userCode: target.userCode,
    });

    if (found) {
      resolvedDocRef = found.ref;
      const curData = found.snap.data() || {};
      const curBalance = typeof curData.balance === 'number' ? curData.balance : 0;
      const newBalance = Math.round((curBalance + refundedAmount) * 100) / 100;

      await setDoc(
        resolvedDocRef,
        {
          balance: newBalance,
          updatedAt: now,
        },
        { merge: true }
      );
    }
  } catch (fsErr) {
    console.warn('Could not refund balance in Firestore:', fsErr);
  }

  // 2. Phone account in localStorage if exists on current device
  try {
    const rawAccounts = localStorage.getItem('aviator_phone_accounts_v1');
    if (rawAccounts) {
      const accounts = JSON.parse(rawAccounts);
      for (const phoneKey of Object.keys(accounts)) {
        if (
          accounts[phoneKey].uid === targetUserId ||
          accounts[phoneKey].phoneNumber === cleanPhone ||
          (resolvedDocRef && accounts[phoneKey].uid === resolvedDocRef.id)
        ) {
          accounts[phoneKey].balance = (accounts[phoneKey].balance || 0) + refundedAmount;
          accounts[phoneKey].updatedAt = now;
          localStorage.setItem('aviator_phone_accounts_v1', JSON.stringify(accounts));
          break;
        }
      }
    }
  } catch (err) {
    console.warn('Error refunding local phone account balance:', err);
  }

  // 3. Update Firestore record
  try {
    const docRef = doc(db, 'withdrawal_requests', requestId);
    await setDoc(
      docRef,
      {
        ...target,
        status: 'rejected',
        rejectionReason: reason,
        updatedAt: now,
      },
      { merge: true }
    );
  } catch (fsErr) {
    console.warn('Could not update Firestore rejection status:', fsErr);
  }

  // 4. Dispatch balance credited / refunded event for active session
  window.dispatchEvent(
    new CustomEvent('balance_credited', {
      detail: {
        userId: targetUserId,
        docId: resolvedDocRef ? resolvedDocRef.id : targetUserId,
        phone: cleanPhone,
        amount: refundedAmount,
        requestId,
      },
    })
  );

  return { success: true, request: target };
}

// Fetch all withdrawal requests from Firestore and merge
export async function syncWithdrawalRequestsFromFirestore(): Promise<ManualWithdrawalRequest[]> {
  try {
    const colRef = collection(db, 'withdrawal_requests');
    const q = query(colRef, limit(100));
    const snap = await getDocs(q);
    const remoteList: ManualWithdrawalRequest[] = [];
    snap.forEach((d) => {
      remoteList.push(d.data() as ManualWithdrawalRequest);
    });

    if (remoteList.length > 0) {
      const local = getStoredWithdrawalRequests();
      const map = new Map<string, ManualWithdrawalRequest>();
      local.forEach((r) => map.set(r.id, r));
      remoteList.forEach((r) => {
        const existing = map.get(r.id);
        if (!existing || new Date(r.updatedAt) >= new Date(existing.updatedAt)) {
          map.set(r.id, r);
        }
      });

      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      saveWithdrawalRequestsToStorage(merged);
      return merged;
    }
  } catch (err) {
    console.warn('Could not sync withdrawal requests from Firestore:', err);
  }
  return getStoredWithdrawalRequests();
}

// Real-time Firestore listener for all online deposit requests
export function listenToDepositRequests(
  callback: (requests: ManualDepositRequest[]) => void
): () => void {
  try {
    const colRef = collection(db, 'deposit_requests');
    const q = query(colRef, limit(200));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const remoteList: ManualDepositRequest[] = [];
        snapshot.forEach((d) => {
          remoteList.push(d.data() as ManualDepositRequest);
        });
        if (remoteList.length > 0) {
          const sorted = remoteList.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          saveDepositRequestsToStorage(sorted);
          callback(sorted);
        }
      },
      (error) => {
        console.warn('Realtime deposit requests listener error:', error);
      }
    );
    return unsubscribe;
  } catch (err) {
    console.warn('Could not set up deposit requests listener:', err);
    return () => {};
  }
}

// Real-time Firestore listener for all online withdrawal requests
export function listenToWithdrawalRequests(
  callback: (requests: ManualWithdrawalRequest[]) => void
): () => void {
  try {
    const colRef = collection(db, 'withdrawal_requests');
    const q = query(colRef, limit(200));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const remoteList: ManualWithdrawalRequest[] = [];
        snapshot.forEach((d) => {
          remoteList.push(d.data() as ManualWithdrawalRequest);
        });
        if (remoteList.length > 0) {
          const sorted = remoteList.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          saveWithdrawalRequestsToStorage(sorted);
          callback(sorted);
        }
      },
      (error) => {
        console.warn('Realtime withdrawal requests listener error:', error);
      }
    );
    return unsubscribe;
  } catch (err) {
    console.warn('Could not set up withdrawal requests listener:', err);
    return () => {};
  }
}

