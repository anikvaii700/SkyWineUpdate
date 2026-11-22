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
  Users,
  Link2,
  Copy,
  Check,
  Share2,
  Clock,
  UserPlus,
} from 'lucide-react';
import { soundManager } from '../services/audio';
import {
  loadBonusState,
  getLocalDateString,
  TARGET_STREAK_SECONDS,
  formatTimeMMSS,
  BonusState,
} from '../services/bonusService';
import { AppUser, ReferralRecord } from '../services/phoneAuth';
import { auth } from '../services/firebase';
import { backendApi } from '../services/backendApi';
import { UserWalletProfile } from '../services/firebase';
import { buildReferralLink, listenToUserReferrals } from '../services/referralService';

interface DailyBonusModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  userProfile?: UserWalletProfile | null;
  onRewardWon: (amount: number, reason: string) => void;
  onOpenSpinner: () => void;
  onOpenAuth?: (notice?: string) => void;
  activeSecondsToday: number;
}

export const DailyBonusModal: React.FC<DailyBonusModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  userProfile,
  onRewardWon,
  onOpenSpinner,
  onOpenAuth,
  activeSecondsToday,
}) => {
  const [bonusState, setBonusState] = useState<BonusState>(() => loadBonusState(currentUser?.uid));
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showFriendsList, setShowFriendsList] = useState(false);

  const syncState = () => {
    const state = loadBonusState(currentUser?.uid);
    setBonusState(state);
  };

  useEffect(() => {
    if (isOpen) {
      syncState();
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

  const userRefCode =
    userProfile?.referralCode ||
    userProfile?.userCode ||
    currentUser?.referralCode ||
    currentUser?.userCode ||
    (currentUser ? `USER-${currentUser.uid.slice(-5).toUpperCase()}` : '');

  // Referral reporting comes from the authenticated server for Firebase accounts.
  // Legacy guest/phone-only sessions retain the existing Firestore listener.
  useEffect(() => {
    let cancelled = false;
    if (!isOpen || !currentUser || !userRefCode) {
      setReferrals([]);
      return;
    }

    if (auth.currentUser) {
      backendApi.getMyReferrals()
        .then((result) => {
          if (cancelled) return;
          const records: ReferralRecord[] = result.referrals.map((row) => ({
            id: String(row.id),
            referrerUid: currentUser.uid,
            referrerCode: result.referralCode || userRefCode,
            referredUid: row.referred_uid || '',
            referredUserCode: String(row.referred_user_code || ''),
            referredPhone: String(row.referred_phone || ''),
            referredName: String(row.referred_name || 'Player'),
            firstDepositAmount: Number(row.first_deposit_amount || 0),
            bonusAmount: Number(row.bonus_amount || 0),
            status: row.status === 'rewarded' ? 'rewarded' : 'pending_deposit',
            createdAt: String(row.created_at || new Date().toISOString()),
            rewardedAt: row.rewarded_at || undefined,
          }));
          setReferrals(records);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('Server referral summary could not be loaded:', err);
            setReferrals([]);
          }
        });
      return () => { cancelled = true; };
    }

    const unsub = listenToUserReferrals(userRefCode, currentUser.uid, (records) => {
      if (!cancelled) setReferrals(records);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [isOpen, currentUser?.uid, userRefCode]);

  if (!isOpen) return null;

  const today = getLocalDateString();
  const isSpinnerReady = bonusState.lastSpinDate !== today;

  // Time spent progress calculation
  const currentSeconds = Math.max(bonusState.todaySecondsSpent || 0, activeSecondsToday);
  const progressPercent = Math.min(100, Math.round((currentSeconds / TARGET_STREAK_SECONDS) * 100));
  const isFiveMinDone = currentSeconds >= TARGET_STREAK_SECONDS || bonusState.todayQualified;

  // Invite Bonus 100% stats
  const referralLink = userRefCode ? buildReferralLink(userRefCode) : '';
  const totalInvited = Math.max(userProfile?.referralCount || 0, referrals.length);
  const rewardedFriends = referrals.filter((r) => r.status === 'rewarded' || (r.bonusAmount || 0) > 0);
  const totalInviteBonusEarned = Math.max(
    userProfile?.referralBonusEarned || 0,
    referrals.reduce((sum, r) => sum + (r.bonusAmount || 0), 0)
  );

  const handleCopyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).catch(() => {});
    setCopiedLink(true);
    soundManager.playClick();
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyCode = () => {
    if (!userRefCode) return;
    navigator.clipboard.writeText(userRefCode).catch(() => {});
    setCopiedCode(true);
    soundManager.playClick();
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleShareLink = async () => {
    if (!referralLink) return;
    soundManager.playClick();
    const shareText = `SkyWin BD-তে আমার রেফারেল লিংক দিয়ে একাউন্ট করুন! রেফার কোড: ${userRefCode}\n${referralLink}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'SkyWin BD — ইনভাইট বোনাস ১০০%',
          text: shareText,
          url: referralLink,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    handleCopyLink();
  };

  // Suppress unused prop lint if onRewardWon is kept in interface for compatibility
  void onRewardWon;

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
              বোনাস ও রিওয়ার্ড হাব
            </h2>
            <p className="text-[11px] text-slate-400">
              ইনভাইট বোনাস ১০০%, ৭ দিনের স্ট্রিক (৫০০৳) ও লাকি স্পিনার
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {/* ================= CARD 1: INVITE BONUS 100% ================= */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0d1f2d] via-[#0d1827] to-[#0a101d] border border-cyan-400/50 shadow-lg relative overflow-hidden">
            <div className="absolute -top-6 -right-6 w-32 h-32 bg-cyan-500/15 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-start justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">১. ইনভাইট বোনাস ১০০%</h3>
                  <span className="text-[11px] text-cyan-300 font-semibold">
                    বন্ধুর ১ম ডিপোজিটের সমপরিমাণ ১০০% বোনাস!
                  </span>
                </div>
              </div>
              <div className="px-2.5 py-0.5 rounded-full bg-gradient-to-r from-cyan-500/30 to-emerald-500/30 border border-cyan-400/60 text-cyan-200 font-mono font-black text-xs shrink-0">
                ১০০%
              </div>
            </div>

            <p className="text-xs text-slate-200 leading-relaxed mb-2.5">
              আপনার <strong className="text-cyan-300">রেফারেল লিংক</strong> বা{' '}
              <strong className="text-amber-300">রেফার কোড</strong> ব্যবহার করে কেউ নতুন একাউন্ট করে শুরুতে যত টাকা ডিপোজিট করবে, ঠিক তত টাকা (<strong className="text-emerald-400">১০০%</strong>) আপনার রেফার বোনাস হিসেবে যুক্ত হবে!
            </p>

            {/* Clear Example Box */}
            <div className="bg-[#070d17] border border-cyan-500/25 rounded-xl p-2.5 mb-3 text-[11px] text-slate-300 flex items-center justify-between gap-2">
              <span>যেমন: বন্ধু ১ম ডিপোজিট করলে</span>
              <span className="font-mono font-black text-emerald-400 whitespace-nowrap">
                ৳১,০০০ → বোনাস ৳১,০০০ (১০০%)
              </span>
            </div>

            {currentUser ? (
              <div className="space-y-2.5">
                {/* Shareable Referral Link */}
                <div className="bg-[#080d16] border border-[#1d2c42] rounded-xl p-2.5 space-y-2">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1 font-bold text-cyan-300">
                      <Link2 className="w-3 h-3" />
                      <span>আপনার রেফারেল লিংক (Invite Link):</span>
                    </span>
                  </div>
                  <div className="bg-[#05080f] border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-cyan-200 truncate select-all">
                    {referralLink}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-98 transition-all cursor-pointer shadow-md shadow-cyan-900/30"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? 'লিংক কপি হয়েছে!' : 'লিংক কপি করুন'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleShareLink}
                      className="py-2 px-3 rounded-xl bg-[#152236] hover:bg-[#1d2e48] border border-cyan-500/40 text-cyan-200 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-98 transition-all cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>শেয়ার করুন</span>
                    </button>
                  </div>
                </div>

                {/* Referral Code Box */}
                <div className="bg-[#080d16] border border-[#1d2c42] rounded-xl p-2.5 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] text-slate-400 block">আপনার রেফার কোড (Referral Code):</span>
                    <span className="font-mono font-black text-amber-300 text-sm tracking-wider select-all">
                      {userRefCode}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode ? 'কপি হয়েছে' : 'কোড কপি'}</span>
                  </button>
                </div>

                {/* 3-Column Referral Stats */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-[#070b13] border border-white/10 rounded-xl p-2 text-center">
                    <span className="text-[9.5px] text-slate-400 block">মোট ইনভাইট</span>
                    <span className="font-mono font-black text-sm text-white">{totalInvited} জন</span>
                  </div>
                  <div className="bg-[#070b13] border border-white/10 rounded-xl p-2 text-center">
                    <span className="text-[9.5px] text-slate-400 block">১ম ডিপোজিট</span>
                    <span className="font-mono font-black text-sm text-emerald-400">{rewardedFriends.length} জন</span>
                  </div>
                  <div className="bg-[#070b13] border border-cyan-500/30 rounded-xl p-2 text-center">
                    <span className="text-[9.5px] text-slate-400 block">মোট বোনাস</span>
                    <span className="font-mono font-black text-sm text-cyan-300">
                      ৳{totalInviteBonusEarned.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Invited Friends Toggle & List */}
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playClick();
                    setShowFriendsList((prev) => !prev);
                  }}
                  className="w-full py-1.5 px-3 rounded-xl bg-[#0d1626] hover:bg-[#132036] border border-[#1f304a] text-[11px] font-bold text-slate-300 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span>আপনার ইনভাইট তালিকা দেখুন ({referrals.length} জন)</span>
                  <span className="text-cyan-400">{showFriendsList ? 'লুকান ▲' : 'দেখুন ▼'}</span>
                </button>

                {showFriendsList && (
                  <div className="bg-[#060a12] border border-[#1b283f] rounded-xl p-2.5 max-h-40 overflow-y-auto space-y-1.5">
                    {referrals.length === 0 ? (
                      <p className="text-[11px] text-slate-500 text-center py-3">
                        এখনও কেউ আপনার রেফার লিংক বা কোড দিয়ে একাউন্ট করেনি।
                      </p>
                    ) : (
                      referrals.map((r) => {
                        const isRewarded = r.status === 'rewarded' || (r.bonusAmount || 0) > 0;
                        return (
                          <div
                            key={r.id}
                            className="p-2 rounded-lg bg-[#0c1322] border border-white/5 flex items-center justify-between gap-2 text-[11px]"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-white truncate">
                                {r.referredName || r.referredUserCode}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400">
                                {r.referredUserCode}
                                {r.firstDepositAmount ? ` · ডিপোজিট ৳${r.firstDepositAmount.toLocaleString()}` : ''}
                              </div>
                            </div>
                            {isRewarded ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-bold text-[10px] shrink-0">
                                +৳{r.bonusAmount.toLocaleString()} (১০০%)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold text-[10px] flex items-center gap-1 shrink-0">
                                <Clock className="w-2.5 h-2.5" />
                                <span>১ম ডিপোজিট বাকি</span>
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  soundManager.playClick();
                  onClose();
                  onOpenAuth?.('আপনার রেফারেল লিংক ও কোড পেতে প্রথমে একাউন্ট লগইন বা সাইনআপ করুন!');
                }}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg cursor-pointer active:scale-98 transition-all"
              >
                <UserPlus className="w-4 h-4" />
                <span>রেফারেল লিংক পেতে লগইন / সাইনআপ করুন</span>
              </button>
            )}

          </div>

          {/* ================= CARD 2: 7-DAY STREAK (500 BDT) ================= */}
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
                  <h3 className="text-sm font-black text-white">৩. দৈনিক লাকি স্পিনার</h3>
                  <span className="text-[11px] text-rose-300">২০৳ থেকে ৩০০৳ ও iPhone 17 Pro Max</span>
                </div>
              </div>
              <div className="px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/50 text-rose-300 font-mono font-black text-sm">
                ২০-৩০০৳
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              চাকা ঘুরিয়ে প্রতি স্পিনে ২০ টাকা থেকে সর্বোচ্চ ৩০০ টাকা নগদ বোনাস জিতুন! সাথে থাকছে বিশেষ iPhone 17 Pro Max ট্রাই করার সুযোগ!
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
