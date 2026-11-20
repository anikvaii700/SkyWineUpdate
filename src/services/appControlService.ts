import { db } from './firebase';
import { doc, getDoc, setDoc, onSnapshot, collection } from 'firebase/firestore';
import { ReferralRecord, getStoredReferralRecords } from './phoneAuth';

export type AviatorHouseMode = 'strict' | 'balanced' | 'relaxed';

export interface AppControlConfig {
  // Global Maintenance & Access
  maintenanceMode: boolean;
  maintenanceMessage: string;
  registrationEnabled: boolean;
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;

  // Game Toggles & Features
  aviatorEnabled: boolean;
  wingoEnabled: boolean;
  aiPredictorEnabled: boolean;
  dailyBonusEnabled: boolean;
  luckySpinnerEnabled: boolean;

  // Aviator & Wingo Live Engine Controls
  aviatorHouseMode: AviatorHouseMode;
  aviatorForceCrashMultiplier: number | null; // One-shot override for next Aviator round (null = auto)
  wingoForceNumber: number | null; // One-shot override 0-9 for next Wingo round (null = auto)

  // Deposit & Withdrawal Limits
  minDepositAmount: number;
  maxDepositAmount: number;
  minWithdrawAmount: number;
  maxWithdrawAmount: number;

  // Bonus & Invite 100% Controls
  inviteBonusEnabled: boolean;
  inviteBonusPercent: number; // Default 100%
  signupBonusAmount: number; // Default 100 BDT

  updatedAt?: string;
}

const STORAGE_CONTROLS_KEY = 'skywin_app_controls_v1';

export const DEFAULT_APP_CONTROLS: AppControlConfig = {
  maintenanceMode: false,
  maintenanceMessage:
    'সিস্টেম আপগ্রেড ও রক্ষণাবেক্ষণের কাজ চলছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।',
  registrationEnabled: true,
  depositsEnabled: true,
  withdrawalsEnabled: true,

  aviatorEnabled: true,
  wingoEnabled: true,
  aiPredictorEnabled: true,
  dailyBonusEnabled: true,
  luckySpinnerEnabled: true,

  aviatorHouseMode: 'balanced',
  aviatorForceCrashMultiplier: null,
  wingoForceNumber: null,

  minDepositAmount: 100,
  maxDepositAmount: 50000,
  minWithdrawAmount: 500,
  maxWithdrawAmount: 50000,

  inviteBonusEnabled: true,
  inviteBonusPercent: 100,
  signupBonusAmount: 100,
};

export function getStoredAppControls(): AppControlConfig {
  try {
    const raw = localStorage.getItem(STORAGE_CONTROLS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_APP_CONTROLS,
        ...parsed,
      };
    }
  } catch {}
  return { ...DEFAULT_APP_CONTROLS };
}

export async function saveAppControls(config: AppControlConfig): Promise<AppControlConfig> {
  const normalized: AppControlConfig = {
    ...DEFAULT_APP_CONTROLS,
    ...config,
    minDepositAmount: Math.max(10, Number(config.minDepositAmount) || 100),
    maxDepositAmount: Math.max(500, Number(config.maxDepositAmount) || 50000),
    minWithdrawAmount: Math.max(50, Number(config.minWithdrawAmount) || 500),
    maxWithdrawAmount: Math.max(500, Number(config.maxWithdrawAmount) || 50000),
    inviteBonusPercent: Math.max(0, Math.min(500, Number(config.inviteBonusPercent) ?? 100)),
    signupBonusAmount: Math.max(0, Math.min(5000, Number(config.signupBonusAmount) ?? 100)),
    aviatorForceCrashMultiplier:
      config.aviatorForceCrashMultiplier !== null &&
      Number.isFinite(Number(config.aviatorForceCrashMultiplier))
        ? Math.min(100, Math.max(1.0, Math.round(Number(config.aviatorForceCrashMultiplier) * 100) / 100))
        : null,
    wingoForceNumber:
      config.wingoForceNumber !== null &&
      Number.isInteger(Number(config.wingoForceNumber)) &&
      Number(config.wingoForceNumber) >= 0 &&
      Number(config.wingoForceNumber) <= 9
        ? Number(config.wingoForceNumber)
        : null,
    updatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(STORAGE_CONTROLS_KEY, JSON.stringify(normalized));
  } catch {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app_controls_updated', { detail: normalized }));
  }

  try {
    await setDoc(doc(db, 'system', 'app_controls'), normalized, { merge: true });
  } catch (err) {
    console.warn('Could not sync app controls to Firestore:', err);
  }

  return normalized;
}

