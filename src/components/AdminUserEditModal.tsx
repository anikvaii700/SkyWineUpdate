import React, { useState } from 'react';
import {
  X,
  User as UserIcon,
  Lock,
  Phone,
  Coins,
  Save,
  RotateCcw,
  Sparkles,
  Check,
  Copy,
  AlertCircle,
  KeyRound,
  ShieldAlert,
  Clock,
  Ban,
  UserCheck,
} from 'lucide-react';
import {
  StoredPhoneAccount,
  adminUpdatePhoneAccount,
  getStoredPhoneAccounts,
  checkAccountSuspensionStatus,
} from '../services/phoneAuth';
import { calculateWithdrawableBalance } from '../services/userManagement';
import { soundManager } from '../services/audio';

interface AdminUserEditModalProps {
  userAccount: StoredPhoneAccount | null;
  onClose: () => void;
  onSaved: () => void;
}

export const AdminUserEditModal: React.FC<AdminUserEditModalProps> = ({
  userAccount,
  onClose,
  onSaved,
}) => {
  if (!userAccount) return null;

  const [userCode, setUserCode] = useState(userAccount.userCode || '');
  const [phoneNumber, setPhoneNumber] = useState(userAccount.phoneNumber || '');
  const [password, setPassword] = useState(userAccount.password || '');
  const [displayName, setDisplayName] = useState(userAccount.displayName || '');
  const [balance, setBalance] = useState<number>(userAccount.balance || 0);
  const [lockedPrincipal, setLockedPrincipal] = useState<number>(
    userAccount.lockedPrincipal !== undefined ? userAccount.lockedPrincipal : userAccount.balance
  );

  // ৩। ইউজারকে সাময়িকভাবে/পার্মানেন্ট/টাইম সেট করে ডিএক্টিভ করে রাখার কন্ট্রোল
  const [accountStatus, setAccountStatus] = useState<'active' | 'suspended' | 'banned'>(
    userAccount.status || 'active'
  );
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(
    userAccount.suspendedUntil || null
  );
  const [deactivationReason, setDeactivationReason] = useState<string>(
    userAccount.deactivationReason || ''
  );
  const [customDateTime, setCustomDateTime] = useState<string>(() => {
    if (userAccount.suspendedUntil) {
      try {
        const d = new Date(userAccount.suspendedUntil);
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      } catch {}
    }
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [copiedCredentials, setCopiedCredentials] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Set quick suspension preset
  const handleSetDurationPreset = (hours: number) => {
    soundManager.playClick();
    setAccountStatus('suspended');
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    setSuspendedUntil(until);
    try {
      const d = new Date(until);
      setCustomDateTime(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    } catch {}
  };

  // Generate random new User ID
  const handleGenerateNewId = () => {
    soundManager.playClick();
    const accounts = getStoredPhoneAccounts();
    const existing = new Set(Object.values(accounts).map((a) => a.userCode?.toUpperCase()));
    for (let i = 0; i < 200; i++) {
      const code = `USER-${Math.floor(10000 + Math.random() * 90000)}`;
      if (!existing.has(code)) {
        setUserCode(code);
        return;
      }
    }
  };

  // Copy full user credentials
  const handleCopyCredentials = () => {
    const hasDep = Boolean(userAccount.hasDeposited || (userAccount.totalDeposited && userAccount.totalDeposited > 0));
    const withdrawable = calculateWithdrawableBalance(balance, lockedPrincipal, hasDep, userAccount.totalDeposited);
    const text = `🎮 Aviator গেম একাউন্ট তথ্য
━━━━━━━━━━━━━━━━━
ইউজার আইডি: ${userCode}
মোবাইল নম্বর: +88 ${phoneNumber}
পাসওয়ার্ড / পিন: ${password}
বর্তমান ব্যালেন্স: ৳ ${balance.toFixed(2)}
উত্তোলনযোগ্য ব্যালেন্স: ৳ ${withdrawable.toFixed(2)}
স্ট্যাটাস: ${accountStatus === 'active' ? 'সক্রিয়' : accountStatus === 'suspended' ? 'সাময়িক ডিঅ্যাক্টিভ' : 'স্থায়ী ব্যান'}
রেফারেল কোড: ${userCode}
━━━━━━━━━━━━━━━━━`;

    navigator.clipboard.writeText(text);
    setCopiedCredentials(true);
    soundManager.playClick();
    setTimeout(() => setCopiedCredentials(false), 2500);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!userCode.trim()) {
      setErrorMsg('ইউজার আইডি অবশ্যই দিতে হবে');
      return;
    }

    if (password.trim().length < 4) {
      setErrorMsg('পাসওয়ার্ড কমপক্ষে ৪ ডিজিট হতে হবে');
      return;
    }

    if (accountStatus === 'suspended') {
      if (!suspendedUntil) {
        setErrorMsg('সাময়িক ডিঅ্যাক্টিভেশনের জন্য মেয়াদ বা সময় নির্বাচন করুন');
        return;
      }
      const expiry = new Date(suspendedUntil).getTime();
      if (expiry <= Date.now()) {
        setErrorMsg('স্থগিত রাখার সময় অবশ্যই বর্তমান সময়ের চেয়ে ভবিষ্যতের হতে হবে');
        return;
      }
    }

    setIsSaving(true);
    soundManager.playClick();

    const res = adminUpdatePhoneAccount(userAccount.phoneNumber, {
      userCode: userCode.trim().toUpperCase(),
      phoneNumber: phoneNumber.trim(),
      password: password.trim(),
      displayName: displayName.trim(),
      balance: Math.max(0, balance),
      lockedPrincipal: Math.max(0, lockedPrincipal),
      status: accountStatus,
      suspendedUntil: accountStatus === 'suspended' ? suspendedUntil : null,
      deactivationReason:
        accountStatus !== 'active'
          ? deactivationReason.trim() ||
            (accountStatus === 'banned' ? 'এডমিন কর্তৃক স্থায়ী ব্যান' : 'এডমিন কর্তৃক সাময়িক স্থগিত')
          : null,
    });

    setIsSaving(false);

    if (res.success) {
      soundManager.playWin();
      setSuccessMsg('ইউজার একাউন্ট তথ্য ও স্ট্যাটাস সফলভাবে আপডেট হয়েছে!');
      setTimeout(() => {
        onSaved();
        onClose();
      }, 800);
    } else {
      setErrorMsg(res.error || 'আপডেট করতে ব্যর্থ হয়েছে');
      soundManager.playCrash();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 sm:p-4 animate-fadeIn">
      <div className="bg-[#0f1624] border border-[#23334d] rounded-3xl max-w-lg w-full shadow-2xl text-white relative max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#1b263b] flex items-center justify-between bg-gradient-to-r from-[#121c2d] to-[#162338]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                আইডি ও অ্যাকাউন্ট রিসেট / আপডেট
              </h3>
              <p className="text-xs text-slate-400">
                ইউজার আইডি ভুলে গেলে এখান থেকে রিসেট বা আপডেট করে দিন
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#1a2538] hover:bg-[#25354e] text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Quick Copy Credentials Button */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-center justify-between">
            <div className="text-xs">
              <span className="text-amber-300 font-bold block">গ্রাহককে একাউন্ট তথ্য পাঠাবেন?</span>
              <span className="text-[11px] text-slate-300">১-ক্লিকে আইডি, ফোন ও পাসওয়ার্ড কপি করুন</span>
            </div>
            <button
              type="button"
              onClick={handleCopyCredentials}
              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#120e00] font-black text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              {copiedCredentials ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCredentials ? 'কপি হয়েছে!' : 'তথ্য কপি'}</span>
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* User ID Field with Regenerate Button */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-300">
                ইউজার আইডি (User ID):
              </label>
              <button
                type="button"
                onClick={handleGenerateNewId}
                className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span>নতুন আইডি জেনারেট করুন</span>
              </button>
            </div>
            <input
              type="text"
              required
              value={userCode}
              onChange={(e) => setUserCode(e.target.value.toUpperCase())}
              placeholder="যেমন: USER-18492"
              className="w-full bg-[#0a0f18] border border-[#233148] focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-amber-300 uppercase focus:outline-hidden"
            />
          </div>

          {/* Phone Number */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">
              মোবাইল নম্বর (১১ ডিজিট):
            </label>
            <input
              type="tel"
              required
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="017xxxxxxxx"
              className="w-full bg-[#0a0f18] border border-[#233148] focus:border-cyan-400 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white focus:outline-hidden"
            />
          </div>

          {/* Password / PIN */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">
              গোপন পাসওয়ার্ড বা পিন:
            </label>
            <input
              type="text"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="যেমন: 123456"
              className="w-full bg-[#0a0f18] border border-[#233148] focus:border-rose-400 rounded-xl px-3.5 py-2.5 text-sm font-mono text-rose-300 focus:outline-hidden font-bold"
            />
          </div>

          {/* Display Name */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">
              ইউজারের নাম:
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="ইউজারের পুরো নাম"
              className="w-full bg-[#0a0f18] border border-[#233148] focus:border-cyan-400 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-hidden"
            />
          </div>

          {/* Balance & Locked Balance Adjustment */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#1d293c]">
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">
                মোট ওয়ালেট ব্যালেন্স (৳):
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={balance}
                onChange={(e) => setBalance(parseFloat(e.target.value) || 0)}
                className="w-full bg-[#0a0f18] border border-[#233148] focus:border-cyan-400 rounded-xl px-3.5 py-2 text-sm font-mono font-bold text-cyan-400 focus:outline-hidden text-right"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">
                প্লে ব্যালেন্স (ক্যাশ-ইন + বোনাস):
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={lockedPrincipal}
                onChange={(e) => setLockedPrincipal(parseFloat(e.target.value) || 0)}
                className="w-full bg-[#0a0f18] border border-[#233148] focus:border-amber-400 rounded-xl px-3.5 py-2 text-sm font-mono font-bold text-amber-300 focus:outline-hidden text-right"
              />
            </div>
          </div>

          {/* Calculated Withdrawable Profit Note */}
          <div className="bg-[#0b1019] p-3 rounded-xl border border-white/5 flex items-center justify-between text-xs">
            <span className="text-slate-400">উত্তোলনযোগ্য লাভ:</span>
            <span className="font-mono font-bold text-emerald-400 text-sm">
              ৳ {calculateWithdrawableBalance(balance, lockedPrincipal, Boolean(userAccount.hasDeposited || (userAccount.totalDeposited && userAccount.totalDeposited > 0)), userAccount.totalDeposited).toFixed(2)}
            </span>
          </div>

          {/* ==================== ৩। অ্যাকাউন্ট স্ট্যাটাস ও ডিঅ্যাক্টিভেশন কন্ট্রোল ==================== */}
          <div className="pt-3 border-t border-[#1e2a3f] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>অ্যাকাউন্ট স্ট্যাটাস ও ডিঅ্যাক্টিভেশন কন্ট্রোল:</span>
              </label>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                  accountStatus === 'active'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : accountStatus === 'suspended'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                }`}
              >
                {accountStatus === 'active'
                  ? 'সক্রিয় (Active)'
                  : accountStatus === 'suspended'
                  ? 'সাময়িক স্থগিত (Suspended)'
                  : 'স্থায়ী ব্যান (Banned)'}
              </span>
            </div>

            {/* 3 Status Selector Buttons */}
            <div className="grid grid-cols-3 gap-2">
              {/* Active */}
              <button
                type="button"
                onClick={() => {
                  soundManager.playClick();
                  setAccountStatus('active');
                  setSuspendedUntil(null);
                }}
                className={`py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${
                  accountStatus === 'active'
                    ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300 shadow-md ring-1 ring-emerald-500/50'
                    : 'bg-[#0a0f18] border-[#223148] text-slate-400 hover:text-white'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>সক্রিয়</span>
              </button>

              {/* Temporary Suspend */}
              <button
                type="button"
                onClick={() => {
                  soundManager.playClick();
                  setAccountStatus('suspended');
                  if (!suspendedUntil) {
                    handleSetDurationPreset(24); // default 24h
                  }
                }}
                className={`py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${
                  accountStatus === 'suspended'
                    ? 'bg-amber-500/30 border-amber-500 text-amber-300 shadow-md ring-1 ring-amber-500/50'
                    : 'bg-[#0a0f18] border-[#223148] text-slate-400 hover:text-white'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>সাময়িক</span>
              </button>

              {/* Permanent Ban */}
              <button
                type="button"
                onClick={() => {
                  soundManager.playClick();
                  setAccountStatus('banned');
                  setSuspendedUntil(null);
                }}
                className={`py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${
                  accountStatus === 'banned'
                    ? 'bg-rose-600/30 border-rose-500 text-rose-300 shadow-md ring-1 ring-rose-500/50'
                    : 'bg-[#0a0f18] border-[#223148] text-slate-400 hover:text-white'
                }`}
              >
                <Ban className="w-3.5 h-3.5" />
                <span>স্থায়ী ব্যান</span>
              </button>
            </div>

            {/* If Suspended: Preset buttons & Custom DateTime Picker */}
            {accountStatus === 'suspended' && (
              <div className="bg-[#121927] border border-amber-500/30 rounded-2xl p-3.5 space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-300 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>স্থগিতাদেশের মেয়াদ সিলেক্ট করুন:</span>
                  </span>
                  {suspendedUntil && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      মেয়াদ: {new Date(suspendedUntil).toLocaleString('bn-BD', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                </div>

                {/* Duration Presets */}
                <div className="grid grid-cols-5 gap-1.5">
                  {[
                    { label: '১ ঘণ্টা', hours: 1 },
                    { label: '৬ ঘণ্টা', hours: 6 },
                    { label: '২৪ ঘণ্টা', hours: 24 },
                    { label: '৩ দিন', hours: 72 },
                    { label: '৭ দিন', hours: 168 },
                  ].map((p) => {
                    return (
                      <button
                        key={p.hours}
                        type="button"
                        onClick={() => handleSetDurationPreset(p.hours)}
                        className="py-1.5 px-1 rounded-xl bg-[#0b1018] border border-[#223148] hover:border-amber-400 text-slate-300 hover:text-white text-[11px] font-bold text-center transition-all cursor-pointer active:scale-95"
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Date & Time Picker */}
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    অথবা নির্দিষ্ট তারিখ ও সময় সেট করুন:
                  </label>
                  <input
                    type="datetime-local"
                    value={customDateTime}
                    onChange={(e) => {
                      setCustomDateTime(e.target.value);
                      if (e.target.value) {
                        try {
                          const dateObj = new Date(e.target.value);
                          setSuspendedUntil(dateObj.toISOString());
                        } catch {}
                      }
                    }}
                    className="w-full bg-[#0a0f18] border border-[#233148] focus:border-amber-400 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-hidden"
                  />
                </div>
              </div>
            )}

            {/* Deactivation Reason (for both suspended and banned) */}
            {accountStatus !== 'active' && (
              <div className="space-y-1.5 animate-fadeIn">
                <label className="text-xs font-bold text-slate-300 block">
                  ডিঅ্যাক্টিভ বা ব্যান করার কারণ:
                </label>
                <input
                  type="text"
                  value={deactivationReason}
                  onChange={(e) => setDeactivationReason(e.target.value)}
                  placeholder="যেমন: নিয়ম লঙ্ঘন / ডিপোজিট ছাড়া উইথড্র অপচেষ্টা"
                  className="w-full bg-[#0a0f18] border border-rose-500/40 focus:border-rose-400 rounded-xl px-3.5 py-2 text-xs text-rose-200 placeholder-slate-500 focus:outline-hidden"
                />
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-[#120e00] font-black text-sm uppercase tracking-wider rounded-2xl shadow-xl shadow-amber-500/20 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4 font-bold" />
            <span>{isSaving ? 'সংরক্ষণ হচ্ছে...' : 'একাউন্ট তথ্য ও স্ট্যাটাস সংরক্ষণ (Save Changes)'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
