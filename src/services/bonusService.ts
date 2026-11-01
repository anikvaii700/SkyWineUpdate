/**
 * src/services/bonusService.ts
 * Complete Bonus Engine for SkyWin BD:
 * 1. Daily Open Bonus: 50 BDT once per day upon opening the app.
 * 2. 7-Day Streak Bonus: 300 BDT weekly bonus for keeping the app open for at least 5 minutes
 *    daily for 7 consecutive days without missing a single day.
 * 3. Daily Lucky Spinner: Casino-style spinning wheel with prizes 10 - 50 BDT, heavily weighted
 *    towards 50 BDT (~75%+ chance of winning 50 BDT).
 */

export interface WheelSector {
  id: number;
  amount: number;
  label: string;
  subLabel?: string;
  color: string;
  textColor: string;
  secondaryColor?: string;
  weight: number; // probability weight
  isSpecial?: boolean;
}

// 10 sectors: 20, 30, 50, 100, 200 winnable. 500, 300, 1000 and iPhone 17 Pro Max are visual teasers (weight 0)
export const WHEEL_SECTORS: WheelSector[] = [
  { id: 0, amount: 20, label: '৳২০', color: '#8b5cf6', textColor: '#ffffff', secondaryColor: '#7c3aed', weight: 25 },
  { id: 1, amount: 500, label: '৳৫০০', color: '#f59e0b', textColor: '#000000', secondaryColor: '#d97706', weight: 0 },
  { id: 2, amount: 50, label: '৳৫০', color: '#10b981', textColor: '#ffffff', secondaryColor: '#059669', weight: 25 },
  { id: 3, amount: 1000, label: '৳১০০০', color: '#ec4899', textColor: '#ffffff', secondaryColor: '#db2777', weight: 0 },
  { id: 4, amount: 100, label: '৳১০০', color: '#06b6d4', textColor: '#ffffff', secondaryColor: '#0891b2', weight: 20 },
  { id: 5, amount: 0, label: 'iPhone 17', subLabel: 'Pro Max', color: '#eab308', textColor: '#000000', secondaryColor: '#ca8a04', weight: 0, isSpecial: true },
  { id: 6, amount: 50, label: '৳৫০', color: '#e11d48', textColor: '#ffffff', secondaryColor: '#be123c', weight: 25 },
  { id: 7, amount: 200, label: '৳২০০', color: '#3b82f6', textColor: '#ffffff', secondaryColor: '#2563eb', weight: 15 },
  { id: 8, amount: 30, label: '৳৩০', color: '#a855f7', textColor: '#ffffff', secondaryColor: '#9333ea', weight: 25 },
  { id: 9, amount: 300, label: '৳৩০০', color: '#14b8a6', textColor: '#ffffff', secondaryColor: '#0d9488', weight: 0 },
];

export interface BonusState {
  // 1. Daily Open Bonus (50৳)
  lastDailyBonusDate: string; // YYYY-MM-DD
  totalDailyBonusesClaimed: number;

  // 2. 7-Day Consecutive Streak Bonus (500৳)
  streakCount: number; // 0 to 7
  lastStreakQualifiedDate: string; // YYYY-MM-DD
  todayDate: string; // YYYY-MM-DD
  todaySecondsSpent: number; // 0 to 300 (5 minutes = 300 seconds)
  todayQualified: boolean; // true once todaySecondsSpent >= 300
  weeklyBonusesAwarded: number;

  // 3. Daily Lucky Spinner
  lastSpinDate: string; // YYYY-MM-DD
  totalSpins: number;
  lastWonAmount: number | null;
}

const STORAGE_BONUS_KEY_PREFIX = 'skywin_bonus_state_v1_';
export const TARGET_STREAK_SECONDS = 300; // 5 minutes required daily

/**
 * Returns formatted YYYY-MM-DD string according to local time
 */
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns yesterday's YYYY-MM-DD string
 */
export function getYesterdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateString(d);
}

/**
 * Compute the key for a specific user ID or guest
 */