export async function syncAppControlsFromFirestore(): Promise<AppControlConfig> {
  try {
    const snap = await getDoc(doc(db, 'system', 'app_controls'));
    if (snap.exists()) {
      const merged: AppControlConfig = {
        ...DEFAULT_APP_CONTROLS,
        ...(snap.data() as Partial<AppControlConfig>),
      };
      try {
        localStorage.setItem(STORAGE_CONTROLS_KEY, JSON.stringify(merged));
      } catch {}
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app_controls_updated', { detail: merged }));
      }
      return merged;
    }
  } catch (err) {
    console.warn('Could not fetch app controls from Firestore:', err);
  }
  return getStoredAppControls();
}

export function subscribeToAppControls(
  callback: (config: AppControlConfig) => void
): () => void {
  callback(getStoredAppControls());

  const handleLocal = (e: Event) => {
    const custom = e as CustomEvent<AppControlConfig>;
    callback(custom.detail || getStoredAppControls());
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('app_controls_updated', handleLocal);
  }

  let unsubFirestore: (() => void) | null = null;
  try {
    unsubFirestore = onSnapshot(
      doc(db, 'system', 'app_controls'),
      (snap) => {
        if (snap.exists()) {
          const merged: AppControlConfig = {
            ...DEFAULT_APP_CONTROLS,
            ...(snap.data() as Partial<AppControlConfig>),
          };
          try {
            localStorage.setItem(STORAGE_CONTROLS_KEY, JSON.stringify(merged));
          } catch {}
          callback(merged);
        }
      },
      (err) => {
        console.warn('App controls onSnapshot error:', err);
      }
    );
  } catch {}

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('app_controls_updated', handleLocal);
    }
    if (unsubFirestore) unsubFirestore();
  };
}

export async function clearAviatorForceCrash(): Promise<void> {
  const current = getStoredAppControls();
  if (current.aviatorForceCrashMultiplier === null) return;
  await saveAppControls({ ...current, aviatorForceCrashMultiplier: null });
}

export async function clearWingoForceNumber(): Promise<void> {
  const current = getStoredAppControls();
  if (current.wingoForceNumber === null) return;
  await saveAppControls({ ...current, wingoForceNumber: null });
}

/**
 * Real-time listener for ALL referrals across Firestore + localStorage (Admin Referral Monitor)
 */
export function listenToAllReferralsForAdmin(
  callback: (records: ReferralRecord[]) => void
): () => void {
  const emitMerged = (remote: ReferralRecord[] = []) => {
    const local = getStoredReferralRecords();
    const map = new Map<string, ReferralRecord>();
    local.forEach((r) => map.set(r.id, r));
    remote.forEach((r) => map.set(r.id, r));
    const sorted = Array.from(map.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    callback(sorted);
  };

  emitMerged([]);

  const handleLocal = () => emitMerged([]);
  if (typeof window !== 'undefined') {
    window.addEventListener('referrals_updated', handleLocal);
  }

  let unsub: (() => void) | null = null;
  try {
    unsub = onSnapshot(
      collection(db, 'referrals'),
      (snap) => {
        const remote: ReferralRecord[] = [];
        snap.forEach((d) => remote.push(d.data() as ReferralRecord));
        emitMerged(remote);
      },
      (err) => {
        console.warn('Admin referrals listener error:', err);
      }
    );
  } catch {}

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('referrals_updated', handleLocal);
    }
    if (unsub) unsub();
  };
}
