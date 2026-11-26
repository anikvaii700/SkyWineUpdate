import React, { useState, useEffect } from 'react';
import {
  X,
  LogIn,
  LogOut,
  CheckCircle2,
  ShieldCheck,
  Database,
  Cloud,
  RotateCcw,
  Mail,
  Lock,
  Eye,
  EyeOff,
  User as UserIcon,
  UserPlus,
  Sparkles,
  Copy,
  Check,
  Gift,
  Share2,
  AlertCircle,
  Link2,
} from 'lucide-react';
import { calculateWithdrawableBalance, calculateTotalLockedBonuses } from '../services/userManagement';
import {
  signInWithGoogle,
  signInWithFacebook,
  requestPasswordReset,
  logoutUser as firebaseLogout,
  UserWalletProfile,
} from '../services/firebase';
import {
  AppUser,
  buildFirestoreFallbackSession,
  registerEmailAccount,
  loginEmailAccount,
  logoutPhoneSession,
} from '../services/phoneAuth';
import { buildReferralLink, getPendingReferralCode } from '../services/referralService';
import { soundManager } from '../services/audio';
import { ApiClientError, backendApi, mapBackendMeToProfile } from '../services/backendApi';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  userProfile: UserWalletProfile | null;
  onLoginSuccess: (user: AppUser, profile: UserWalletProfile) => void;
  onLogoutSuccess: () => void;
  onResetBalance?: () => void;
  onOpenInstallModal?: () => void;
  noticeMessage?: string | null;
}

