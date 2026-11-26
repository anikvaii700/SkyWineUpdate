import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  limit,
  onSnapshot,
  addDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  ReferralRecord,
  getStoredPhoneAccounts,
  saveStoredPhoneAccounts,
  getStoredReferralRecords,
  saveReferralRecord,
} from './phoneAuth';

const PENDING_REF_STORAGE_KEY = 'skywin_pending_referral_code_v1';
const STORAGE_REFERRALS_KEY = 'aviator_referrals_records_v1';

/**
 * Capture ?ref= / ?invite= / ?code= from URL query parameters and persist in localStorage
 */
export function captureReferralCodeFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('ref') || params.get('invite') || params.get('code');
    if (raw && raw.trim().length >= 3) {
      const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      // Referral codes are not mobile numbers. Ignore stale ?ref= phone values.
      if (clean.length >= 3 && !/^01[0-9]{9}$/.test(clean) && !/^8801[0-9]{9}$/.test(clean)) {
        localStorage.setItem(PENDING_REF_STORAGE_KEY, clean);
        return clean;
      }
      localStorage.removeItem(PENDING_REF_STORAGE_KEY);
    }
  } catch (e) {
    console.warn('Could not read referral query param:', e);
  }
  return null;
}

/**
 * Retrieve any captured referral code from URL or localStorage
 */
export function getPendingReferralCode(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromUrl = captureReferralCodeFromUrl();
    if (fromUrl) return fromUrl;
    const stored = (localStorage.getItem(PENDING_REF_STORAGE_KEY) || '').trim().toUpperCase();
    if (/^01[0-9]{9}$/.test(stored) || /^8801[0-9]{9}$/.test(stored)) {
      localStorage.removeItem(PENDING_REF_STORAGE_KEY);
      return '';
    }
    return stored;
  } catch {
    return '';
  }
}

/**
 * Clear pending referral code after successful signup
 */
export function clearPendingReferralCode(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PENDING_REF_STORAGE_KEY);
  } catch {}
}

/**
 * Build shareable referral link for a user's referral code
 */
export function buildReferralLink(referralCode: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://skywinbd.app';
  return `${origin}/?ref=${encodeURIComponent(referralCode.trim().toUpperCase())}`;
}

export interface ResolvedReferrer {
  uid: string;
  userCode: string;
  phoneNumber: string;
  displayName: string;
}

/**
 * Look up a referrer by referral code, userCode, or phone number across both localStorage and Firestore.
 * Prevents self-referral using excludeUid / excludePhone.
 */
