import React, { useState, useEffect } from 'react';
import {
  X,
  Gift,
  Flame,
  CheckCircle2,
  Trophy,
  Sparkles,
  Timer,
  ArrowRight,
} from 'lucide-react';
import { soundManager } from '../services/audio';
import {
  loadBonusState,
  getLocalDateString,
  TARGET_STREAK_SECONDS,
  formatTimeMMSS,
  BonusState,
} from '../services/bonusService';
import { AppUser } from '../services/phoneAuth';

interface DailyBonusModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  onRewardWon: (amount: number, reason: string) => void;
  onOpenSpinner: () => void;
  activeSecondsToday: number;
}

export const DailyBonusModal: React.FC<DailyBonusModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onRewardWon,
  onOpenSpinner,
  activeSecondsToday,
}) => {
  const [bonusState, setBonusState] = useState<BonusState>(() => loadBonusState(currentUser?.uid));
  const [isClaimingDaily, setIsClaimingDaily] = useState(false);
  const [claimSuccessMsg, setClaimSuccessMsg] = useState('');

  const syncState = () => {
    const state = loadBonusState(currentUser?.uid);
    setBonusState(state);
  };

  useEffect(() => {
    if (isOpen) {
      syncState();
      setClaimSuccessMsg('');
    }
  }, [isOpen, currentUser]);

  useEffect(() => {
    if (!isOpen) return;
    const handleUpdated = (e: Event) => {
      const custom = e as CustomEvent<BonusState>;
      if (custom.detail) {
        setBonusState(custom.detail);
      } else {
        syncState();
      }
    };
    window.addEventListener('skywin_bonus_state_updated', handleUpdated);
    return () => window.removeEventListener('skywin_bonus_state_updated', handleUpdated);
  }, [isOpen]);

  if (!isOpen) return null;

  const today = getLocalDateString();
  const isSpinnerReady = bonusState.lastSpinDate !== today;

  // Time spent progress calculation
  const currentSeconds = Math.max(bonusState.todaySecondsSpent || 0, activeSecondsToday);
  const progressPercent = Math.min(100, Math.round((currentSeconds / TARGET_STREAK_SECONDS) * 100));
  const isFiveMinDone = currentSeconds >= TARGET_STREAK_SECONDS || bonusState.todayQualified;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 select-none animate-fadeIn">
      <div 
        className="bg-gradient-to-b from-[#131a29] via-[#0c111c] to-[#070a12] border-2 border-emerald-500/40 rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-[0_0_50px_rgba(16,185,129,0.2)] text-white relative max-h-[92vh] overflow-y-auto overscroll-contain scroll-smooth"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Close Button */}
        <button
          onClick={() => {
            soundManager.playClick();
            onClose();
          }}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer z-20"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-[#1b2538]">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-white shadow-lg shadow-emerald-600/30">
            <Gift className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black tracking-tight text-white">
              সাপ্তাহিক ও লাকি বোনাস হাব
            </h2>
            <p className="text-[11px] text-slate-400">
              ৭ দিনের স্ট্রিক বোনাস (৫০০৳) ও দৈনিক লাকি স্পিনার
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {/* ================= CARD 1: 7-DAY STREAK (500 BDT) ================= */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-[#1a1426] to-[#0e0b17] border border-amber-500/40 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center">
                  <Flame className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">২. একটানা ৭ দিনের স্ট্রিক বোনাস</h3>
                  <span className="text-[11px] text-amber-300">কোন গ্যাপ ছাড়া ৭ দিন = ৫০০৳</span>
                </div>
              </div>
              <div className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-300 font-mono font-black text-sm">
                ৳৫০০
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              প্রতিদিন নিয়মিত অ্যাপ অপেন করে মিনিমাম <strong className="text-white">৫ মিনিট</strong> সক্রিয় থাকলে একটানা ৭ দিন পর পাবেন বিশেষ <strong className="text-amber-400 font-mono">৫০০৳</strong> সাপ্তাহিক ক্যাশ বোনাস!
            </p>

            {/* Live Time Spent Bar for Today */}
            <div className="bg-[#090d15] border border-[#232f46] rounded-xl p-3 space-y-2 mb-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1">
                  <Timer className="w-3.5 h-3.5 text-amber-400" />
                  <span>আজকের সক্রিয় সময়:</span>
                </span>
                <span className={`font-mono font-bold ${isFiveMinDone ? 'text-emerald-400' : 'text-amber-300'}`}>
                  {isFiveMinDone ? '৫ মিনিট সম্পন্ন! ✓' : formatTimeMMSS(currentSeconds)}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden relative">
                <div
                  className={`h-full transition-all duration-300 ${
                    isFiveMinDone
                      ? 'bg-gradient-to-r from-emerald-500 to-green-400'
                      : 'bg-gradient-to-r from-amber-500 to-yellow-400'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>০ মিনিট</span>
                <span>লক্ষ্য: ৫ মিনিট ({progressPercent}%)</span>
              </div>
            </div>

            {/* 7-Day Visual Steps Roadmap */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-300 px-0.5">
                <span>বর্তমান স্ট্রিক অগ্রগতি:</span>
                <span className="text-amber-300 font-mono">{bonusState.streakCount || 0} / ৭ দিন</span>
              </div>

              <div className="grid grid-cols-7 gap-1.5 pt-1">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                  const currentStreak = bonusState.streakCount || 0;
                  const isCompleted = day <= currentStreak;
                  const isTodayActive = day === currentStreak + 1;
                  const isGrandPrize = day === 7;

                  return (
                    <div
                      key={day}
                      className={`rounded-xl p-1.5 flex flex-col items-center justify-center text-center transition-all ${
                        isCompleted
                          ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-300'
                          : isTodayActive
                          ? 'bg-amber-500/20 border border-amber-500/60 text-amber-300 shadow-md animate-pulse'
                          : 'bg-[#0a0d16] border border-[#1b2538] text-slate-500'
                      }`}
                    >
                      <span className="text-[9px] font-mono block">দিন {day}</span>
                      <div className="my-1">
                        {isCompleted ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : isGrandPrize ? (
                          <Trophy className="w-4 h-4 text-amber-400" />
                        ) : (
                          <div className={`w-3.5 h-3.5 rounded-full border ${isTodayActive ? 'border-amber-400 bg-amber-400/20' : 'border-slate-600'}`} />
                        )}
                      </div>
                      <span className={`text-[9px] font-bold font-mono ${isGrandPrize ? 'text-amber-300' : 'text-slate-400'}`}>
                        {isGrandPrize ? '৳৫০০' : '✓'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ================= CARD 3: LUCKY SPINNER ================= */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-[#21111d] to-[#120811] border border-rose-500/40 shadow-lg relative overflow-hidden">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">২. দৈনিক লাকি স্পিনার</h3>
                  <span className="text-[11px] text-rose-300">২০৳ থেকে ৫০০৳ ও iPhone 17 Pro Max</span>
                </div>
              </div>
              <div className="px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/50 text-rose-300 font-mono font-black text-sm">
                ২০-৫০০৳
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              চাকা ঘুরিয়ে প্রতি স্পিনে ২০ টাকা থেকে সর্বোচ্চ ৫০০ টাকা নগদ বোনাস জিতুন! সাথে থাকছে বিশেষ iPhone 17 Pro Max ট্রাই করার সুযোগ!
            </p>

            <button
              onClick={() => {
                soundManager.playClick();
                onClose();
                onOpenSpinner();
              }}
              className="w-full py-2.5 bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-black text-xs uppercase tracking-wide rounded-xl shadow-lg shadow-rose-700/30 active:scale-98 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-amber-200" />
              <span>{isSpinnerReady ? 'লাকি স্পিন করুন (Spin Now)' : 'স্পিনার ভিউ দেখুন'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