type AuthMode = 'signup' | 'login';

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  userProfile,
  onLoginSuccess,
  onLogoutSuccess,
  onResetBalance,
  noticeMessage,
}) => {
  const [authMode, setAuthMode] = useState<AuthMode>('login');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [referralCodeInput, setReferralCodeInput] = useState(() => getPendingReferralCode());
  const [hasAutoCapturedRef, setHasAutoCapturedRef] = useState(() => Boolean(getPendingReferralCode()));
  const [showPassword, setShowPassword] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [copiedRefLink, setCopiedRefLink] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync any pending ?ref= referral code when modal opens
  useEffect(() => {
    if (isOpen && !currentUser) {
      const pending = getPendingReferralCode();
      if (pending) {
        setReferralCodeInput(pending);
        setHasAutoCapturedRef(true);
        setAuthMode('signup');
      }
    }
  }, [isOpen, currentUser]);

  if (!isOpen) return null;

  // 1-Click Social Sign-In (Google or Facebook)
  const handleSocialLogin = async (provider: 'google' | 'facebook') => {
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    soundManager.playClick();
    try {
      const fbUser = provider === 'google' ? await signInWithGoogle() : await signInWithFacebook();
      if (fbUser) {
        const refToApply = referralCodeInput.trim() || getPendingReferralCode();
        let appUser: AppUser;
        let profile: UserWalletProfile;
        try {
          if (refToApply) await backendApi.updateProfile({ referralCode: refToApply });
          let me = await backendApi.getMe();
          // Admin rights come from the server's verified ADMIN_EMAILS allowlist.
          // Store the owner's designated phone on that verified admin profile for UI routing.
          if (me.user.isAdmin && me.user.status === 'active' && me.user.phoneNumber !== '01743224700') {
            await backendApi.updateProfile({ phoneNumber: '01743224700' });
            me = await backendApi.getMe();
          }
          profile = mapBackendMeToProfile(me, fbUser);
          appUser = {
            uid: fbUser.uid,
            userCode: me.user.userCode,
            referralCode: me.user.referralCode || me.user.userCode,
            displayName: me.user.displayName || fbUser.displayName || (provider === 'facebook' ? 'Facebook Player' : 'Google Player'),
            email: fbUser.email,
            phoneNumber: me.user.phoneNumber || fbUser.phoneNumber || null,
            photoURL: fbUser.photoURL,
            provider,
            isAdmin: me.user.isAdmin === true,
            status: me.user.status as AppUser['status'],
          };
        } catch (backendErr) {
          if (backendErr instanceof ApiClientError && backendErr.code === 'NETWORK_ERROR') {
            const fallback = await buildFirestoreFallbackSession(fbUser, undefined, refToApply);
            appUser = fallback.user;
            profile = fallback.profile;
          } else {
            throw backendErr;
          }
        }
        soundManager.playWin();
        onLoginSuccess(appUser, profile);
        setSuccessMsg(
          provider === 'facebook'
            ? 'Facebook দিয়ে লগইন সফল হয়েছে!'
            : 'Google দিয়ে লগইন সফল হয়েছে!'
        );
        onClose();
      }
    } catch (err: unknown) {
      console.warn(`${provider} sign-in attempt:`, err);
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setErrorMsg('লগইন পপআপ বন্ধ করা হয়েছে। আবার চেষ্টা করুন।');
      } else if (code === 'auth/popup-blocked') {
        setErrorMsg('ব্রাউজারে পপআপ ব্লক করা আছে। পপআপ অনুমতি দিয়ে আবার চেষ্টা করুন।');
      } else if (code === 'auth/account-exists-with-different-credential') {
        setErrorMsg('এই ইমেইলটি আগে থেকেই অন্য লগইন মাধ্যম (যেমন Google বা ইমেইল পাসওয়ার্ড) দিয়ে যুক্ত আছে। ওই মাধ্যম দিয়ে লগইন করুন।');
      } else if (code === 'auth/operation-not-allowed') {
        setErrorMsg(
          provider === 'facebook'
            ? 'Firebase Console-এ Facebook Sign-in চালু করা নেই। Authentication → Sign-in method থেকে Facebook সক্রিয় করুন।'
            : 'Firebase Console-এ Google Sign-in চালু করা নেই।'
        );
      } else {
        setErrorMsg(
          provider === 'facebook'
            ? 'Facebook দিয়ে সাইনআপ/লগইন করতে ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Google দিয়ে সাইনআপ/লগইন করতে ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Gmail & Password Sign-Up & Login
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErrorMsg('সঠিক জিমেইল ঠিকানা দিন।');
      return;
    }

    if (!password || password.length < 6) {
      setErrorMsg('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।');
      return;
    }

    if (authMode === 'signup' && password !== confirmPassword) {
      setErrorMsg('পাসওয়ার্ড দুটি মিলছে না। অনুগ্রহ করে আবার চেক করুন।');
      return;
    }

    setIsLoading(true);
    soundManager.playClick();

    try {
      if (authMode === 'signup') {
        const res = await registerEmailAccount(trimmedEmail, password, fullName, referralCodeInput);
        if (!res.success || !res.user || !res.profile) {
          setErrorMsg(res.error || 'অ্যাকাউন্ট তৈরি করা যায়নি');
          if (res.error?.includes('আগে থেকেই')) {
            setAuthMode('login');
          }
          return;
        }

        soundManager.playWin();
        setSuccessMsg('জিমেইল দিয়ে সাইনআপ সফল হয়েছে!');
        onLoginSuccess(res.user, res.profile);
        onClose();
      } else {
        const res = await loginEmailAccount(trimmedEmail, password, referralCodeInput);
        if (!res.success || !res.user || !res.profile) {
          setErrorMsg(res.error || 'লগইন ব্যর্থ হয়েছে।');
          return;
        }

        soundManager.playWin();
        setSuccessMsg('জিমেইল দিয়ে লগইন সফল হয়েছে!');
        onLoginSuccess(res.user, res.profile);
        onClose();
      }
    } catch (err: unknown) {
      console.warn('Email auth notice:', err);
      setErrorMsg('প্রক্রিয়া সম্পন্ন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email.trim()) {
      setErrorMsg('পাসওয়ার্ড রিসেটের জন্য জিমেইল ঠিকানা লিখুন।');
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await requestPasswordReset(email);
      setSuccessMsg('পাসওয়ার্ড রিসেট লিংক আপনার জিমেইলে পাঠানো হয়েছে।');
    } catch {
      setErrorMsg('রিসেট লিংক পাঠানো যায়নি। জিমেইল ঠিকানা যাচাই করুন।');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    soundManager.playClick();
    try {
      await firebaseLogout();
    } catch {}
    logoutPhoneSession();
    onLogoutSuccess();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4 animate-fadeIn">
      <div 
        className="bg-[#121824] border border-[#24334c] rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl text-white relative max-h-[92vh] overflow-y-auto overscroll-contain scroll-smooth"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#1e2a3f]">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold leading-tight">ইউজার অ্যাকাউন্ট ও ওয়ালেট</h2>
              <p className="text-[11px] text-slate-400">একাউন্ট তৈরি ও সরাসরি লগইন</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#1b2537] hover:bg-[#253248] text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-4 space-y-4">
          {currentUser ? (
            /* Logged in state */
            <div className="space-y-4">
              <div className="bg-[#0b0e15] border border-[#1d273a] rounded-2xl p-4 flex items-center gap-3">
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt={currentUser.displayName || 'User'}
                    className="w-12 h-12 rounded-full border-2 border-emerald-500 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 text-white font-bold flex items-center justify-center text-lg shrink-0 border border-emerald-400/40 shadow-inner">
                    {currentUser.displayName?.charAt(0)?.toUpperCase() || currentUser.email?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                )}
                <div className="overflow-hidden min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-sm text-white truncate">
                      {currentUser.displayName || userProfile?.displayName || 'Player'}
                    </h3>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  </div>
                  {currentUser.email ? (
                    <p className="text-xs text-slate-400 truncate">{currentUser.email}</p>
                  ) : null}
                  <div className="flex items-center gap-1 text-[11px] text-emerald-400 mt-1 font-mono">
                    <Cloud className="w-3 h-3" />
                    <span>
                      {currentUser.provider === 'google'
                        ? 'Google Cloud Sync Active'
                        : currentUser.provider === 'facebook'
                        ? 'Facebook Cloud Sync Active'
                        : 'Gmail Cloud Sync Active'}
                    </span>
                  </div>
                </div>
              </div>

              {/* User ID & Credentials Card */}
              {(() => {
                const userCode = userProfile?.userCode || currentUser.userCode || `USER-${currentUser.uid.slice(-5)}`;
                const balance = userProfile?.balance || 0;
                const locked = calculateTotalLockedBonuses({
                  initialBonus: userProfile?.initialBonus,
                  referralBonusEarned: userProfile?.referralBonusEarned,
                  inviteBonusBalance: userProfile?.inviteBonusBalance,
                  firstDepositBonusEarned: userProfile?.firstDepositBonusEarned,
                  rewardBonusEarned: userProfile?.rewardBonusEarned,
                  lockedPrincipal: userProfile?.lockedPrincipal,
                });
                const hasDep = Boolean(userProfile?.hasDeposited || (userProfile?.totalDeposited && userProfile.totalDeposited > 0));
                const withdrawable = calculateWithdrawableBalance(balance, locked, hasDep, userProfile?.totalDeposited);
                const referralCount = userProfile?.referralCount || 0;
                const referralBonus = userProfile?.referralBonusEarned || 0;
                const referralLink = buildReferralLink(userCode);

                const copyUserId = () => {
                  navigator.clipboard.writeText(userCode);
                  setCopiedId(true);
                  soundManager.playClick();
                  setTimeout(() => setCopiedId(false), 2000);
                };

                const copyReferral = () => {
                  navigator.clipboard.writeText(userCode);
                  setCopiedReferral(true);
                  soundManager.playClick();
                  setTimeout(() => setCopiedReferral(false), 2000);
                };

                const copyReferralLink = () => {
                  navigator.clipboard.writeText(referralLink);
                  setCopiedRefLink(true);
                  soundManager.playClick();
                  setTimeout(() => setCopiedRefLink(false), 2000);
                };

                return (
                  <>
                    {/* User ID Badge */}
                    <div className="bg-[#0b1019] border border-[#1e2a3f] rounded-2xl p-3 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-medium">আপনার ইউজার আইডি (User ID):</span>
                        <span className="font-mono text-sm font-bold text-amber-400 tracking-wider">
                          {userCode}
                        </span>
                      </div>
                      <button
                        onClick={copyUserId}
                        className="px-2.5 py-1.5 rounded-xl bg-[#172233] hover:bg-[#202f47] border border-[#263752] text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="আইডি কপি করুন"
                      >
                        {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedId ? 'কপি হয়েছে!' : 'কপি আইডি'}</span>
                      </button>
                    </div>

                    {/* Balance & Withdrawable Breakdown Card */}
                    <div className="bg-[#0e1422] border border-[#1f2c42] rounded-2xl p-3.5 space-y-2.5 text-xs">
                      <div className="flex justify-between items-center text-slate-300">
                        <span className="font-medium">মোট ওয়ালেট ব্যালেন্স:</span>
                        <div className="flex items-center gap-2">
                          <span className="font-bold font-mono text-base text-cyan-300">
                            ৳ {balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          {onResetBalance && (
                            <button
                              onClick={() => {
                                soundManager.playClick();
                                onResetBalance();
                              }}
                              className="px-2 py-1 rounded-lg bg-[#1a2334] hover:bg-[#25324c] text-[10px] text-slate-300 hover:text-white border border-[#2b3952] flex items-center gap-1 transition-colors cursor-pointer"
                              title="ব্যালেন্স ০ করুন"
                            >
                              <RotateCcw className="w-3 h-3 text-amber-400" />
                              <span>০ করুন</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1b263b]">
                        <div className="bg-[#080c14] p-2 rounded-xl border border-white/5">
                          <span className="text-[10px] text-slate-400 block">লকড বোনাস (ইনভাইট ও অন্যান্য):</span>
                          <span className="font-bold text-xs text-amber-300 font-mono">
                            ৳ {locked.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="bg-[#080c14] p-2 rounded-xl border border-white/5">
                          <span className="text-[10px] text-slate-400 block">উত্তোলনযোগ্য ব্যালেন্স:</span>
                          <span className="font-bold text-xs text-emerald-400 font-mono">
                            ৳ {withdrawable.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>

                      <p className="text-[10px] text-slate-400 bg-emerald-950/30 p-2 rounded-xl border border-emerald-900/30 leading-snug">
                        💡 <span className="text-emerald-300 font-semibold">ক্যাশআউট নিয়ম:</span> ন্যূনতম ক্যাশআউট ৫০০ টাকা। উত্তোলনের পরিমাণ উপরের উত্তোলনযোগ্য ব্যালেন্স অনুযায়ী গণনা হবে।
                      </p>
                    </div>

                    {/* Invite Bonus 100% Card */}
                    <div className="bg-gradient-to-br from-[#0e1f2d] to-[#0c1422] border border-cyan-500/40 rounded-2xl p-3.5 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-cyan-300 font-bold">
                          <Gift className="w-4 h-4" />
                          <span>ইনভাইট বোনাস ১০০%</span>
                        </div>
                        <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-black border border-cyan-500/40">
                          ১০০% বোনাস
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-300 leading-snug">
                        আপনার রেফার লিংক বা কোড ব্যবহার করে কেউ একাউন্ট করে শুরুতে যত টাকা ডিপোজিট করবে, ঠিক তত টাকা <span className="text-emerald-400 font-bold">১০০%</span> আপনার রেফার বোনাস যুক্ত হবে!
                      </p>

                      {/* Referral Link */}
                      <div className="bg-[#080c14] p-2 rounded-xl border border-[#1e2a3c] space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-cyan-300 flex items-center gap-1 font-semibold">
                            <Link2 className="w-3 h-3" />
                            <span>রেফারেল লিংক:</span>
                          </span>
                          <button
                            onClick={copyReferralLink}
                            className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                          >
                            {copiedRefLink ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedRefLink ? 'লিংক কপি হয়েছে' : 'লিংক কপি'}</span>
                          </button>
                        </div>
                        <div className="text-[10px] font-mono text-slate-300 truncate select-all">
                          {referralLink}
                        </div>
                      </div>

                      <div className="flex items-center justify-between bg-[#080c14] p-2.5 rounded-xl border border-[#1e2a3c]">
                        <div>
                          <span className="text-[10px] text-slate-400 block">আপনার রেফারেল কোড:</span>
                          <span className="font-mono font-bold text-amber-300 text-sm tracking-wider">{userCode}</span>
                        </div>
                        <button
                          onClick={copyReferral}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                        >
                          {copiedReferral ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                          <span>{copiedReferral ? 'কপি হয়েছে' : 'কোড কপি'}</span>
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-0.5">
                        <span>মোট বন্ধু ইনভাইট: <strong className="text-white font-mono">{referralCount} জন</strong></span>
                        <span>মোট ইনভাইট বোনাস: <strong className="text-emerald-400 font-mono">৳ {referralBonus.toLocaleString()}</strong></span>
                      </div>

                    </div>
                  </>
                );
              })()}

              <button
                onClick={handleLogout}
                className="w-full py-3 bg-[#1e273a] hover:bg-rose-900/60 hover:border-rose-700/60 border border-[#2b374e] text-slate-200 hover:text-white font-bold text-xs uppercase tracking-wider rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>লগআউট করুন (Sign Out)</span>
              </button>
            </div>
          ) : (
            /* Logged out state - Gmail & Password Auth */
            <div className="space-y-4">
              {/* Notice Banner when redirected from Add Money or Betting */}
              {noticeMessage && (
                <div className="bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-red-500/20 border border-amber-500/50 rounded-2xl p-3 flex items-start gap-2.5 text-amber-200 text-xs shadow-md">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-bold text-amber-300 block mb-0.5">একাউন্ট তৈরি আবশ্যক!</span>
                    <p className="text-[11px] text-amber-100/95 leading-relaxed">{noticeMessage}</p>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 px-3 py-2 text-center text-xs text-emerald-300">
                Google, Facebook অথবা জিমেইল ও পাসওয়ার্ড দিয়ে প্রবেশ করুন
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs leading-relaxed animate-fadeIn">
                  {errorMsg}
                </div>
              )}
              {successMsg && (
                <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs leading-relaxed flex items-center gap-2 animate-fadeIn">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* 1-CLICK GOOGLE & FACEBOOK LOGIN */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleSocialLogin('google')}
                  disabled={isLoading}
                  className="w-full py-2.5 px-3 bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs rounded-xl shadow-md active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Google দিয়ে লগইন</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSocialLogin('facebook')}
                  disabled={isLoading}
                  className="w-full py-2.5 px-3 bg-[#1877F2] hover:bg-[#166FE5] text-white font-bold text-xs rounded-xl shadow-md active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <svg className="w-4 h-4 shrink-0 fill-current" viewBox="0 0 24 24">
                    <path d="M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0z" />
                  </svg>
                  <span>Facebook দিয়ে লগইন</span>
                </button>
              </div>

              <div className="relative flex items-center py-1">
                <div className="grow border-t border-[#222e43]" />
                <span className="shrink mx-3 text-[11px] font-semibold text-slate-400">
                  অথবা মেইল ও পাসওয়ার্ড দিয়ে
                </span>
                <div className="grow border-t border-[#222e43]" />
              </div>

              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-slate-300 font-medium">
                  {authMode === 'signup' ? 'নতুন অ্যাকাউন্ট খুলুন:' : 'বিদ্যমান অ্যাকাউন্টে প্রবেশ করুন:'}
                </span>
                <div className="flex gap-1 bg-[#151c2a] p-0.5 rounded-lg border border-[#222e43]">
                  <button type="button" onClick={() => { setAuthMode('signup'); setErrorMsg(null); setSuccessMsg(null); }}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${authMode === 'signup' ? 'bg-emerald-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
                    সাইনআপ
                  </button>
                  <button type="button" onClick={() => { setAuthMode('login'); setErrorMsg(null); setSuccessMsg(null); }}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${authMode === 'login' ? 'bg-emerald-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
                    লগইন
                  </button>
                </div>
              </div>

              {/* EMAIL & PASSWORD SIGNUP & LOGIN */}
              <div className="space-y-4">
                <div className="bg-[#0b0e15] border border-[#1d273a] rounded-2xl p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4" />
                  </div>
                  <p className="text-xs text-slate-300 leading-snug">
                    {authMode === 'signup'
                      ? 'আপনার মেইল এড্রেস ও পাসওয়ার্ড দিয়ে নতুন অ্যাকাউন্ট খুলুন।'
                      : 'আপনার নিবন্ধিত মেইল এড্রেস ও পাসওয়ার্ড দিয়ে লগইন করুন।'}
                  </p>
                </div>

                <form onSubmit={handleEmailSubmit} className="space-y-3">
                  {authMode === 'signup' && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        আপনার নাম (ঐচ্ছিক)
                      </label>
                      <div className="relative">
                        <UserIcon className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                        <input
                          type="text"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="যেমন: তানভীর আহমেদ"
                          className="w-full bg-[#0d121c] border border-[#232f44] rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 transition-colors"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">
                      মেইল এড্রেস <span className="text-rose-400">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="example@gmail.com"
                        className="w-full bg-[#0d121c] border border-[#232f44] rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">
                      গোপন পাসওয়ার্ড (কমপক্ষে ৬ অক্ষরের) <span className="text-rose-400">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••"
                        className="w-full bg-[#0d121c] border border-[#232f44] rounded-xl pl-9 pr-10 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-3 text-slate-400 hover:text-white"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {authMode === 'login' && (
                    <div className="flex flex-wrap gap-3 text-[11px]">
                      <button type="button" onClick={handlePasswordReset} disabled={isLoading} className="text-sky-400 hover:text-sky-300">
                        পাসওয়ার্ড ভুলে গেছেন?
                      </button>
                    </div>
                  )}

                  {authMode === 'signup' && (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">
                          পাসওয়ার্ড পুনরায় লিখুন <span className="text-rose-400">*</span>
                        </label>
                        <div className="relative">
                          <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            required
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="••••••"
                            className="w-full bg-[#0d121c] border border-[#232f44] rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 transition-colors"
                          />
                        </div>
                      </div>

                      {/* Referral Code Input */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[11px] font-bold text-slate-300">
                            রেফারেল কোড (ঐচ্ছিক)
                          </label>
                          <span className="text-[10px] text-amber-400 font-semibold">
                            {hasAutoCapturedRef && referralCodeInput
                              ? '✓ রেফার লিংক থেকে যুক্ত হয়েছে'
                              : 'কারো ইনভাইট থাকলে দিন'}
                          </span>
                        </div>
                        <div className="relative">
                          <Sparkles className="w-4 h-4 absolute left-3 top-3 text-amber-400" />
                          <input
                            type="text"
                            value={referralCodeInput}
                            onChange={(e) => {
                              setReferralCodeInput(e.target.value.toUpperCase());
                              setHasAutoCapturedRef(false);
                            }}
                            placeholder="যেমন: USER-18492"
                            className={`w-full bg-[#0d121c] border rounded-xl pl-9 pr-3 py-2.5 text-xs uppercase font-mono text-amber-300 placeholder-slate-500 focus:outline-hidden focus:border-amber-400 transition-colors ${
                              hasAutoCapturedRef && referralCodeInput
                                ? 'border-emerald-500/60 bg-emerald-950/20'
                                : 'border-[#232f44]'
                            }`}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs rounded-xl shadow-lg active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {authMode === 'signup' ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                    <span>
                      {isLoading
                        ? 'প্রক্রিয়াধীন...'
                        : authMode === 'signup'
                        ? 'মেইল ও পাসওয়ার্ড দিয়ে সাইনআপ করুন'
                        : 'মেইল ও পাসওয়ার্ড দিয়ে লগইন করুন'}
                    </span>
                  </button>
                </form>
              </div>

              {/* Security info note */}
              <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-[#0c1017] p-2.5 rounded-xl border border-[#192231]">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  আপনার অ্যাকাউন্ট ক্লাউড ওয়ালেটে সংরক্ষিত। নতুন অ্যাকাউন্টের প্রারম্ভিক ব্যালেন্স ৳ ০.০০।
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