export async function findReferrerByCode(
  rawCode: string,
  excludeUid?: string,
  excludePhone?: string
): Promise<ResolvedReferrer | null> {
  const cleanCode = rawCode.trim().toUpperCase();
  if (!cleanCode || cleanCode.length < 3) return null;

  const cleanExcludePhone = (excludePhone || '').replace(/[^0-9]/g, '');
  const numericInput = cleanCode.replace(/[^0-9]/g, '');

  // 1. Check localStorage accounts first
  try {
    const accounts = getStoredPhoneAccounts();
    for (const key of Object.keys(accounts)) {
      const acc = accounts[key];
      const accPhone = (acc.phoneNumber || '').replace(/[^0-9]/g, '');
      const isSelf =
        (excludeUid && acc.uid === excludeUid) ||
        (cleanExcludePhone && accPhone && accPhone === cleanExcludePhone);
      if (isSelf) continue;

      if (
        acc.userCode?.toUpperCase() === cleanCode ||
        acc.referralCode?.toUpperCase() === cleanCode ||
        (numericInput.length >= 10 && accPhone === numericInput)
      ) {
        return {
          uid: acc.uid,
          userCode: acc.userCode || acc.referralCode || cleanCode,
          phoneNumber: acc.phoneNumber || '',
          displayName: acc.displayName || 'Player',
        };
      }
    }
  } catch {}

  // 2. Check Firestore users collection (supports cross-device referrals!)
  try {
    const usersCol = collection(db, 'users');

    // Query by referralCode
    const qRef = query(usersCol, where('referralCode', '==', cleanCode), limit(1));
    const snapRef = await getDocs(qRef);
    if (!snapRef.empty) {
      const d = snapRef.docs[0];
      const data = d.data();
      const uid = data.id || data.uid || d.id;
      const phone = (data.phoneNumber || '').replace(/[^0-9]/g, '');
      if (uid !== excludeUid && (!cleanExcludePhone || phone !== cleanExcludePhone)) {
        return {
          uid,
          userCode: data.userCode || data.referralCode || cleanCode,
          phoneNumber: phone,
          displayName: data.displayName || 'Player',
        };
      }
    }

    // Query by userCode
    const qUserCode = query(usersCol, where('userCode', '==', cleanCode), limit(1));
    const snapCode = await getDocs(qUserCode);
    if (!snapCode.empty) {
      const d = snapCode.docs[0];
      const data = d.data();
      const uid = data.id || data.uid || d.id;
      const phone = (data.phoneNumber || '').replace(/[^0-9]/g, '');
      if (uid !== excludeUid && (!cleanExcludePhone || phone !== cleanExcludePhone)) {
        return {
          uid,
          userCode: data.userCode || data.referralCode || cleanCode,
          phoneNumber: phone,
          displayName: data.displayName || 'Player',
        };
      }
    }

    // Query by phoneNumber if user entered phone number as referral code
    if (numericInput.length === 11) {
      const qPhone = query(usersCol, where('phoneNumber', '==', numericInput), limit(1));
      const snapPhone = await getDocs(qPhone);
      if (!snapPhone.empty) {
        const d = snapPhone.docs[0];
        const data = d.data();
        const uid = data.id || data.uid || d.id;
        const phone = (data.phoneNumber || '').replace(/[^0-9]/g, '');
        if (uid !== excludeUid && (!cleanExcludePhone || phone !== cleanExcludePhone)) {
          return {
            uid,
            userCode: data.userCode || data.referralCode || `USER-${phone.slice(-5)}`,
            phoneNumber: phone,
            displayName: data.displayName || 'Player',
          };
        }
      }
    }
  } catch (err) {
    console.warn('Could not search Firestore for referrer:', err);
  }

  return null;
}

/**
 * Record a new referral signup (status: 'pending_deposit', bonusAmount: 0).
 * The 100% Invite Bonus is credited automatically when the invited friend completes their first deposit.
 */