function getStorageKey(userId?: string): string {
  const cleanId = (userId || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${STORAGE_BONUS_KEY_PREFIX}${cleanId}`;
}

/**
 * Default clean initial state
 */
export function createInitialBonusState(): BonusState {
  return {
    lastDailyBonusDate: '',
    totalDailyBonusesClaimed: 0,
    streakCount: 0,
    lastStreakQualifiedDate: '',
    todayDate: getLocalDateString(),
    todaySecondsSpent: 0,
    todayQualified: false,
    weeklyBonusesAwarded: 0,
    lastSpinDate: '',
    totalSpins: 0,
    lastWonAmount: null,
  };
}

/**
 * Load bonus state for a user with automatic daily rollovers & streak continuity check
 */
export function loadBonusState(userId?: string): BonusState {
  const key = getStorageKey(userId);
  const today = getLocalDateString();
  const yesterday = getYesterdayDateString();

  let state: BonusState;
  try {
    const raw = localStorage.getItem(key);
    state = raw ? JSON.parse(raw) : createInitialBonusState();
  } catch {
    state = createInitialBonusState();
  }

  // Handle midnight/daily rollover
  if (state.todayDate !== today) {
    // If user's last qualified streak day was NOT yesterday (and not today), streak was broken!
    if (state.lastStreakQualifiedDate && state.lastStreakQualifiedDate !== yesterday && state.lastStreakQualifiedDate !== today) {
      // Streak broken due to missing a day!
      state.streakCount = 0;
    }
    state.todayDate = today;
    state.todaySecondsSpent = 0;
    state.todayQualified = false;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }

  return state;
}

/**
 * Save bonus state to localStorage and broadcast event asynchronously
 */
export function saveBonusState(state: BonusState, userId?: string): void {
  try {
    const key = getStorageKey(userId);
    localStorage.setItem(key, JSON.stringify(state));
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        try {
          window.dispatchEvent(new CustomEvent('skywin_bonus_state_updated', { detail: state }));
        } catch {}
      }, 0);
    }
  } catch (e) {
    console.warn('Failed to save bonus state:', e);
  }
}

/**
 * Check if the Daily Open Bonus is available to claim today
 * Note: Deprecated per user requirement (only 7-day streak 500 BDT and lucky spinner apply)
 */
export function isDailyBonusAvailable(_userId?: string): boolean {
  return false;
}

/**
 * Claim the 50 BDT Daily Open Bonus
 */
export function claimDailyOpenBonus(userId?: string): { success: boolean; amount: number; message: string; state: BonusState } {
  const state = loadBonusState(userId);
  const today = getLocalDateString();

  if (state.lastDailyBonusDate === today) {
    return {
      success: false,
      amount: 0,
      message: 'আজকের ৫০৳ ডেইলি ওপেন বোনাস ইতোমধ্যে গ্রহণ করেছেন। আগামীকাল আবার পাবেন!',
      state,
    };
  }

  const bonusAmount = 50;
  state.lastDailyBonusDate = today;
  state.totalDailyBonusesClaimed += 1;
  saveBonusState(state, userId);

  return {
    success: true,
    amount: bonusAmount,
    message: 'অভিনন্দন! আজকের ৫০৳ ডেইলি ওপেন বোনাস আপনার ব্যালেন্সে যোগ হয়েছে!',
    state,
  };
}

/**
 * Record time spent on app (called every 1s when document is active/focused)
 * Automatically marks today's qualification when 5 minutes (300s) is reached.
 * Automatically awards 300৳ Weekly Streak Bonus when 7 consecutive days are completed!
 */
export function recordActiveTime(
  secondsToAdd: number = 1,
  userId?: string
): {
  state: BonusState;
  justQualifiedToday: boolean;
  justWonWeekly: boolean;
  weeklyAmount: number;
} {
  const state = loadBonusState(userId);
  const today = getLocalDateString();
  const yesterday = getYesterdayDateString();

  state.todaySecondsSpent = Math.min(TARGET_STREAK_SECONDS, (state.todaySecondsSpent || 0) + secondsToAdd);

  let justQualifiedToday = false;
  let justWonWeekly = false;
  const weeklyAmount = 500; // 500 BDT for 7-day streak!

  // Check if 5 minutes is reached
  if (state.todaySecondsSpent >= TARGET_STREAK_SECONDS && !state.todayQualified) {
    state.todayQualified = true;
    justQualifiedToday = true;

    // Check streak logic:
    if (state.lastStreakQualifiedDate === yesterday) {
      state.streakCount = Math.min(7, (state.streakCount || 0) + 1);
    } else if (state.lastStreakQualifiedDate === today) {
      // already counted
    } else {
      // New streak start
      state.streakCount = 1;
    }
    state.lastStreakQualifiedDate = today;

    // If 7 days streak reached:
    if (state.streakCount >= 7) {
      justWonWeekly = true;
      state.weeklyBonusesAwarded = (state.weeklyBonusesAwarded || 0) + 1;
      // Streak completes, reset for next 7-day cycle!
      state.streakCount = 0;
    }

    saveBonusState(state, userId);
  } else {
    // Save updated seconds count
    saveBonusState(state, userId);
  }

  return {
    state,
    justQualifiedToday,
    justWonWeekly,
    weeklyAmount,
  };
}

/**
 * Check if the Lucky Spinner is available to spin today
 */
export function isSpinAvailable(userId?: string): boolean {
  const state = loadBonusState(userId);
  const today = getLocalDateString();
  return state.lastSpinDate !== today;
}

/**
 * Execute Lucky Spin
/**
 * Execute Lucky Spin
 * Per user instruction:
 * 1. 500 BDT, 300 BDT, 1000 BDT, and iPhone 17 Pro Max are NEVER won (weight: 0).
 * 2. Winnable prizes: 20 BDT, 30 BDT, 50 BDT, 100 BDT, 200 BDT.
 * 3. "একেকদিন একেকটা": Rotating/varying prizes across consecutive days so the user doesn't get the same number repeatedly.
 * 4. iPhone 17 Pro Max near-miss teaser: pointer decelerates right over iPhone before ticking into the winning sector.
 */
export function executeLuckySpin(userId?: string): {
  amount: number;
  sectorIndex: number;
  sector: WheelSector;
  state: BonusState;
  nearMissIPhone?: boolean;
} {
  const state = loadBonusState(userId);
  const today = getLocalDateString();

  // All winnable sectors (strictly excluding 500, 300, 1000, and iPhone 17 Pro Max)
  const winnableIndices = WHEEL_SECTORS.map((s, idx) => ({ ...s, originalIndex: idx })).filter(
    (s) => s.weight > 0 && s.amount !== 500 && s.amount !== 300 && s.amount !== 1000 && !s.isSpecial
  );

  // Requirement: "একেকদিন একেকটা" (ensure day-to-day variety across 20, 30, 50, 100, 200 BDT)
  // Exclude yesterday's won amount so today provides a different winnable prize!
  const lastAmount = state.lastWonAmount;
  let candidates = winnableIndices.filter((s) => s.amount !== lastAmount);
  if (candidates.length === 0) {
    candidates = winnableIndices;
  }

  // Weighted random pick among candidates
  const totalWeight = candidates.reduce((acc, s) => acc + s.weight, 0);
  let randomVal = Math.random() * totalWeight;
  let selectedItem = candidates[0];

  for (let i = 0; i < candidates.length; i++) {
    if (randomVal < candidates[i].weight) {
      selectedItem = candidates[i];
      break;
    }
    randomVal -= candidates[i].weight;
  }

  let selectedIndex = selectedItem.originalIndex;
  let nearMissIPhone = false;

  // If the chosen prize is 50 or 100 BDT (adjacent to Sector 5 iPhone 17 Pro Max),
  // trigger the thrilling iPhone 17 Pro Max near-miss:
  if (selectedItem.amount === 50 && WHEEL_SECTORS[6]) {
    selectedIndex = 6; // Sector 6: ৳৫০ right next to Sector 5 iPhone!
    nearMissIPhone = true;
  } else if (selectedItem.amount === 100 && WHEEL_SECTORS[4]) {
    selectedIndex = 4; // Sector 4: ৳১০০ right next to Sector 5 iPhone!
    nearMissIPhone = true;
  }

  const selectedSector = WHEEL_SECTORS[selectedIndex];
  state.lastSpinDate = today;
  state.totalSpins = (state.totalSpins || 0) + 1;
  state.lastWonAmount = selectedSector.amount;

  saveBonusState(state, userId);

  return {
    amount: selectedSector.amount,
    sectorIndex: selectedIndex,
    sector: selectedSector,
    state,
    nearMissIPhone,
  };
}

/**
 * Format remaining seconds into MM:SS
 */
export function formatTimeMMSS(seconds: number): string {
  const safeSec = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safeSec / 60);
  const s = safeSec % 60;
  return `${m} মিনিট ${s < 10 ? '0' : ''}${s} সেকেন্ড`;
}
