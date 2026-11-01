import React, { useRef } from 'react';
import { Menu, Volume2, VolumeX, Gift } from 'lucide-react';
import { translations, Language } from '../utils/i18n';
import { UserWalletProfile } from '../services/firebase';
import { AppUser } from '../services/phoneAuth';
import { soundManager } from '../services/audio';
import { isUserAdminAccount } from '../services/adminAuth';

interface HeaderProps {
  balance: number;
  currentUser: AppUser | null;
  userProfile?: UserWalletProfile | null;
  onOpenMenu: () => void;
  onOpenAuth: () => void;
  onOpenDeposit: () => void;
  onOpenWithdraw: () => void;
  onOpenRules: () => void;
  onOpenAdmin: () => void;
  onOpenBonusHub?: () => void;
  hasUnclaimedBonus?: boolean;
  pendingDepositCount?: number;
  isMuted: boolean;
  onToggleSound: () => void;
  lang: Language;
  onToggleLang: () => void;
  isPredictorOpen: boolean;
  onTogglePredictor: () => void;
  onOpenInstallModal?: () => void;
  isAppInstalled?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  balance,
  currentUser,
  onOpenMenu,
  onOpenDeposit,
  onOpenAdmin,
  onOpenBonusHub,
  hasUnclaimedBonus = false,
  isMuted,
  onToggleSound,
}) => {
  // Stealth method: Tap the SkyWin brand logo 5 times to open Admin Panel
  // STRICT: Only allowed if logged in as 01743224700. For everyone else, zero hint or access.
  const logoClicksRef = useRef<number>(0);
  const lastClickTimeRef = useRef<number>(0);
  const isAdmin = isUserAdminAccount(currentUser?.phoneNumber);

  const handleLogoClick = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // If not the authorized admin 01743224700, behave as ordinary tap with zero admin logic
    if (!isAdmin) {
      soundManager.playClick();
      return;
    }

    const now = Date.now();
    const isFastClick = now - lastClickTimeRef.current < 2500;
    const nextCount = isFastClick ? logoClicksRef.current + 1 : 1;
    logoClicksRef.current = nextCount;
    lastClickTimeRef.current = now;

    if (nextCount >= 5) {
      logoClicksRef.current = 0;
      soundManager.playWin();
      onOpenAdmin();
    } else {
      soundManager.playClick();
    }
  };

  return (
    <header className="w-full bg-[#111622] border-b border-[#1e2638] px-2 sm:px-3 py-2 flex items-center justify-between text-white shadow-md z-30 relative select-none box-border">
      {/* Left / Middle Group: Hamburger Menu, SkyWin Brand, বোনাস, মাইক (Cleanly spaced with gap-2 sm:gap-2.5) */}
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink-0">
        {/* 1. Mobile 3-Line Menu Drawer Trigger */}
        <button
          onClick={() => {
            soundManager.playClick();
            onOpenMenu();
          }}
          aria-label="মোবাইল মেনু (Menu)"
          title="মেনু খুলুন"
          className="w-8 h-8 rounded-xl bg-[#161d2d] hover:bg-[#202b40] active:scale-90 border border-[#232e44] text-slate-200 hover:text-white transition-all cursor-pointer flex items-center justify-center shadow-sm shrink-0"
        >
          <Menu className="w-4.5 h-4.5 text-white stroke-[2.5]" />
        </button>

        {/* 2. SkyWin Brand / Logo (Tap 5 times for Admin) */}
        <div 
          onClick={handleLogoClick}
          className="flex items-center gap-1 cursor-pointer select-none active:scale-95 transition-transform relative touch-manipulation shrink-0"
          style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
          data-no-exit="true"
          title="SkyWin BD"
        >
          <span className="text-base sm:text-xl font-black italic tracking-tight text-white drop-shadow-[0_2px_8px_rgba(255,43,54,0.5)] select-none pointer-events-none flex items-center gap-1">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF2B36] via-[#FF5E62] to-[#FF9900]">SkyWin</span>
            <span className="text-[9px] sm:text-[10px] font-black text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1 py-0.2 rounded not-italic tracking-normal">BD</span>
          </span>
        </div>

        {/* 3. বোনাস (Bonus Hub: Daily Bonus & Lucky Spin) */}
        {onOpenBonusHub && (
          <button
            onClick={() => {
              soundManager.playClick();
              onOpenBonusHub();
            }}
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-full text-[11px] font-bold transition-all shadow-sm cursor-pointer bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/40 text-amber-300 hover:text-white hover:from-amber-500/30 hover:to-orange-500/30 active:scale-95 relative shrink-0"
            title="ডেইলি বোনাস ও লাকি স্পিন (Daily Bonus & Lucky Spin)"
          >
            <Gift className="w-3.5 h-3.5 text-amber-400 animate-bounce shrink-0" />
            <span className="font-extrabold text-[11px] tracking-tight">বোনাস</span>
            {hasUnclaimedBonus && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping absolute -top-0.5 -right-0.5" />
            )}
          </button>
        )}

        {/* 4. মাইক (Speaker / Sound On/Off Toggle) */}
        <button
          onClick={() => {
            soundManager.playClick();
            onToggleSound();
          }}
          aria-label={isMuted ? 'মাইক / সাউন্ড চালু করুন (Unmute)' : 'মাইক / সাউন্ড বন্ধ করুন (Mute)'}
          title={isMuted ? 'মাইক / সাউন্ড বন্ধ আছে - চালু করতে চাপুন' : 'মাইক / সাউন্ড চালু আছে - বন্ধ করতে চাপুন'}
          className={`w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-full border transition-all cursor-pointer flex items-center justify-center active:scale-90 shadow-md shrink-0 ${
            isMuted
              ? 'bg-gradient-to-br from-rose-600 via-rose-500 to-red-600 border-rose-300/80 text-white shadow-rose-900/40'
              : 'bg-gradient-to-br from-emerald-600 via-emerald-500 to-green-600 border-emerald-300/80 text-white shadow-emerald-900/40'
          }`}
        >
          {isMuted ? (
            <VolumeX className="w-3.5 h-3.5 text-white drop-shadow-xs" />
          ) : (
            <Volume2 className="w-3.5 h-3.5 text-white drop-shadow-xs" />
          )}
        </button>
      </div>

      {/* Right Group: 5. ব্যালেন্স (Wallet Balance Display - Spaced nicely from mic) */}
      <div className="flex items-center shrink-0 ml-2">
        <div
          onClick={onOpenDeposit}
          className="flex items-center bg-[#0c0f17] border border-[#232c3f] hover:border-[#38bdf8]/50 rounded-full pl-2 pr-2.5 py-1 sm:py-1.5 shadow-inner cursor-pointer active:scale-95 transition-all shrink-0 gap-1.5"
          title="ব্যালেন্স / এড মানি (রিচার্জ) করতে চাপুন"
        >
          <div className="w-5 sm:w-5.5 h-5 sm:h-5.5 rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center text-[#1a1200] font-black text-xs shadow shrink-0">
            ৳
          </div>
          <div className="flex items-baseline">
            <span className={`text-xs sm:text-sm font-bold font-mono tracking-tight whitespace-nowrap ${balance <= 0 ? 'text-rose-400' : 'text-[#38bdf8]'}`}>
              ৳ {balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