export async function registerReferralLinkage(params: {
  referrerUid: string;
  referrerCode: string;
  referredUid: string;
  referredUserCode: string;
  referredPhone: string;
  referredName: string;
}): Promise<ReferralRecord> {
  const now = new Date().toISOString();
  const recordId = `ref_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const record: ReferralRecord = {
    id: recordId,
    referrerUid: params.referrerUid,
    referrerCode: params.referrerCode.toUpperCase(),
    referredUid: params.referredUid,
    referredUserCode: params.referredUserCode.toUpperCase(),
    referredPhone: params.referredPhone || '',
    referredName: params.referredName || 'Player',
    firstDepositAmount: 0,
    bonusAmount: 0,
    status: 'pending_deposit',
    createdAt: now,
  };

  // 1. Save locally
  saveReferralRecord(record);

  // Increment referrer's referralCount in localStorage if present
  try {
    const accounts = getStoredPhoneAccounts();
    for (const key of Object.keys(accounts)) {
      if (
        accounts[key].uid === params.referrerUid ||
        accounts[key].userCode?.toUpperCase() === params.referrerCode.toUpperCase()
      ) {
        accounts[key].referralCount = (accounts[key].referralCount || 0) + 1;
        accounts[key].updatedAt = now;
        saveStoredPhoneAccounts(accounts);
        break;
      }
    }
  } catch {}

  // 2. Save to Firestore /referrals/{id} and increment referrer's referralCount in /users/{referrerUid}
  try {
    await setDoc(doc(db, 'referrals', recordId), record);
  } catch (err) {
    console.warn('Could not save referral record to Firestore:', err);
  }

  try {
    const refDoc = doc(db, 'users', params.referrerUid);
    const snap = await getDoc(refDoc);
    if (snap.exists()) {
      const curCount = typeof snap.data()?.referralCount === 'number' ? snap.data().referralCount : 0;
      await updateDoc(refDoc, {
        referralCount: curCount + 1,
        updatedAt: now,
      });
    }
  } catch (err) {
    console.warn('Could not increment referrer referralCount in Firestore:', err);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('referrals_updated'));
  }

  return record;
}

/**
 * Credit 100% Invite Bonus to the referrer when an invited friend completes their FIRST approved deposit.
 * Rule:
 * - Referrer receives exact 100% of the invited friend's first deposit amount.
 * - That bonus is added to balance, inviteBonusBalance, referralBonusEarned, AND lockedPrincipal.
 * - Strictly non-withdrawable AND non-profitable during gameplay!
 */
export async function creditFirstDepositInviteBonus(params: {
  depositorUid: string;
  depositorCode?: string;
  depositorPhone?: string;
  depositorName?: string;
  referredByCode?: string;
  referredByUid?: string;
  firstDepositAmount: number;
}): Promise<{
  credited: boolean;
  referrerUid?: string;
  referrerCode?: string;
  bonusAmount: number;
}> {
  const { getStoredAppControls } = await import('./appControlService');
  const controls = getStoredAppControls();
  if (!controls.inviteBonusEnabled) {
    return { credited: false, bonusAmount: 0 };
  }
  const pct = typeof controls.inviteBonusPercent === 'number' ? controls.inviteBonusPercent : 100;
  const amount = Math.max(0, Math.round(params.firstDepositAmount * (pct / 100) * 100) / 100);
  if (amount <= 0) return { credited: false, bonusAmount: 0 };
  if (!params.referredByCode && !params.referredByUid) {
    return { credited: false, bonusAmount: 0 };
  }

  const now = new Date().toISOString();
  let referrerUid = params.referredByUid || '';
  let referrerCode = (params.referredByCode || '').trim().toUpperCase();

  // Resolve referrer if UID is missing
  if (!referrerUid && referrerCode) {
    const resolved = await findReferrerByCode(referrerCode, params.depositorUid, params.depositorPhone);
    if (resolved) {
      referrerUid = resolved.uid;
      referrerCode = resolved.userCode;
    }
  }

  if (!referrerUid && !referrerCode) {
    return { credited: false, bonusAmount: 0 };
  }

  // Prevent self-referral reward
  if (referrerUid && referrerUid === params.depositorUid) {
    return { credited: false, bonusAmount: 0 };
  }

  // 1. Credit Referrer in Firestore
  let firestoreCredited = false;
  try {
    let refDocRef = referrerUid ? doc(db, 'users', referrerUid) : null;
    let refSnap = refDocRef ? await getDoc(refDocRef) : null;

    if ((!refSnap || !refSnap.exists()) && referrerCode) {
      const qCode = query(collection(db, 'users'), where('referralCode', '==', referrerCode), limit(1));
      const qSnap = await getDocs(qCode);
      if (!qSnap.empty) {
        refDocRef = qSnap.docs[0].ref;
        refSnap = qSnap.docs[0];
        referrerUid = refDocRef.id;
      }
    }

    if (refDocRef && refSnap && refSnap.exists()) {
      const data = refSnap.data() || {};
      const curBal = typeof data.balance === 'number' ? data.balance : 0;
      const curInviteBal = typeof data.inviteBonusBalance === 'number' ? data.inviteBonusBalance : 0;
      const curRefEarned = typeof data.referralBonusEarned === 'number' ? data.referralBonusEarned : 0;
      const curLocked = typeof data.lockedPrincipal === 'number' ? data.lockedPrincipal : 0;
      const welcome = typeof data.initialBonus === 'number' ? data.initialBonus : 100;
      const firstDepBonus = typeof data.firstDepositBonusEarned === 'number' ? data.firstDepositBonusEarned : 0;
      const rewardBonus = typeof data.rewardBonusEarned === 'number' ? data.rewardBonusEarned : 0;

      const nextBal = Math.round((curBal + amount) * 100) / 100;
      const nextInviteBal = Math.round((curInviteBal + amount) * 100) / 100;
      const nextRefEarned = Math.round((curRefEarned + amount) * 100) / 100;
      const nextLocked = Math.max(
        Math.round((curLocked + amount) * 100) / 100,
        Math.round((welcome + nextInviteBal + firstDepBonus + rewardBonus) * 100) / 100
      );

      await setDoc(
        refDocRef,
        {
          balance: nextBal,
          inviteBonusBalance: nextInviteBal,
          referralBonusEarned: nextRefEarned,
          lockedPrincipal: nextLocked,
          updatedAt: now,
        },
        { merge: true }
      );
      firestoreCredited = true;

      if (!referrerCode && data.userCode) {
        referrerCode = String(data.userCode).toUpperCase();
      }

      // Record transaction in referrer's subcollection
      try {
        await addDoc(collection(db, 'users', referrerUid, 'transactions'), {
          id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          userId: referrerUid,
          type: 'deposit',
          amount,
          method: 'bkash',
          accountNumber: 'INVITE_BONUS_100%',
          status: 'completed',
          trxId: `INV100-${(params.depositorCode || params.depositorUid.slice(-5)).toUpperCase()}`,
          note: `ইনভাইট বোনাস ১০০% (${params.depositorName || params.depositorCode || 'Invited Friend'} প্রথম ডিপোজিট ৳${amount})`,
          createdAt: now,
        });
      } catch {}
    }
  } catch (err) {
    console.warn('Could not credit referrer invite bonus in Firestore:', err);
  }

  // 2. Credit Referrer in localStorage phone accounts if present on current device
  let localCredited = false;
  try {
    const accounts = getStoredPhoneAccounts();
    for (const key of Object.keys(accounts)) {
      const acc = accounts[key];
      if (
        (referrerUid && acc.uid === referrerUid) ||
        (referrerCode &&
          (acc.userCode?.toUpperCase() === referrerCode || acc.referralCode?.toUpperCase() === referrerCode))
      ) {
        acc.balance = Math.round(((acc.balance || 0) + amount) * 100) / 100;
        acc.inviteBonusBalance = Math.round(((acc.inviteBonusBalance || 0) + amount) * 100) / 100;
        acc.referralBonusEarned = Math.round(((acc.referralBonusEarned || 0) + amount) * 100) / 100;
        const welcome = acc.initialBonus !== undefined ? acc.initialBonus : 100;
        const firstDepBonus = acc.firstDepositBonusEarned || 0;
        const rewardBonus = acc.rewardBonusEarned || 0;
        acc.lockedPrincipal = Math.max(
          Math.round(((acc.lockedPrincipal || 0) + amount) * 100) / 100,
          Math.round((welcome + acc.inviteBonusBalance + firstDepBonus + rewardBonus) * 100) / 100
        );
        acc.updatedAt = now;
        saveStoredPhoneAccounts(accounts);
        localCredited = true;
        if (!referrerUid) referrerUid = acc.uid;
        if (!referrerCode) referrerCode = acc.userCode;
        break;
      }
    }
  } catch (err) {
    console.warn('Could not credit local referrer invite bonus:', err);
  }

  if (!firestoreCredited && !localCredited) {
    return { credited: false, bonusAmount: 0 };
  }

  // 3. Update ReferralRecord in localStorage
  try {
    const records = getStoredReferralRecords();
    let foundIdx = records.findIndex(
      (r) =>
        (params.depositorUid && r.referredUid === params.depositorUid) ||
        (params.depositorCode && r.referredUserCode?.toUpperCase() === params.depositorCode.toUpperCase()) ||
        (params.depositorPhone && r.referredPhone === params.depositorPhone)
    );
    if (foundIdx !== -1) {
      records[foundIdx] = {
        ...records[foundIdx],
        firstDepositAmount: amount,
        bonusAmount: amount,
        status: 'rewarded',
        rewardedAt: now,
      };
      localStorage.setItem(STORAGE_REFERRALS_KEY, JSON.stringify(records));
    } else {
      saveReferralRecord({
        id: `ref_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        referrerUid,
        referrerCode,
        referredUid: params.depositorUid,
        referredUserCode: params.depositorCode || params.depositorUid.slice(-6).toUpperCase(),
        referredPhone: params.depositorPhone || '',
        referredName: params.depositorName || 'Invited Friend',
        firstDepositAmount: amount,
        bonusAmount: amount,
        status: 'rewarded',
        createdAt: now,
        rewardedAt: now,
      });
    }
  } catch {}

  // 4. Update ReferralRecord in Firestore /referrals
  try {
    const refCol = collection(db, 'referrals');
    let updatedRemote = false;

    if (params.depositorUid) {
      const qByUid = query(refCol, where('referredUid', '==', params.depositorUid), limit(1));
      const snap = await getDocs(qByUid);
      if (!snap.empty) {
        await updateDoc(snap.docs[0].ref, {
          firstDepositAmount: amount,
          bonusAmount: amount,
          status: 'rewarded',
          rewardedAt: now,
        });
        updatedRemote = true;
      }
    }

    if (!updatedRemote && params.depositorCode) {
      const qByCode = query(
        refCol,
        where('referredUserCode', '==', params.depositorCode.toUpperCase()),
        limit(1)
      );
      const snap = await getDocs(qByCode);
      if (!snap.empty) {
        await updateDoc(snap.docs[0].ref, {
          firstDepositAmount: amount,
          bonusAmount: amount,
          status: 'rewarded',
          rewardedAt: now,
        });
        updatedRemote = true;
      }
    }

    if (!updatedRemote) {
      const newRecId = `ref_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await setDoc(doc(db, 'referrals', newRecId), {
        id: newRecId,
        referrerUid,
        referrerCode,
        referredUid: params.depositorUid,
        referredUserCode: (params.depositorCode || params.depositorUid.slice(-6)).toUpperCase(),
        referredPhone: params.depositorPhone || '',
        referredName: params.depositorName || 'Invited Friend',
        firstDepositAmount: amount,
        bonusAmount: amount,
        status: 'rewarded',
        createdAt: now,
        rewardedAt: now,
      });
    }
  } catch (err) {
    console.warn('Could not update referral record in Firestore:', err);
  }

  // 5. Notify active UI session
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('referrals_updated'));
    window.dispatchEvent(
      new CustomEvent('invite_bonus_credited', {
        detail: {
          referrerUid,
          referrerCode,
          bonusAmount: amount,
          depositorName: params.depositorName || params.depositorCode || 'বন্ধু',
        },
      })
    );
  }

  return {
    credited: true,
    referrerUid,
    referrerCode,
    bonusAmount: amount,
  };
}

/**
 * Real-time listener for referrals belonging to a specific referrer (merges Firestore + localStorage)
 */
export function listenToUserReferrals(
  referrerCode: string,
  referrerUid: string | undefined,
  callback: (records: ReferralRecord[]) => void
): () => void {
  const cleanCode = (referrerCode || '').trim().toUpperCase();

  const getLocal = (): ReferralRecord[] => {
    const all = getStoredReferralRecords();
    return all.filter(
      (r) =>
        (cleanCode && r.referrerCode?.toUpperCase() === cleanCode) ||
        (referrerUid && r.referrerUid === referrerUid)
    );
  };

  // Deliver local records immediately
  callback(getLocal());

  if (!cleanCode && !referrerUid) {
    return () => {};
  }

  try {
    const colRef = collection(db, 'referrals');
    const q = cleanCode
      ? query(colRef, where('referrerCode', '==', cleanCode), limit(100))
      : query(colRef, where('referrerUid', '==', referrerUid), limit(100));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const remote: ReferralRecord[] = [];
        snapshot.forEach((d) => {
          remote.push(d.data() as ReferralRecord);
        });

        const local = getLocal();
        const map = new Map<string, ReferralRecord>();
        local.forEach((r) => map.set(r.id, r));
        remote.forEach((r) => map.set(r.id, r));

        const merged = Array.from(map.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        callback(merged);
      },
      (err) => {
        console.warn('Realtime referrals listener error:', err);
      }
    );

    return unsub;
  } catch (err) {
    console.warn('Could not attach referrals listener:', err);
    return () => {};
  }
}

/**
 * Compute how much of a placed bet stake is funded by Invite Bonus balance.
 * Rule:
 * - If user has no invite bonus balance -> 0.
 * - If user has never deposited (only bonus funds) -> stake draws from inviteBonusBalance first.
 * - If user has deposited -> any portion of stake exceeding (totalBalance - inviteBonusBalance) draws from inviteBonusBalance.
 */
export function computeInviteBonusStake(params: {
  totalBalance: number;
  inviteBonusBalance: number;
  stake: number;
  hasDeposited: boolean;
}): number {
  const invBal = Math.max(0, params.inviteBonusBalance || 0);
  const stake = Math.max(0, params.stake || 0);
  if (invBal <= 0 || stake <= 0) return 0;

  if (!params.hasDeposited) {
    return Math.round(Math.min(invBal, stake) * 100) / 100;
  }

  const nonInviteBalance = Math.max(0, (params.totalBalance || 0) - invBal);
  if (stake > nonInviteBalance) {
    const overage = stake - nonInviteBalance;
    return Math.round(Math.min(invBal, overage) * 100) / 100;
  }

  return 0;
}

/**
 * Persist updated inviteBonusBalance (and lockedPrincipal delta) to both localStorage and Firestore
 */
export function syncInviteBonusBalance(
  uid: string,
  newInviteBonusBalance: number,
  lockedDelta: number = 0
): void {
  if (!uid || uid.startsWith('guest')) return;
  const safeInvite = Math.max(0, Math.round(newInviteBonusBalance * 100) / 100);
  const now = new Date().toISOString();

  // 1. Update localStorage phone account if present
  try {
    const accounts = getStoredPhoneAccounts();
    for (const key of Object.keys(accounts)) {
      if (accounts[key].uid === uid) {
        accounts[key].inviteBonusBalance = safeInvite;
        if (lockedDelta !== 0) {
          const welcome = accounts[key].initialBonus !== undefined ? accounts[key].initialBonus : 100;
          const firstDep = accounts[key].firstDepositBonusEarned || 0;
          const rewards = accounts[key].rewardBonusEarned || 0;
          const minLocked = welcome + safeInvite + firstDep + rewards;
          const nextLocked = Math.max(minLocked, (accounts[key].lockedPrincipal || 0) + lockedDelta);
          accounts[key].lockedPrincipal = Math.max(0, Math.round(nextLocked * 100) / 100);
        }
        accounts[key].updatedAt = now;
        saveStoredPhoneAccounts(accounts);
        break;
      }
    }
  } catch {}

  // 2. Sync to Firestore
  try {
    const userRef = doc(db, 'users', uid);
    if (lockedDelta !== 0) {
      getDoc(userRef)
        .then((snap) => {
          if (!snap.exists()) return;
          const d = snap.data() || {};
          const welcome = typeof d.initialBonus === 'number' ? d.initialBonus : 100;
          const firstDep = typeof d.firstDepositBonusEarned === 'number' ? d.firstDepositBonusEarned : 0;
          const rewards = typeof d.rewardBonusEarned === 'number' ? d.rewardBonusEarned : 0;
          const curLocked = typeof d.lockedPrincipal === 'number' ? d.lockedPrincipal : 0;
          const minLocked = welcome + safeInvite + firstDep + rewards;
          const nextLocked = Math.max(minLocked, Math.round((curLocked + lockedDelta) * 100) / 100);
          return updateDoc(userRef, {
            inviteBonusBalance: safeInvite,
            lockedPrincipal: nextLocked,
            updatedAt: now,
          });
        })
        .catch(() => {});
    } else {
      updateDoc(userRef, {
        inviteBonusBalance: safeInvite,
        updatedAt: now,
      }).catch(() => {});
    }
  } catch {}
}
