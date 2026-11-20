import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Plane,
  Target,
  Gift,
  Users,
  Sliders,
  ShieldAlert,
  RefreshCw,
  KeyRound,
  Lock,
  Save,
  CheckCircle2,
  XCircle,
  Sparkles,
  Search,
  Clock,
  Power,
  Wallet,
  Ban,
  Activity,
  RotateCcw,
} from 'lucide-react';
import {
  AppControlConfig,
  AviatorHouseMode,
} from '../services/appControlService';
import {
  ManualDepositRequest,
  ManualWithdrawalRequest,
  SystemPaymentSettings,
} from '../services/manualPayment';
import { ReferralRecord } from '../services/phoneAuth';
import { getAllAccountsWithStats } from '../services/userManagement';
import { soundManager } from '../services/audio';

export type AdminExtraTabKey = 'analytics' | 'game_control' | 'bonuses' | 'app_control';

interface AdminExtraTabsProps {
  activeTab: AdminExtraTabKey;
  controls: AppControlConfig;
  onUpdateControls: (next: AppControlConfig, toastTitle?: string, toastMsg?: string) => Promise<void>;
  isSavingControls: boolean;
  paymentSettings: SystemPaymentSettings;
  onUpdateFirstDepositPercent: (percent: number) => Promise<void>;
  requests: ManualDepositRequest[];
  withdrawals: ManualWithdrawalRequest[];
  accountsWithStats: ReturnType<typeof getAllAccountsWithStats>;
  allReferrals: ReferralRecord[];
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenStealthGuide: () => void;
  onTogglePinChange: () => void;
}

const getWingoNumColor = (num: number): { label: string; bg: string } => {
  if (num === 0) return { label: 'Red + Violet', bg: 'from-rose-600 to-violet-600' };
  if (num === 5) return { label: 'Green + Violet', bg: 'from-emerald-600 to-violet-600' };
  if ([1, 3, 7, 9].includes(num)) return { label: 'Green', bg: 'from-emerald-600 to-green-500' };
  return { label: 'Red', bg: 'from-rose-600 to-red-500' };
};

export const AdminExtraTabs: React.FC<AdminExtraTabsProps> = ({
  activeTab,
  controls,
  onUpdateControls,
  isSavingControls,
  paymentSettings,
  onUpdateFirstDepositPercent,
  requests,
  withdrawals,
  accountsWithStats,
  allReferrals,
  isRefreshing,
  onRefresh,
  onOpenStealthGuide,
  onTogglePinChange,
}) => {
  const [customCrashInput, setCustomCrashInput] = useState<string>(
    controls.aviatorForceCrashMultiplier ? String(controls.aviatorForceCrashMultiplier) : '1.15'
  );
  const [refSearch, setRefSearch] = useState<string>('');
  const [refFilter, setRefFilter] = useState<'all' | 'rewarded' | 'pending_deposit'>('all');
  const [firstDepPercentInput, setFirstDepPercentInput] = useState<number>(
    paymentSettings.firstDepositBonusPercent ?? 50
  );

  // ==================== ANALYTICS COMPUTATIONS ====================
  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);

    const approvedDeps = requests.filter((r) => r.status === 'approved');
    const completedWths = withdrawals.filter((w) => w.status === 'completed');

    const totalDeposit = approvedDeps.reduce((s, r) => s + (r.amount || 0), 0);
    const totalWithdraw = completedWths.reduce((s, w) => s + (w.amount || 0), 0);
    const netProfit = Math.round((totalDeposit - totalWithdraw) * 100) / 100;

    const todayDeps = approvedDeps.filter((r) => (r.updatedAt || r.createdAt || '').startsWith(todayStr));
    const todayWths = completedWths.filter((w) => (w.updatedAt || w.createdAt || '').startsWith(todayStr));
    const todayDepositAmt = todayDeps.reduce((s, r) => s + (r.amount || 0), 0);
    const todayWithdrawAmt = todayWths.reduce((s, w) => s + (w.amount || 0), 0);

    const todayNewUsers = accountsWithStats.filter((a) =>
      (a.createdAt || '').startsWith(todayStr)
    ).length;

    const totalUserBalance = accountsWithStats.reduce((s, a) => s + (a.balance || 0), 0);
    const totalInviteBonusLocked = accountsWithStats.reduce(
      (s, a) => s + (a.inviteBonusBalance || 0),
      0
    );
    const depositingUsers = accountsWithStats.filter(
      (a) => a.hasDeposited || (a.totalDeposited || 0) > 0
    ).length;
    const restrictedUsers = accountsWithStats.filter(
      (a) =>
        a.status === 'banned' ||
        a.status === 'suspended' ||
        (a.suspendedUntil && new Date(a.suspendedUntil).getTime() > Date.now())
    ).length;

    const totalReferralBonusPaid = allReferrals.reduce((s, r) => s + (r.bonusAmount || 0), 0);
    const rewardedReferralsCount = allReferrals.filter((r) => r.status === 'rewarded' || (r.bonusAmount || 0) > 0).length;

    return {
      totalDeposit,
      totalWithdraw,
      netProfit,
      todayDepositCount: todayDeps.length,
      todayDepositAmt,
      todayWithdrawCount: todayWths.length,
      todayWithdrawAmt,
      todayNewUsers,
      totalUsers: accountsWithStats.length,
      totalUserBalance: Math.round(totalUserBalance * 100) / 100,
      totalInviteBonusLocked: Math.round(totalInviteBonusLocked * 100) / 100,
      depositingUsers,
      restrictedUsers,
      totalReferralBonusPaid,
      rewardedReferralsCount,
    };
  }, [requests, withdrawals, accountsWithStats, allReferrals]);

  const filteredReferrals = useMemo(() => {
    return allReferrals.filter((r) => {
      const isRewarded = r.status === 'rewarded' || (r.bonusAmount || 0) > 0;
      if (refFilter === 'rewarded' && !isRewarded) return false;
      if (refFilter === 'pending_deposit' && isRewarded) return false;
      if (refSearch.trim()) {
        const q = refSearch.trim().toLowerCase();
        const hay = `${r.referrerCode} ${r.referredUserCode} ${r.referredPhone} ${r.referredName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allReferrals, refFilter, refSearch]);

  const quickToggle = async (
    key: keyof AppControlConfig,
    value: boolean,
    label: string
  ) => {
    soundManager.playClick();
    await onUpdateControls(
      { ...controls, [key]: value },
      `${label} ${value ? 'চালু' : 'বন্ধ'} করা হয়েছে`,
      `পরিবর্তনটি সাথে সাথে সব ইউজারের অ্যাপে লাইভ আপডেট হয়েছে।`
    );
  };

  // ==================== TAB: ANALYTICS & LIVE REPORT ====================
  if (activeTab === 'analytics') {
    return (
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
        {/* Net Profit Hero Banner */}
        <div
          className={`rounded-2xl p-4 border shadow-lg ${
            stats.netProfit >= 0
              ? 'bg-gradient-to-br from-emerald-950/60 via-[#0f1a24] to-[#0c1420] border-emerald-500/40'
              : 'bg-gradient-to-br from-rose-950/60 via-[#1a1018] to-[#0c1420] border-rose-500/40'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              {stats.netProfit >= 0 ? (
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              ) : (
                <TrendingDown className="w-5 h-5 text-rose-400" />
              )}
              <span className="text-xs sm:text-sm font-black text-slate-200">
                মোট নেট লাভ (ডিপোজিট − উত্তোলন)
              </span>
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-black border ${
                stats.netProfit >= 0
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
              }`}
            >
              {stats.netProfit >= 0 ? 'প্রফিট' : 'মাইনাস'}
            </span>
          </div>
          <p
            className={`text-2xl sm:text-3xl font-black font-mono ${
              stats.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {stats.netProfit >= 0 ? '+' : ''}৳ {stats.netProfit.toLocaleString()}
          </p>
          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/10 text-center">
            <div className="bg-black/25 rounded-xl p-2">
              <p className="text-[10px] text-slate-400">আজকের ডিপোজিট</p>
              <p className="text-xs sm:text-sm font-black text-emerald-400 font-mono">
                ৳ {stats.todayDepositAmt.toLocaleString()}
              </p>
              <p className="text-[9px] text-slate-500">{stats.todayDepositCount} টি</p>
            </div>
            <div className="bg-black/25 rounded-xl p-2">
              <p className="text-[10px] text-slate-400">আজকের উত্তোলন</p>
              <p className="text-xs sm:text-sm font-black text-rose-400 font-mono">
                ৳ {stats.todayWithdrawAmt.toLocaleString()}
              </p>
              <p className="text-[9px] text-slate-500">{stats.todayWithdrawCount} টি</p>
            </div>
            <div className="bg-black/25 rounded-xl p-2">
              <p className="text-[10px] text-slate-400">আজকের নতুন ইউজার</p>
              <p className="text-xs sm:text-sm font-black text-cyan-400 font-mono">
                +{stats.todayNewUsers} জন
              </p>
              <p className="text-[9px] text-slate-500">মোট {stats.totalUsers} জন</p>
            </div>
          </div>
        </div>

        {/* Platform Wallet & User Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="bg-[#121a28] border border-[#202d44] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
              <Wallet className="w-3.5 h-3.5 text-cyan-400" />
              <span>মোট ইউজার ব্যালেন্স</span>
            </div>
            <p className="text-sm sm:text-base font-black text-white font-mono">
              ৳ {stats.totalUserBalance.toLocaleString()}
            </p>
          </div>

          <div className="bg-[#121a28] border border-[#202d44] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
              <Gift className="w-3.5 h-3.5 text-amber-400" />
              <span>লকড ইনভাইট বোনাস</span>
            </div>
            <p className="text-sm sm:text-base font-black text-amber-400 font-mono">
              ৳ {stats.totalInviteBonusLocked.toLocaleString()}
            </p>
          </div>

          <div className="bg-[#121a28] border border-[#202d44] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              <span>ডিপোজিটকারী ইউজার</span>
            </div>
            <p className="text-sm sm:text-base font-black text-emerald-400 font-mono">
              {stats.depositingUsers} / {stats.totalUsers}
            </p>
          </div>

          <div className="bg-[#121a28] border border-[#202d44] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
              <Ban className="w-3.5 h-3.5 text-rose-400" />
              <span>ব্যান / স্থগিত</span>
            </div>
            <p className="text-sm sm:text-base font-black text-rose-400 font-mono">
              {stats.restrictedUsers} জন
            </p>
          </div>
        </div>

        {/* Quick Live Status Switches */}
        <div className="bg-[#111927] border border-[#202d44] rounded-2xl p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs sm:text-sm font-black text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>দ্রুত লাইভ কন্ট্রোল (Quick Switch)</span>
            </h4>
            <span className="text-[10px] text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/30 font-bold">
              ক্লাউড সিঙ্ক
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => quickToggle('aviatorEnabled', !controls.aviatorEnabled, 'Aviator গেম')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer active:scale-95 ${
                controls.aviatorEnabled
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <Plane className="w-4 h-4" />
                <span className="text-[10px] font-black">{controls.aviatorEnabled ? 'চালু' : 'বন্ধ'}</span>
              </div>
              <p className="text-xs font-bold text-white">Aviator গেম</p>
            </button>

            <button
              type="button"
              onClick={() => quickToggle('wingoEnabled', !controls.wingoEnabled, 'Wingo গেম')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer active:scale-95 ${
                controls.wingoEnabled
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <Target className="w-4 h-4" />
                <span className="text-[10px] font-black">{controls.wingoEnabled ? 'চালু' : 'বন্ধ'}</span>
              </div>
              <p className="text-xs font-bold text-white">Wingo গেম</p>
            </button>

            <button
              type="button"
              onClick={() => quickToggle('depositsEnabled', !controls.depositsEnabled, 'ডিপোজিট সিস্টেম')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer active:scale-95 ${
                controls.depositsEnabled
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <Wallet className="w-4 h-4" />
                <span className="text-[10px] font-black">{controls.depositsEnabled ? 'চালু' : 'বন্ধ'}</span>
              </div>
              <p className="text-xs font-bold text-white">ডিপোজিট</p>
            </button>

            <button
              type="button"
              onClick={() => quickToggle('withdrawalsEnabled', !controls.withdrawalsEnabled, 'উইথড্র সিস্টেম')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer active:scale-95 ${
                controls.withdrawalsEnabled
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <Power className="w-4 h-4" />
                <span className="text-[10px] font-black">{controls.withdrawalsEnabled ? 'চালু' : 'বন্ধ'}</span>
              </div>
              <p className="text-xs font-bold text-white">উইথড্র</p>
            </button>
          </div>
        </div>

        {/* Admin Utility Tools (Moved cleanly out of Header) */}
        <div className="bg-[#111927] border border-[#202d44] rounded-2xl p-3.5">
          <h4 className="text-xs font-black text-slate-300 mb-2.5">এডমিন টুলস ও সিকিউরিটি</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="py-2.5 px-3 rounded-xl bg-[#182234] hover:bg-[#22314a] border border-[#2a3b58] text-slate-200 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>সব ডাটা রিফ্রেশ করুন</span>
            </button>

            <button
              type="button"
              onClick={onTogglePinChange}
              className="py-2.5 px-3 rounded-xl bg-[#182234] hover:bg-[#22314a] border border-[#2a3b58] text-slate-200 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all"
            >
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span>এডমিন পিন পরিবর্তন</span>
            </button>

            <button
              type="button"
              onClick={onOpenStealthGuide}
              className="py-2.5 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>সিক্রেট এডমিন গাইড</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== TAB: LIVE GAME CONTROL (AVIATOR & WINGO) ====================
  if (activeTab === 'game_control') {
    const crashPresets = [1.0, 1.05, 1.15, 1.5, 2.0, 5.0, 10.0, 50.0];
    const houseModes: Array<{ id: AviatorHouseMode; title: string; desc: string; color: string }> = [
      {
        id: 'strict',
        title: 'কঠোর হাউস মোড (Strict)',
        desc: 'ইউজার বাজি ধরলে বেশিরভাগ রাউন্ড ১.০১x - ১.১৫x এ ক্র্যাশ করবে।',
        color: 'border-rose-500/50 bg-rose-500/15 text-rose-300',
      },
      {
        id: 'balanced',
        title: 'স্মার্ট ব্যালেন্সড (ডিফল্ট)',
        desc: 'বিদ্যমান স্মার্ট হাউস প্রোটেকশন: ইউজার লাভে গেলে অটো ক্র্যাশ কন্ট্রোল।',
        color: 'border-amber-500/50 bg-amber-500/15 text-amber-300',
      },
      {
        id: 'relaxed',
        title: 'রিল্যাক্সড / নরমাল মোড',
        desc: 'রিয়েল ডিপোজিট ইউজারদের জন্য তুলনামূলক বেশি মাল্টিপ্লায়ার (ইনভাইট বোনাস বাদে)।',
        color: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
      },
    ];

    return (
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
        {/* 1. Aviator Live Control */}
        <div className="bg-[#111927] border border-red-500/30 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/30">
                <Plane className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-black text-white">Aviator ক্র্যাশ কন্ট্রোল</h4>
                <p className="text-[11px] text-slate-400">পরবর্তী রাউন্ডের ক্র্যাশ ও হাউস প্রোটেকশন নিয়ন্ত্রণ</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => quickToggle('aviatorEnabled', !controls.aviatorEnabled, 'Aviator গেম')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black border cursor-pointer transition-all ${
                controls.aviatorEnabled
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-rose-500/20 border-rose-500/50 text-rose-300'
              }`}
            >
              {controls.aviatorEnabled ? 'গেম চালু ✓' : 'গেম বন্ধ ✕'}
            </button>
          </div>

          {/* Next Round Forced Crash Multiplier */}
          <div className="bg-[#0b1019] border border-[#1f2c42] rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-amber-300">
                পরবর্তী রাউন্ড ফোর্স ক্র্যাশ পয়েন্ট (One-Shot)
              </span>
              {controls.aviatorForceCrashMultiplier !== null ? (
                <span className="text-[11px] font-mono font-black px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                  সেট করা আছে: {controls.aviatorForceCrashMultiplier.toFixed(2)}x
                </span>
              ) : (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  অটো মোড চালু
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {crashPresets.map((val) => {
                const isSelected = controls.aviatorForceCrashMultiplier === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() =>
                      onUpdateControls(
                        { ...controls, aviatorForceCrashMultiplier: val },
                        `Aviator ক্র্যাশ ${val.toFixed(2)}x সেট হয়েছে`,
                        `পরবর্তী Aviator রাউন্ড ঠিক ${val.toFixed(2)}x এ ক্র্যাশ করবে।`
                      )
                    }
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-black border cursor-pointer transition-all active:scale-95 ${
                      isSelected
                        ? 'bg-rose-600 text-white border-rose-400 shadow-md'
                        : 'bg-[#151e2e] hover:bg-[#1e2b42] text-slate-200 border-[#26354e]'
                    }`}
                  >
                    {val.toFixed(2)}x
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="number"
                step="0.05"
                min="1"
                max="100"
                value={customCrashInput}
                onChange={(e) => setCustomCrashInput(e.target.value)}
                placeholder="যেমন: 1.25"
                className="flex-1 bg-[#121a28] border border-[#283852] rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-hidden focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => {
                  const num = parseFloat(customCrashInput);
                  if (!Number.isFinite(num) || num < 1 || num > 100) return;
                  onUpdateControls(
                    { ...controls, aviatorForceCrashMultiplier: Math.round(num * 100) / 100 },
                    `Aviator ক্র্যাশ ${num.toFixed(2)}x সেট হয়েছে`,
                    `পরবর্তী রাউন্ডে বিমান ${num.toFixed(2)}x এ ক্র্যাশ করবে।`
                  );
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs cursor-pointer active:scale-95"
              >
                সেট করুন
              </button>
              {controls.aviatorForceCrashMultiplier !== null && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateControls(
                      { ...controls, aviatorForceCrashMultiplier: null },
                      'Aviator অটো মোড চালু',
                      'ফোর্স ক্র্যাশ রিসেট করে অটোমেটিক অ্যালগরিদম চালু করা হয়েছে।'
                    )
                  }
                  className="px-3 py-2 rounded-xl bg-[#1b2538] hover:bg-[#26354e] text-slate-300 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>অটো</span>
                </button>
              )}
            </div>
          </div>

          {/* House Protection Mode */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 block">হাউস প্রোটেকশন মোড</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {houseModes.map((m) => {
                const active = controls.aviatorHouseMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      onUpdateControls(
                        { ...controls, aviatorHouseMode: m.id },
                        `হাউস মোড: ${m.title}`,
                        m.desc
                      )
                    }
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? m.color + ' ring-1 ring-white/20'
                        : 'bg-[#0b1019] border-[#1f2c42] text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    <p className="text-xs font-black text-white">{m.title}</p>
                    <p className="text-[10px] mt-1 leading-snug opacity-85">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 2. Wingo Live Control */}
        <div className="bg-[#111927] border border-cyan-500/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center border border-cyan-500/30">
                <Target className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-black text-white">Wingo লাইভ রেজাল্ট কন্ট্রোল</h4>
                <p className="text-[11px] text-slate-400">পরবর্তী Wingo রাউন্ডের বিজয়ী সংখ্যা (0-9) নির্ধারণ করুন</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => quickToggle('wingoEnabled', !controls.wingoEnabled, 'Wingo গেম')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black border cursor-pointer transition-all ${
                controls.wingoEnabled
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-rose-500/20 border-rose-500/50 text-rose-300'
              }`}
            >
              {controls.wingoEnabled ? 'গেম চালু ✓' : 'গেম বন্ধ ✕'}
            </button>
          </div>

          <div className="bg-[#0b1019] border border-[#1f2c42] rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-300">পরবর্তী Wingo সংখ্যা সেট (0 - 9)</span>
              {controls.wingoForceNumber !== null ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-black px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                    সেট: {controls.wingoForceNumber} ({controls.wingoForceNumber >= 5 ? 'Big' : 'Small'})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateControls(
                        { ...controls, wingoForceNumber: null },
                        'Wingo অটো মোড চালু',
                        'ফোর্স রেজাল্ট রিসেট করা হয়েছে।'
                      )
                    }
                    className="text-[10px] px-2 py-0.5 rounded bg-[#1b2538] text-slate-300 hover:text-white cursor-pointer"
                  >
                    রিসেট
                  </button>
                </div>
              ) : (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  অটো মোড
                </span>
              )}
            </div>

            <div className="grid grid-cols-5 gap-2">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
                const meta = getWingoNumColor(num);
                const selected = controls.wingoForceNumber === num;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() =>
                      onUpdateControls(
                        { ...controls, wingoForceNumber: num },
                        `Wingo রেজাল্ট "${num}" সেট হয়েছে`,
                        `পরবর্তী Wingo রাউন্ডের ফলাফল হবে ${num} (${meta.label} • ${num >= 5 ? 'Big' : 'Small'})।`
                      )
                    }
                    className={`py-2 rounded-xl bg-gradient-to-br ${meta.bg} text-white font-black text-sm flex flex-col items-center justify-center cursor-pointer transition-all active:scale-95 ${
                      selected ? 'ring-2 ring-amber-300 scale-105 shadow-lg' : 'opacity-85 hover:opacity-100'
                    }`}
                  >
                    <span className="font-mono text-base leading-none">{num}</span>
                    <span className="text-[9px] font-bold opacity-90 mt-0.5">
                      {num >= 5 ? 'Big' : 'Small'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI Signal Predictor Toggle */}
          <div className="flex items-center justify-between bg-[#0b1019] border border-[#1f2c42] rounded-xl p-3">
            <div>
              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>AI সিগন্যাল প্রেডিক্টর উইজেট</span>
              </p>
              <p className="text-[10px] text-slate-400">বন্ধ করলে ইউজারদের স্ক্রিনে AI সিগন্যাল দেখাবে না</p>
            </div>
            <button
              type="button"
              onClick={() =>
                quickToggle('aiPredictorEnabled', !controls.aiPredictorEnabled, 'AI সিগন্যাল প্রেডিক্টর')
              }
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black border cursor-pointer ${
                controls.aiPredictorEnabled
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
              }`}
            >
              {controls.aiPredictorEnabled ? 'চালু' : 'বন্ধ'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== TAB: BONUSES & 100% INVITE REFERRALS ====================
  if (activeTab === 'bonuses') {
    return (
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
        {/* Bonus Configuration Card */}
        <div className="bg-[#111927] border border-amber-500/35 rounded-2xl p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-black text-white flex items-center gap-2">
              <Gift className="w-4 h-4 text-amber-400" />
              <span>বোনাস ও ইনভাইট ১০০% কন্ট্রোল</span>
            </h4>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
              লাইভ কনফিগ
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Invite Bonus Toggle */}
            <div className="bg-[#0b1019] border border-[#1f2c42] rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white">ইনভাইট বোনাস</p>
                <p className="text-[10px] text-slate-400">১ম ডিপোজিটে {controls.inviteBonusPercent}%</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  quickToggle('inviteBonusEnabled', !controls.inviteBonusEnabled, 'ইনভাইট বোনাস সিস্টেম')
                }
                className={`px-3 py-1 rounded-lg text-xs font-black border cursor-pointer ${
                  controls.inviteBonusEnabled
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                }`}
              >
                {controls.inviteBonusEnabled ? 'চালু' : 'বন্ধ'}
              </button>
            </div>

            {/* Daily Bonus Toggle */}
            <div className="bg-[#0b1019] border border-[#1f2c42] rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white">ডেইলি বোনাস হাব</p>
                <p className="text-[10px] text-slate-400">৭ দিনের স্ট্রিক ও ডেইলি</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  quickToggle('dailyBonusEnabled', !controls.dailyBonusEnabled, 'ডেইলি বোনাস')
                }
                className={`px-3 py-1 rounded-lg text-xs font-black border cursor-pointer ${
                  controls.dailyBonusEnabled
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                }`}
              >
                {controls.dailyBonusEnabled ? 'চালু' : 'বন্ধ'}
              </button>
            </div>

            {/* Lucky Spinner Toggle */}
            <div className="bg-[#0b1019] border border-[#1f2c42] rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white">লাকি স্পিনার</p>
                <p className="text-[10px] text-slate-400">দৈনিক পপআপ স্পিন</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  quickToggle('luckySpinnerEnabled', !controls.luckySpinnerEnabled, 'লাকি স্পিনার')
                }
                className={`px-3 py-1 rounded-lg text-xs font-black border cursor-pointer ${
                  controls.luckySpinnerEnabled
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                }`}
              >
                {controls.luckySpinnerEnabled ? 'চালু' : 'বন্ধ'}
              </button>
            </div>
          </div>

          {/* Numeric Bonus Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">
                ইনভাইট বোনাস হার (%)
              </label>
              <input
                type="number"
                min={0}
                max={300}
                value={controls.inviteBonusPercent}
                onChange={(e) =>
                  onUpdateControls(
                    { ...controls, inviteBonusPercent: Math.max(0, Number(e.target.value) || 0) }
                  )
                }
                className="w-full bg-[#0b1019] border border-[#26354e] rounded-xl px-3 py-2 text-xs font-mono font-bold text-amber-300 focus:outline-hidden focus:border-amber-400"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">
                প্রথম ডিপোজিট বোনাস (%)
              </label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={firstDepPercentInput}
                  onChange={(e) => setFirstDepPercentInput(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-[#0b1019] border border-[#26354e] rounded-xl px-3 py-2 text-xs font-mono font-bold text-emerald-300 focus:outline-hidden focus:border-emerald-400"
                />
                <button
                  type="button"
                  onClick={() => onUpdateFirstDepositPercent(firstDepPercentInput)}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer shrink-0"
                >
                  সেভ
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">
                সাইনআপ ওয়েলকাম বোনাস (৳)
              </label>
              <input
                type="number"
                min={0}
                max={2000}
                value={controls.signupBonusAmount}
                onChange={(e) =>
                  onUpdateControls(
                    { ...controls, signupBonusAmount: Math.max(0, Number(e.target.value) || 0) }
                  )
                }
                className="w-full bg-[#0b1019] border border-[#26354e] rounded-xl px-3 py-2 text-xs font-mono font-bold text-cyan-300 focus:outline-hidden focus:border-cyan-400"
              />
            </div>
          </div>
        </div>

        {/* Live Referrals & 100% Invite Bonus Monitor */}
        <div className="bg-[#111927] border border-[#202d44] rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-black text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-400" />
                <span>সকল ইনভাইট ও ১০০% রেফারেল রেকর্ড</span>
              </h4>
              <p className="text-[11px] text-slate-400">
                মোট ইনভাইট: {allReferrals.length} জন • ১ম ডিপোজিট সম্পন্ন: {stats.rewardedReferralsCount} জন • মোট বোনাস: ৳{stats.totalReferralBonusPaid.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-[#0b1019] p-1 rounded-xl border border-[#1d273a]">
              {(['all', 'rewarded', 'pending_deposit'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setRefFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                    refFilter === f
                      ? 'bg-amber-500 text-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f === 'all' ? 'সকল' : f === 'rewarded' ? 'বোনাস পেয়েছে' : '১ম ডিপোজিট বাকি'}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={refSearch}
                onChange={(e) => setRefSearch(e.target.value)}
                placeholder="রেফার কোড বা ফোন নম্বর খুঁজুন..."
                className="w-full bg-[#0b1019] border border-[#1f2c42] rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:outline-hidden focus:border-cyan-400"
              />
            </div>
          </div>

          {filteredReferrals.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 bg-[#0b1019] rounded-xl border border-[#1d273a]">
              কোনো রেফারেল রেকর্ড পাওয়া যায়নি।
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {filteredReferrals.map((r) => {
                const rewarded = r.status === 'rewarded' || (r.bonusAmount || 0) > 0;
                return (
                  <div
                    key={r.id}
                    className="bg-[#0b1019] border border-[#1e2a3f] rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-white truncate">
                        রেফারার: <span className="text-amber-300 font-mono">{r.referrerCode}</span> → বন্ধু:{' '}
                        <span className="text-cyan-300 font-mono">{r.referredName || r.referredUserCode}</span>
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {r.referredPhone || r.referredUserCode} • {new Date(r.createdAt).toLocaleDateString('bn-BD')}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      {rewarded ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-bold text-[11px]">
                          <CheckCircle2 className="w-3 h-3" />
                          +৳{(r.bonusAmount || 0).toLocaleString()}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold text-[10px]">
                          <Clock className="w-3 h-3" />
                          ১ম ডিপোজিট বাকি
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==================== TAB: APP CONTROL, LIMITS & MAINTENANCE ====================
  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
      {/* 1. System Maintenance Mode */}
      <div
        className={`rounded-2xl p-4 border space-y-3 ${
          controls.maintenanceMode
            ? 'bg-rose-950/35 border-rose-500/60'
            : 'bg-[#111927] border-[#202d44]'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                controls.maintenanceMode
                  ? 'bg-rose-500/25 text-rose-300 border-rose-500/50'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-black text-white">মেইনটেন্যান্স মোড (Maintenance Mode)</h4>
              <p className="text-[11px] text-slate-400">
                চালু করলে সাধারণ ইউজাররা অ্যাপ ব্যবহার করতে পারবেন না (এডমিন লগইন ও কন্ট্রোল চালু থাকবে)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              quickToggle('maintenanceMode', !controls.maintenanceMode, 'মেইনটেন্যান্স মোড')
            }
            className={`px-3.5 py-2 rounded-xl text-xs font-black border cursor-pointer shrink-0 transition-all ${
              controls.maintenanceMode
                ? 'bg-rose-600 text-white border-rose-400 shadow-lg'
                : 'bg-[#1a2436] text-slate-300 border-[#2b3a54] hover:text-white'
            }`}
          >
            {controls.maintenanceMode ? 'চালু আছে ●' : 'বন্ধ আছে'}
          </button>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-300 block mb-1">মেইনটেন্যান্স নোটিশ বার্তা</label>
          <textarea
            rows={2}
            value={controls.maintenanceMessage}
            onChange={(e) =>
              onUpdateControls({ ...controls, maintenanceMessage: e.target.value })
            }
            className="w-full bg-[#0b1019] border border-[#24334c] rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-rose-400"
          />
        </div>
      </div>

      {/* 2. Access Toggles */}
      <div className="bg-[#111927] border border-[#202d44] rounded-2xl p-4 space-y-3">
        <h4 className="text-sm font-black text-white flex items-center gap-2">
          <Sliders className="w-4 h-4 text-cyan-400" />
          <span>অ্যাপ অ্যাক্সেস ও ফিচার সুইচ</span>
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {[
            {
              key: 'depositsEnabled' as const,
              title: 'এড মানি / ডিপোজিট',
              desc: 'ইউজার ডিপোজিট রিকোয়েস্ট',
            },
            {
              key: 'withdrawalsEnabled' as const,
              title: 'ক্যাশআউট / উইথড্র',
              desc: 'ইউজার উত্তোলন রিকোয়েস্ট',
            },
            {
              key: 'registrationEnabled' as const,
              title: 'নতুন একাউন্ট রেজিস্ট্রেশন',
              desc: 'নতুন সাইন-আপ অনুমতি',
            },
          ].map((item) => {
            const active = Boolean(controls[item.key]);
            return (
              <div
                key={item.key}
                className="bg-[#0b1019] border border-[#1f2c42] rounded-xl p-3 flex items-center justify-between gap-2"
              >
                <div>
                  <p className="text-xs font-bold text-white">{item.title}</p>
                  <p className="text-[10px] text-slate-400">{item.desc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => quickToggle(item.key, !active, item.title)}
                  className={`px-3 py-1 rounded-lg text-xs font-black border cursor-pointer shrink-0 ${
                    active
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                  }`}
                >
                  {active ? 'চালু' : 'বন্ধ'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Deposit & Withdrawal Amount Limits */}
      <div className="bg-[#111927] border border-[#202d44] rounded-2xl p-4 space-y-3">
        <h4 className="text-sm font-black text-white flex items-center gap-2">
          <Wallet className="w-4 h-4 text-emerald-400" />
          <span>ডিপোজিট ও উত্তোলনের লিমিট (৳)</span>
        </h4>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1">সর্বনিম্ন ডিপোজিট (৳)</label>
            <input
              type="number"
              min={10}
              value={controls.minDepositAmount}
              onChange={(e) =>
                onUpdateControls({ ...controls, minDepositAmount: Number(e.target.value) || 100 })
              }
              className="w-full bg-[#0b1019] border border-[#26354e] rounded-xl px-3 py-2 text-xs font-mono font-bold text-emerald-300"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1">সর্বোচ্চ ডিপোজিট (৳)</label>
            <input
              type="number"
              min={500}
              value={controls.maxDepositAmount}
              onChange={(e) =>
                onUpdateControls({ ...controls, maxDepositAmount: Number(e.target.value) || 50000 })
              }
              className="w-full bg-[#0b1019] border border-[#26354e] rounded-xl px-3 py-2 text-xs font-mono font-bold text-emerald-300"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1">সর্বনিম্ন উত্তোলন (৳)</label>
            <input
              type="number"
              min={50}
              value={controls.minWithdrawAmount}
              onChange={(e) =>
                onUpdateControls({ ...controls, minWithdrawAmount: Number(e.target.value) || 500 })
              }
              className="w-full bg-[#0b1019] border border-[#26354e] rounded-xl px-3 py-2 text-xs font-mono font-bold text-rose-300"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1">সর্বোচ্চ উত্তোলন (৳)</label>
            <input
              type="number"
              min={500}
              value={controls.maxWithdrawAmount}
              onChange={(e) =>
                onUpdateControls({ ...controls, maxWithdrawAmount: Number(e.target.value) || 50000 })
              }
              className="w-full bg-[#0b1019] border border-[#26354e] rounded-xl px-3 py-2 text-xs font-mono font-bold text-rose-300"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={isSavingControls}
          onClick={() =>
            onUpdateControls(
              controls,
              'অ্যাপ লিমিট ও সেটিংস সংরক্ষিত!',
              'ডিপোজিট/উত্তোলন লিমিট এবং অ্যাক্সেস কন্ট্রোল ফায়ারবেস ক্লাউডে আপডেট হয়েছে।'
            )
          }
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white font-black text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-98 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          <span>{isSavingControls ? 'সংরক্ষণ হচ্ছে...' : 'সব কন্ট্রোল ক্লাউডে সেভ করুন'}</span>
        </button>
      </div>
    </div>
  );
};
