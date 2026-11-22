import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  RotateCcw,
  AlertCircle,
  Copy,
  Clock,
  ShieldCheck,
  Send,
  History,
  CheckCircle2,
  XCircle,
  Info,
  AlertTriangle,
  Sparkles,
  PlusCircle,
} from 'lucide-react';
import { soundManager } from '../services/audio';
import { Language, translations } from '../utils/i18n';
import { AppUser, getActivePhoneSession, getStoredPhoneAccounts } from '../services/phoneAuth';
import { UserWalletProfile, auth } from '../services/firebase';
import { backendApi } from '../services/backendApi';
import { calculateWithdrawableBalance, calculateTotalLockedBonuses } from '../services/userManagement';
import {
  SystemPaymentSettings,
  ManualDepositRequest,
  ManualWithdrawalRequest,
  getStoredPaymentSettings,
  getStoredDepositRequests,
  submitManualDepositRequest,
  getStoredWithdrawalRequests,
  submitManualWithdrawalRequest,
} from '../services/manualPayment';
import { getStoredAppControls } from '../services/appControlService';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
  onAddFunds: (amount: number) => void;
  onWithdrawFunds: (amount: number) => void;
  onResetBalance: () => void;
  initialTab?: 'deposit' | 'withdraw';
  lang: Language;
  userPhone?: string;
  currentUser?: AppUser | null;
  userProfile?: UserWalletProfile | null;
  onOpenAdminPanel?: () => void;
  onOpenAuth?: (notice?: string) => void;
}

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  currentBalance,
  onAddFunds,
  onWithdrawFunds,
  onResetBalance,
  initialTab = 'deposit',
  lang,
  userPhone,
  currentUser,
  userProfile,
  onOpenAdminPanel,
  onOpenAuth,
}) => {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [selectedMethod, setSelectedMethod] = useState<'bkash' | 'nagad' | 'rocket'>('bkash');
  const [selectedWithdrawMethod, setSelectedWithdrawMethod] = useState<'bkash' | 'nagad' | 'rocket'>('bkash');
  const [depositAmount, setDepositAmount] = useState<number>(1000);
  const [withdrawAmount, setWithdrawAmount] = useState<number>(Math.min(Math.max(currentBalance, 0), 500));
  const [senderPhone, setSenderPhone] = useState<string>(userPhone || '');
  const [trxId, setTrxId] = useState<string>('');
  const [withdrawPhone, setWithdrawPhone] = useState<string>(userPhone || '');

  // Sub-views
  const [depositView, setDepositView] = useState<'form' | 'history'>('form');
  const [withdrawView, setWithdrawView] = useState<'form' | 'history'>('form');

  // Payment settings (Admin numbers) & Requests
  const [paymentSettings, setPaymentSettings] = useState<SystemPaymentSettings>(getStoredPaymentSettings);\n  const [serverWallet, setServerWallet] = useState<{ balance: number; inviteBonusLocked: number; withdrawableBalance: number; totalDeposited: number } | null>(null);\n  const [serverMode, setServerMode] = useState<boolean>(Boolean(auth.currentUser));\n  const displayedBalance = serverMode && serverWallet ? serverWallet.balance : currentBalance;
  const [userRequests, setUserRequests] = useState<ManualDepositRequest[]>([]);
  const [userWithdrawals, setUserWithdrawals] = useState<ManualWithdrawalRequest[]>([]);

  // UI status
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submissionError, setSubmissionError] = useState<string>('');
  const [submissionSuccess, setSubmissionSuccess] = useState<ManualDepositRequest | null>(null);

  // Withdraw status
  const [isWithdrawSubmitting, setIsWithdrawSubmitting] = useState<boolean>(false);
  const [withdrawError, setWithdrawError] = useState<string>('');
  const [withdrawSuccess, setWithdrawSuccess] = useState<ManualWithdrawalRequest | null>(null);

  const [copiedNumber, setCopiedNumber] = useState<boolean>(false);
  const [showSuccessToast, setShowSuccessToast] = useState<{ type: 'deposit' | 'withdraw'; amount: number } | null>(null);

  const t = translations[lang];

  const loadData = async () => {
    const firebaseUser = auth.currentUser;
    setServerMode(Boolean(firebaseUser));

    if (firebaseUser) {
      try {
        const [configResult, meResult, depositResult, withdrawalResult] = await Promise.all([
          backendApi.getPublicConfig(),
          backendApi.getMe(),
          backendApi.listMyDeposits(100, 0),
          backendApi.listMyWithdrawals(100, 0),
        ]);
        const remoteSettings = configResult.paymentSettings as Partial<SystemPaymentSettings>;
        setPaymentSettings({ ...getStoredPaymentSettings(), ...remoteSettings } as SystemPaymentSettings);
        setServerWallet(meResult.wallet);
        // Keep the app-level display synchronized with the server wallet snapshot.
        onResetBalance();
        if (meResult.wallet.balance > 0) onAddFunds(meResult.wallet.balance);

        const depositRows = ((depositResult as { deposits?: Array<Record<string, any>> }).deposits || []);
        const withdrawalRows = ((withdrawalResult as { withdrawals?: Array<Record<string, any>> }).withdrawals || []);
        setUserRequests(depositRows.map((row) => ({
          id: String(row.id), userId: firebaseUser.uid, userCode: userProfile?.userCode || '',
          userIdentifier: currentUser?.displayName || currentUser?.phoneNumber || '',
          method: row.method, targetNumber: String(row.target_number || ''), senderNumber: String(row.sender_number || ''),
          trxId: String(row.trx_id || ''), amount: Number(row.amount || 0), status: row.status,
          createdAt: String(row.created_at || ''), updatedAt: String(row.updated_at || ''),
          rejectionReason: row.rejection_reason || undefined, adminNote: row.admin_note || undefined,
          isFirstDeposit: Boolean(row.is_first_deposit), bonusPercent: Number(row.bonus_percent || 0),
          bonusAmount: Number(row.bonus_amount || 0), totalCredited: Number(row.total_credited || 0),
        })));
        setUserWithdrawals(withdrawalRows.map((row) => ({
          id: String(row.id), userId: firebaseUser.uid, userCode: userProfile?.userCode || '',
          userIdentifier: currentUser?.displayName || currentUser?.phoneNumber || '',
          method: row.method, personalNumber: String(row.personal_number || ''),
          amount: Number(row.amount || 0), status: row.status,
          createdAt: String(row.created_at || ''), updatedAt: String(row.updated_at || ''),
          adminNote: row.admin_note || undefined, rejectionReason: row.rejection_reason || undefined,
        })));
        return;
      } catch (err) {
        console.error('Could not load wallet from backend:', err);
        setSubmissionError('সার্ভার থেকে ওয়ালেট ডাটা পাওয়া যায়নি। আবার চেষ্টা করুন।');
        return;
      }
    }

    // Legacy fallback for a pre-migration session only.
    setPaymentSettings(getStoredPaymentSettings());
    const allDeposits = getStoredDepositRequests();
    const allWithdrawals = getStoredWithdrawalRequests();
    const uid = currentUser?.uid;
    const phone = currentUser?.phoneNumber || userPhone;
    setUserRequests(allDeposits.filter((r) =>
      Boolean((uid && r.userId === uid) || (phone && (r.senderNumber === phone || r.userIdentifier.includes(phone))))
    ));
    setUserWithdrawals(allWithdrawals.filter((r) =>
      Boolean((uid && r.userId === uid) || (phone && (r.personalNumber === phone || r.userIdentifier.includes(phone))))
    ));
  };

  useEffect(() => {
    setActiveTab(initialTab);
    setDepositView('form');
    setWithdrawView('form');
    setSubmissionError('');
    setSubmissionSuccess(null);
    setWithdrawError('');
    setWithdrawSuccess(null);
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (userPhone) {
      if (!senderPhone) setSenderPhone(userPhone);
      if (!withdrawPhone) setWithdrawPhone(userPhone);
    }
  }, [userPhone]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, currentUser, userPhone]);

  useEffect(() => {
    const handleSettingsUpdated = () => { void loadData(); };
    const handleRequestsUpdated = () => loadData();
    const handleWithdrawalsUpdated = () => loadData();

    window.addEventListener('payment_settings_updated', handleSettingsUpdated);
    window.addEventListener('deposit_requests_updated', handleRequestsUpdated);
    window.addEventListener('withdrawal_requests_updated', handleWithdrawalsUpdated);

    return () => {
      window.removeEventListener('payment_settings_updated', handleSettingsUpdated);
      window.removeEventListener('deposit_requests_updated', handleRequestsUpdated);
      window.removeEventListener('withdrawal_requests_updated', handleWithdrawalsUpdated);
    };
  }, [currentUser, userPhone]);

  useEffect(() => {
    if (activeTab === 'withdraw') {
      setWithdrawAmount((prev) => (displayedBalance <= 0 ? 0 : Math.min(prev || 500, displayedBalance)));
    }
  }, [displayedBalance, activeTab]);

  if (!isOpen) return null;

  const depositPresets = [300, 500, 1000, 2000, 5000, 10000];
  const withdrawPresets = [1000, 5000, 20000, 50000];

  // Active method config from admin settings
  const currentGateway = paymentSettings[selectedMethod] || {
    number: '01712-345678',
    accountType: 'Personal',
    instructions: 'Send Money করুন',
    isActive: true,
  };

  // Check if current payment gateways are enabled by admin
  const isDepositActive = paymentSettings[selectedMethod]?.isActive !== false;
  const isWithdrawActive = paymentSettings[selectedWithdrawMethod]?.isActive !== false;

  // Copy target admin number
  const handleCopyTargetNumber = () => {
    if (currentGateway.number && isDepositActive) {
      navigator.clipboard.writeText(currentGateway.number.replace(/[^0-9]/g, ''));
      setCopiedNumber(true);
      soundManager.playClick();
      setTimeout(() => setCopiedNumber(false), 2000);
    }
  };

  // User Bonuses & Withdrawable balance calculation per strict rules:
  // 1. বোনাস পাওয়া, কমিশন পাওয়া, রেফার কমিশন ইত্যাদি সকল এক্সট্রা টাকা কখনই উইথড্র করা যাবে না।
  // 2. শুধুমাত্র উইন হওয়া টাকা উইথড্র দেওয়া যাবে।
  // 3. একাউন্টে সর্বনিম্ন ১০০ টাকা সংরক্ষিত থাকবে এবং মিনিমাম ক্যাশআউট ৫০০ টাকা।
  const getUserBonusBreakdown = () => {
    let initialBonus = 100;
    let refBonus = 0;
    let inviteBonusBal: number | undefined = undefined;
    let firstDepBonus = 0;
    let rewardBonus = 0;
    let explicitLocked = 100;
    let isFirstTime = true;
    let totalDeposited = 0;
    let hasDeposited = false;

    const phoneSession = getActivePhoneSession();
    if (phoneSession?.user.phoneNumber) {
      const accounts = getStoredPhoneAccounts();
      const acc = accounts[phoneSession.user.phoneNumber];
      if (acc) {
        initialBonus = acc.initialBonus !== undefined ? acc.initialBonus : 100;
        refBonus = acc.referralBonusEarned || 0;
        inviteBonusBal = acc.inviteBonusBalance !== undefined ? acc.inviteBonusBalance : refBonus;
        firstDepBonus = acc.firstDepositBonusEarned || 0;
        rewardBonus = acc.rewardBonusEarned || 0;
        explicitLocked = acc.lockedPrincipal || 0;
        totalDeposited = acc.totalDeposited || 0;
        hasDeposited = Boolean(acc.hasDeposited || totalDeposited > 0);
        isFirstTime = !hasDeposited;
      } else {
        initialBonus = 100;
        refBonus = phoneSession.profile.referralBonusEarned || 0;
        inviteBonusBal =
          phoneSession.profile.inviteBonusBalance !== undefined
            ? phoneSession.profile.inviteBonusBalance
            : refBonus;
        firstDepBonus = (phoneSession.profile as any).firstDepositBonusEarned || 0;
        rewardBonus = (phoneSession.profile as any).rewardBonusEarned || 0;
        explicitLocked = phoneSession.profile.lockedPrincipal || 0;
        totalDeposited = phoneSession.profile.totalDeposited || 0;
        hasDeposited = Boolean((phoneSession.profile as any).hasDeposited || totalDeposited > 0);
        isFirstTime = !hasDeposited;
      }
    } else if (userProfile) {
      initialBonus = userProfile.initialBonus !== undefined ? userProfile.initialBonus : 100;
      refBonus = userProfile.referralBonusEarned || 0;
      inviteBonusBal =
        userProfile.inviteBonusBalance !== undefined ? userProfile.inviteBonusBalance : refBonus;
      firstDepBonus = (userProfile as any).firstDepositBonusEarned || 0;
      rewardBonus = (userProfile as any).rewardBonusEarned || 0;
      explicitLocked = userProfile.lockedPrincipal || 0;
      totalDeposited = userProfile.totalDeposited || 0;
      hasDeposited = Boolean((userProfile as any).hasDeposited || totalDeposited > 0);
      isFirstTime = !hasDeposited;
    }

    // Prefer live Firestore userProfile inviteBonusBalance if available
    if (userProfile && typeof userProfile.inviteBonusBalance === 'number') {
      inviteBonusBal = userProfile.inviteBonusBalance;
    }

    const activeInviteBonus = inviteBonusBal !== undefined ? inviteBonusBal : refBonus;

    const totalLockedBonuses = serverWallet?.inviteBonusLocked ?? calculateTotalLockedBonuses({
      initialBonus,
      referralBonusEarned: refBonus,
      inviteBonusBalance: activeInviteBonus,
      firstDepositBonusEarned: firstDepBonus,
      rewardBonusEarned: rewardBonus,
      lockedPrincipal: explicitLocked,
    });

    const withdrawableAmount = serverWallet?.withdrawableBalance ??
      calculateWithdrawableBalance(displayedBalance, totalLockedBonuses, hasDeposited, totalDeposited);

    return {
      initialBonus,
      refBonus: activeInviteBonus,
      firstDepBonus,
      rewardBonus,
      totalLockedBonuses,
      withdrawableAmount,
      isFirstTime,
      hasDeposited,
      totalDeposited,
    };
  };

  const bonusInfo = getUserBonusBreakdown();

  const handleSubmitDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmissionError('');

    if (!isDepositActive) {
      setSubmissionError('এই সার্ভিসটি সাময়িক সময়ের জন্য বন্ধ আছে।');
      soundManager.playCrash();
      return;
    }
    if (!currentUser || !auth.currentUser) {
      setSubmissionError('ডিপোজিট করতে Firebase লগইন প্রয়োজন। আবার লগইন করুন।');
      soundManager.playCrash();
      return;
    }

    const appControls = getStoredAppControls();
    if (!appControls.depositsEnabled) {
      setSubmissionError('ডিপোজিট সার্ভিসটি এডমিন কর্তৃক সাময়িকভাবে বন্ধ রাখা হয়েছে।');
      soundManager.playCrash();
      return;
    }
    const cleanSender = senderPhone.replace(/[^0-9]/g, '');
    if (cleanSender.length !== 11) {
      setSubmissionError('সঠিক ১১ ডিজিটের প্রেরক নম্বর দিন।');
      soundManager.playCrash();
      return;
    }
    const cleanTrx = trxId.trim();
    if (cleanTrx.length < 5) {
      setSubmissionError('সঠিক ট্রানজেকশন আইডি (TrxID) লিখুন।');
      soundManager.playCrash();
      return;
    }

    setIsSubmitting(true);
    soundManager.playClick();
    try {
      const result = await backendApi.submitDeposit({
        method: selectedMethod,
        senderNumber: cleanSender,
        trxId: cleanTrx,
        amount: depositAmount,
      }) as { deposit?: Record<string, any> };
      const row = result.deposit || {};
      const request: ManualDepositRequest = {
        id: String(row.id), userId: auth.currentUser.uid,
        userCode: userProfile?.userCode || currentUser.userCode || '',
        userIdentifier: currentUser.displayName || currentUser.phoneNumber || '',
        method: row.method || selectedMethod, targetNumber: String(row.target_number || currentGateway.number),
        senderNumber: String(row.sender_number || cleanSender), trxId: String(row.trx_id || cleanTrx),
        amount: Number(row.amount || depositAmount), status: row.status || 'pending',
        createdAt: String(row.created_at || new Date().toISOString()),
        updatedAt: String(row.updated_at || new Date().toISOString()),
      };
      setSubmissionSuccess(request);
      setTrxId('');
      soundManager.playWin();
      await loadData();
    } catch (err) {
      const code = (err as { code?: string }).code || '';
      const messages: Record<string, string> = {
        DUPLICATE_TRX_ID: 'এই TrxID আগে জমা দেওয়া হয়েছে।',
        CONFLICT: 'এই TrxID আগে জমা দেওয়া হয়েছে।',
        AMOUNT_OUT_OF_RANGE: 'ডিপোজিটের পরিমাণ অনুমোদিত সীমার বাইরে।',
        GATEWAY_DISABLED: 'এই পেমেন্ট মেথডটি এখন বন্ধ আছে।',
        TOO_MANY_PENDING_DEPOSITS: 'আপনার একাধিক Pending ডিপোজিট আছে। আগে সেগুলো সম্পন্ন হতে দিন।',
        RATE_LIMITED: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
        NOT_SIGNED_IN: 'সেশন শেষ হয়েছে। আবার লগইন করুন।',
      };
      setSubmissionError(messages[code] || (err instanceof Error ? err.message : 'ডিপোজিট রিকোয়েস্ট পাঠানো যায়নি।'));
      soundManager.playCrash();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawError('');
    setWithdrawSuccess(null);
    if (!isWithdrawActive) {
      setWithdrawError('উত্তোলন সার্ভিসটি সাময়িকভাবে বন্ধ আছে।');
      soundManager.playCrash();
      return;
    }
    if (!currentUser || !auth.currentUser) {
      setWithdrawError('উইথড্র করতে Firebase লগইন প্রয়োজন।');
      soundManager.playCrash();
      return;
    }

    const minWth = Math.max(50, Number(getStoredAppControls().minWithdrawAmount || 500));
    const maxWth = Math.max(minWth, Number(getStoredAppControls().maxWithdrawAmount || 50000));
    if (!withdrawAmount || withdrawAmount < minWth || withdrawAmount > maxWth) {
      setWithdrawError(`উত্তোলনের পরিমাণ ৳${minWth.toLocaleString()} থেকে ৳${maxWth.toLocaleString()} এর মধ্যে হতে হবে।`);
      soundManager.playCrash();
      return;
    }
    const cleanPhone = withdrawPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.length !== 11) {
      setWithdrawError('সঠিক ১১ ডিজিটের পার্সোনাল নম্বর লিখুন।');
      soundManager.playCrash();
      return;
    }

    setIsWithdrawSubmitting(true);
    soundManager.playClick();
    try {
      const result = await backendApi.submitWithdrawal({
        method: selectedWithdrawMethod,
        personalNumber: cleanPhone,
        amount: withdrawAmount,
        idempotencyKey: `wth-${auth.currentUser.uid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }) as { withdrawal?: Record<string, any>; wallet?: { balance: number; inviteBonusLocked: number; withdrawableBalance: number; totalDeposited: number } };
      if (result.wallet) {
        setServerWallet(result.wallet);
        onResetBalance();
        if (result.wallet.balance > 0) onAddFunds(result.wallet.balance);
      }
      const row = result.withdrawal || {};
      setWithdrawSuccess({
        id: String(row.id), userId: auth.currentUser.uid,
        userCode: userProfile?.userCode || currentUser.userCode || '',
        userIdentifier: currentUser.displayName || currentUser.phoneNumber || '',
        method: row.method || selectedWithdrawMethod, personalNumber: String(row.personal_number || cleanPhone),
        amount: Number(row.amount || withdrawAmount), status: row.status || 'pending',
        createdAt: String(row.created_at || new Date().toISOString()),
        updatedAt: String(row.updated_at || new Date().toISOString()),
      });
      soundManager.playWin();
      await loadData();
    } catch (err) {
      const code = (err as { code?: string }).code || '';
      const messages: Record<string, string> = {
        INSUFFICIENT_BALANCE: 'আপনার উত্তোলনযোগ্য ব্যালেন্স যথেষ্ট নয়।',
        AMOUNT_OUT_OF_RANGE: 'উত্তোলনের পরিমাণ অনুমোদিত সীমার বাইরে।',
        TOO_MANY_PENDING_WITHDRAWALS: 'আপনার আগে থেকেই Pending উত্তোলন আছে।',
        ACCOUNT_RESTRICTED: 'আপনার অ্যাকাউন্ট সাময়িকভাবে সীমাবদ্ধ।',
        RATE_LIMITED: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
      };
      setWithdrawError(messages[code] || (err instanceof Error ? err.message : 'উত্তোলন রিকোয়েস্ট পাঠানো যায়নি।'));
      soundManager.playCrash();
    } finally {
      setIsWithdrawSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 sm:p-4 animate-fadeIn">
      <div 
        className="bg-[#101724] border border-[#22314a] rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl text-white relative max-h-[94vh] overflow-y-auto overscroll-contain scroll-smooth"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#1c273c]">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-2xl flex items-center justify-center shadow-md ${
                activeTab === 'deposit'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}
            >
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-wide">
                {activeTab === 'deposit' ? 'টাকা ডিপোজিট (Manual Deposit)' : 'টাকা উত্তোলন (Withdrawal)'}
              </h2>
              <p className="text-xs text-slate-400">
                {activeTab === 'deposit'
                  ? 'বিকাশ, নগদ ও রকেট দিয়ে একাউন্টে টাকা যোগ করুন'
                  : 'ব্যালেন্স উত্তোলন করুন'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#192437] hover:bg-[#23324c] text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher: [ রিচার্জ (Deposit) ] | [ উত্তোলন (Withdraw) ] */}
        <div className="mt-3.5 bg-[#0a0e16] p-1 rounded-2xl border border-[#1a2335] flex items-center">
          <button
            onClick={() => {
              soundManager.playClick();
              setActiveTab('deposit');
            }}
            className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'deposit'
                ? 'bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>ডিপোজিট (DEPOSIT)</span>
          </button>

          <button
            onClick={() => {
              soundManager.playClick();
              setActiveTab('withdraw');
            }}
            className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'withdraw'
                ? 'bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>উত্তোলন (WITHDRAW)</span>
          </button>
        </div>

        {/* Current Balance Card (Sleek Real-Money Design - No Reset Button) */}
        <div className="mt-3.5 bg-gradient-to-r from-[#0d1422] to-[#0a0f1a] border border-[#1e2c44] rounded-2xl p-3.5 flex items-center justify-between shadow-inner">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center text-[#1a1200] font-black text-base shadow-md">
              ৳
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                বর্তমান ব্যালেন্স (Current Balance)
              </span>
              <div className={`text-xl sm:text-2xl font-black font-mono-numbers tracking-tight ${displayedBalance <= 0 ? 'text-amber-400' : 'text-[#38bdf8]'}`}>
                ৳ {displayedBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              সক্রিয় ওয়ালেট
            </span>
          </div>
        </div>

        {/* If user does not have an account, block deposits & withdrawals completely */}
        {!currentUser ? (
          <div className="mt-5 bg-[#0b111c] border border-amber-500/40 rounded-2xl p-6 text-center space-y-4 shadow-xl">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white mb-1.5">
                একাউন্ট তৈরি করা নেই!
              </h3>
              <p className="text-xs text-slate-300 max-w-sm mx-auto leading-relaxed">
                টাকা জমা (Add Money) বা উইথড্র করার পূর্বে আপনাকে অবশ্যই একাউন্ট তৈরি বা লগইন করতে হবে। একাউন্ট তৈরি ছাড়া কোনো রিচার্জ গ্রহণযোগ্য নয়।
              </p>
            </div>
            <div className="pt-2 flex flex-col sm:flex-row gap-2.5 justify-center">
              <button
                type="button"
                onClick={() => {
                  soundManager.playClick();
                  onClose();
                  onOpenAuth?.('এড মানি করতে হলে প্রথমে একাউন্ট তৈরি বা লগইন করুন!');
                }}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-500 hover:from-emerald-500 hover:to-green-400 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 active:scale-95 transition-all cursor-pointer"
              >
                এখনই একাউন্ট তৈরি করুন (Sign Up)
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-[#1b2333] hover:bg-[#253248] text-slate-300 text-xs font-semibold cursor-pointer"
              >
                বন্ধ করুন
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ===================== TAB 1: DEPOSIT ===================== */}
            {activeTab === 'deposit' && (
              <div className="mt-4 space-y-4 animate-fadeIn">
            {/* View Selector: [ টাকা পাঠান ও সাবমিট করুন ] | [ আমার রিকোয়েস্ট হিস্ট্রি ] */}
            <div className="flex items-center justify-between border-b border-[#1b263b] pb-2">
              <div className="flex gap-2 w-full">
                <button
                  onClick={() => {
                    soundManager.playClick();
                    setDepositView('form');
                  }}
                  className={`flex-1 text-xs font-bold px-3 py-2 rounded-xl transition-all text-center cursor-pointer ${
                    depositView === 'form'
                      ? 'bg-[#1b2538] text-white shadow border border-[#2b3952]'
                      : 'text-slate-400 hover:text-white bg-[#0f1420]'
                  }`}
                >
                  টাকা পাঠান ও সাবমিট করুন
                </button>

                <button
                  onClick={() => {
                    soundManager.playClick();
                    setDepositView('history');
                  }}
                  className={`flex-1 text-xs font-bold px-3 py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 text-center cursor-pointer ${
                    depositView === 'history'
                      ? 'bg-[#1b2538] text-white shadow border border-[#2b3952]'
                      : 'text-slate-400 hover:text-white bg-[#0f1420]'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>রিকোয়েস্ট হিস্ট্রি</span>
                  {userRequests.length > 0 && (
                    <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-[10px] flex items-center justify-center font-bold">
                      {userRequests.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* FORM VIEW */}
            {depositView === 'form' && (
              <div className="space-y-4 animate-fadeIn">
                {/* 0. First Deposit Bonus Promo Banner if eligible */}
                {bonusInfo.isFirstTime && (paymentSettings.firstDepositBonusPercent ?? 50) > 0 && (
                  <div className="bg-gradient-to-r from-amber-500/20 via-yellow-500/15 to-emerald-500/20 border border-amber-500/50 rounded-2xl p-3 flex items-center justify-between gap-2.5 shadow-md">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/25 text-amber-300 flex items-center justify-center shrink-0 border border-amber-500/40">
                        <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-amber-300">
                            প্রথম ডিপোজিটে {paymentSettings.firstDepositBonusPercent ?? 50}% মেগা বোনাস!
                          </span>
                          <span className="text-[9px] bg-red-600 text-white font-bold px-1.5 py-0.2 rounded-full uppercase">
                            স্পেশাল অফার
                          </span>
                        </div>
                        <p className="text-[10.5px] text-slate-300 mt-0.5">
                          প্রথমবার রিচার্জ অনুমোদিত হলে মূল টাকার সাথে অতিরিক্ত <strong className="text-emerald-400">+{paymentSettings.firstDepositBonusPercent ?? 50}%</strong> বোনাস ব্যালেন্সে স্বয়ংক্রিয়ভাবে যোগ হবে!
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 1. Payment Method Selection (bKash, Nagad, Rocket) */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-2">
                    পেমেন্ট মাধ্যম বেছে নিন:
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {/* bKash */}
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playClick();
                        setSelectedMethod('bkash');
                      }}
                      className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center justify-center gap-1.5 cursor-pointer relative ${
                        selectedMethod === 'bkash'
                          ? 'bg-[#e2136e]/20 border-[#e2136e] text-white shadow-lg shadow-[#e2136e]/20 scale-102'
                          : 'bg-[#0d121c] border-[#1d273c] text-slate-400 hover:border-[#334155]'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-[#e2136e] text-white font-black text-xs flex items-center justify-center shadow">
                        bK
                      </div>
                      <span className="text-xs font-black">বিকাশ (bKash)</span>
                      {paymentSettings.bkash?.isActive === false && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40">
                          সাময়িক বন্ধ
                        </span>
                      )}
                    </button>

                    {/* Nagad */}
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playClick();
                        setSelectedMethod('nagad');
                      }}
                      className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center justify-center gap-1.5 cursor-pointer relative ${
                        selectedMethod === 'nagad'
                          ? 'bg-[#f7941d]/20 border-[#f7941d] text-white shadow-lg shadow-[#f7941d]/20 scale-102'
                          : 'bg-[#0d121c] border-[#1d273c] text-slate-400 hover:border-[#334155]'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-[#f7941d] text-white font-black text-xs flex items-center justify-center shadow">
                        ন
                      </div>
                      <span className="text-xs font-black">নগদ (Nagad)</span>
                      {paymentSettings.nagad?.isActive === false && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40">
                          সাময়িক বন্ধ
                        </span>
                      )}
                    </button>

                    {/* Rocket */}
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playClick();
                        setSelectedMethod('rocket');
                      }}
                      className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center justify-center gap-1.5 cursor-pointer relative ${
                        selectedMethod === 'rocket'
                          ? 'bg-[#8c3494]/20 border-[#8c3494] text-white shadow-lg shadow-[#8c3494]/20 scale-102'
                          : 'bg-[#0d121c] border-[#1d273c] text-slate-400 hover:border-[#334155]'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-[#8c3494] text-white font-black text-xs flex items-center justify-center shadow">
                        R
                      </div>
                      <span className="text-xs font-black">রকেট (Rocket)</span>
                      {paymentSettings.rocket?.isActive === false && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40">
                          সাময়িক বন্ধ
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                {/* 2. DYNAMIC ADMIN NUMBER BOX OR DISABLED NOTICE */}
                {!isDepositActive ? (
                  <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-rose-950/40 via-red-950/30 to-[#0e131d] border-2 border-rose-500/60 shadow-xl shadow-rose-950/30 text-center space-y-3 animate-fadeIn">
                    <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center mx-auto shadow-inner">
                      <AlertTriangle className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-rose-300">
                        এই সার্ভিসটি সাময়িক সময়ের জন্য বন্ধ আছে
                      </h3>
                      <p className="text-xs text-slate-300 mt-1.5 max-w-sm mx-auto leading-relaxed">
                        বর্তমানে <strong className="text-white uppercase">{selectedMethod === 'bkash' ? 'বিকাশ (bKash)' : selectedMethod === 'nagad' ? 'নগদ (Nagad)' : 'রকেট (Rocket)'}</strong>-এর মাধ্যমে ডিপোজিট গ্রহণ সাময়িকভাবে বন্ধ রয়েছে।
                      </p>
                      <p className="text-[11px] text-amber-300 font-medium mt-1">
                        অনুগ্রহ করে সচল থাকা অন্য মেথড ব্যবহার করুন।
                      </p>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`p-4 rounded-2xl border transition-all ${
                      selectedMethod === 'bkash'
                        ? 'bg-gradient-to-br from-[#180f19] to-[#120813] border-[#e2136e]/60 shadow-lg shadow-[#e2136e]/10'
                        : selectedMethod === 'nagad'
                        ? 'bg-gradient-to-br from-[#19130d] to-[#130d07] border-[#f7941d]/60 shadow-lg shadow-[#f7941d]/10'
                        : 'bg-gradient-to-br from-[#180f1a] to-[#120914] border-[#8c3494]/60 shadow-lg shadow-[#8c3494]/10'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold mb-2">
                      <span className="text-slate-200">
                        এই নম্বরে টাকা পাঠান ({selectedMethod.toUpperCase()} {currentGateway.accountType}):
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-mono text-emerald-300 border border-white/10">
                        {currentGateway.accountType}
                      </span>
                    </div>

                    {/* Big Single-Line Number Display & Copy Button Below */}
                    <div className="bg-[#090d14]/90 border border-white/15 rounded-xl p-3 sm:p-3.5 flex flex-col items-center justify-center text-center shadow-inner">
                      <span className="text-[10px] text-slate-400 block uppercase font-mono tracking-wider mb-0.5">
                        {selectedMethod} Receiver Number (টাকা পাঠানোর নম্বর)
                      </span>

                      {/* Single-Line Large Number */}
                      <div className="text-2xl sm:text-3xl font-black font-mono tracking-wider text-white select-all py-2 whitespace-nowrap overflow-x-auto max-w-full">
                        {currentGateway.number}
                      </div>

                      {/* Full-Width Copy Button Below */}
                      <button
                        type="button"
                        onClick={handleCopyTargetNumber}
                        className="w-full mt-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold text-xs sm:text-sm shadow-md flex items-center justify-center gap-1.5 active:scale-98 transition-all cursor-pointer"
                      >
                        {copiedNumber ? (
                          <>
                            <Check className="w-4 h-4 stroke-[3] text-white" />
                            <span>নম্বর কপি হয়েছে!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            <span>নম্বর কপি করুন</span>
                          </>
                        )}
                      </button>
                    </div>

                    <p className="mt-2 text-[11px] text-slate-300 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>{currentGateway.instructions || 'টাকা পাঠিয়ে TrxID নিচে সাবমিট করুন।'}</span>
                    </p>
                  </div>
                )}

                {/* 3. Deposit Submission Form */}
                <form onSubmit={handleSubmitDeposit} className="space-y-3.5">
                  {/* Select or Input Amount */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-300">
                        টাকার পরিমাণ (Deposit Amount):
                      </label>
                      <span className="text-[11px] text-emerald-400 font-mono font-bold">
                        ৳ {depositAmount.toLocaleString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mb-2">
                      {depositPresets.map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            soundManager.playClick();
                            setDepositAmount(val);
                          }}
                          className={`py-1.5 px-1 rounded-xl text-xs font-bold font-mono-numbers transition-all ${
                            depositAmount === val
                              ? 'bg-emerald-600 text-white shadow-md'
                              : 'bg-[#0f1522] border border-[#1f2b3e] text-slate-300 hover:bg-[#1a2336]'
                          }`}
                        >
                          +৳{val >= 1000 ? `${val / 1000}k` : val}
                        </button>
                      ))}
                    </div>

                    <div className="bg-[#090d14] border border-[#1e2a3f] rounded-xl px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-slate-400">পরিমাণ লিখুন:</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="50"
                          step="10"
                          value={depositAmount || ''}
                          onChange={(e) => setDepositAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-28 bg-transparent text-right font-mono font-black text-base text-emerald-400 focus:outline-hidden"
                        />
                        <span className="text-xs text-slate-400">৳</span>
                      </div>
                    </div>
                  </div>

                  {/* Sender Phone Number */}
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">
                      যে নম্বর থেকে টাকা পাঠিয়েছেন (Sender Phone):
                    </label>
                    <input
                      type="text"
                      maxLength={14}
                      value={senderPhone}
                      onChange={(e) => setSenderPhone(e.target.value)}
                      placeholder="017xxxxxxxx"
                      className="w-full bg-[#090d14] border border-[#1e2a3f] rounded-xl px-3.5 py-2.5 text-xs font-mono text-white focus:outline-hidden focus:border-emerald-500"
                      required
                    />
                  </div>

                  {/* Transaction ID (TrxID) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-slate-300">
                        ট্রানজেকশন আইডি (TrxID):
                      </label>
                      <span className="text-[10px] text-slate-400">
                        মেসেজ বা অ্যাপ থেকে কপি করুন
                      </span>
                    </div>
                    <input
                      type="text"
                      value={trxId}
                      onChange={(e) => setTrxId(e.target.value.toUpperCase())}
                      placeholder="যেমন: BKI982142 বা 9J8K21"
                      className="w-full bg-[#090d14] border border-[#1e2a3f] rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold uppercase tracking-wider text-amber-300 focus:outline-hidden focus:border-emerald-500"
                      required
                    />
                  </div>

                  {/* Error Message if any */}
                  {submissionError && (
                    <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-medium flex items-center gap-2 animate-fadeIn">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{submissionError}</span>
                    </div>
                  )}

                  {/* Success Message Card if just submitted */}
                  {submissionSuccess && (
                    <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs space-y-1.5 animate-fadeIn">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        <span>ডিপোজিট রিকোয়েস্ট সফলভাবে জমা হয়েছে!</span>
                      </div>
                      <p className="text-slate-300">
                        পরিমাণ: <strong className="text-white">৳ {submissionSuccess.amount.toLocaleString()}</strong> | TrxID:{' '}
                        <strong className="text-amber-300 font-mono">{submissionSuccess.trxId}</strong>
                      </p>
                      <p className="text-[11px] text-slate-400">
                        এডমিন প্যানেলে রিকোয়েস্টটি পাঠানো হয়েছে। নিশ্চিত করে ১-৩ মিনিটের মধ্যে আপনার ব্যালেন্সে টাকা যোগ করে দেওয়া হবে।
                      </p>
                    </div>
                  )}

                  {/* Submit Action Button */}
                  <button
                    type="submit"
                    disabled={isSubmitting || !isDepositActive}
                    className={`w-full py-3 rounded-2xl shadow-xl active:scale-98 transition-all flex flex-col items-center justify-center ${
                      !isDepositActive
                        ? 'bg-rose-950/60 border border-rose-500/40 text-rose-300 cursor-not-allowed opacity-80'
                        : 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white shadow-emerald-700/30 cursor-pointer disabled:opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-sm font-black tracking-wide">
                      {!isDepositActive ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-rose-400" />
                          <span>এই সার্ভিসটি সাময়িক সময়ের জন্য বন্ধ আছে</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 font-bold" />
                          <span>{isSubmitting ? 'রিকোয়েস্ট পাঠানো হচ্ছে...' : 'ডিপোজিট রিকুয়েস্ট সাবমিট'}</span>
                        </>
                      )}
                    </div>
                    {!isSubmitting && isDepositActive && (
                      <span className="text-xs font-mono font-bold text-emerald-100 opacity-95 mt-0.5">
                        (৳ {depositAmount.toLocaleString()})
                      </span>
                    )}
                  </button>
                </form>

                {/* Footer Notice */}
                <div className="bg-[#090d14] p-3 rounded-xl border border-[#182132] text-[11px] text-slate-400 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    {paymentSettings.noticeText ||
                      'টাকা পাঠানোর পর সঠিক ট্রানজেকশন আইডি দিন। অ্যাডমিন নিশ্চিত করে ব্যালেন্স যোগ করে দিবে।'}
                  </span>
                </div>
              </div>
            )}

            {/* HISTORY VIEW */}
            {depositView === 'history' && (
              <div className="space-y-2.5 animate-fadeIn">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-xs font-semibold text-slate-300">
                    আপনার জমা দেওয়া ডিপোজিট রিকোয়েস্টসমূহ:
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    মোট: {userRequests.length} টি
                  </span>
                </div>

                {userRequests.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 bg-[#090d14] rounded-2xl border border-[#1b2538]">
                    <Clock className="w-7 h-7 mx-auto mb-2 text-slate-600" />
                    <p className="text-xs font-medium">এখনও কোনো ডিপোজিট রিকোয়েস্ট জমা দেওয়া হয়নি।</p>
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {userRequests.map((req) => (
                      <div
                        key={req.id}
                        className={`p-3 rounded-xl border transition-all ${
                          req.status === 'pending'
                            ? 'bg-[#121927] border-amber-500/30'
                            : req.status === 'approved'
                            ? 'bg-[#0d1720] border-emerald-500/30'
                            : 'bg-[#150d12] border-rose-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm text-emerald-400 font-mono-numbers">
                              ৳ {req.amount.toLocaleString()}
                            </span>
                            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-white/10 text-slate-300">
                              {req.method}
                            </span>
                          </div>

                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                              req.status === 'pending'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                                : req.status === 'approved'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {req.status === 'pending' && <Clock className="w-3 h-3" />}
                            {req.status === 'approved' && <CheckCircle2 className="w-3 h-3" />}
                            {req.status === 'rejected' && <XCircle className="w-3 h-3" />}
                            <span>
                              {req.status === 'pending'
                                ? 'অপেক্ষমান (Pending)'
                                : req.status === 'approved'
                                ? 'অনুমোদিত (যোগ হয়েছে)'
                                : 'বাতিল'}
                            </span>
                          </span>
                        </div>

                        <div className="mt-2 pt-1.5 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                          <span>TrxID: <strong className="text-amber-300">{req.trxId}</strong></span>
                          <span>{new Date(req.createdAt).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>

                        {req.rejectionReason && (
                          <p className="mt-1.5 text-[10px] text-rose-400 bg-rose-500/10 p-1.5 rounded-md">
                            কারণ: {req.rejectionReason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===================== TAB 2: WITHDRAW ===================== */}
        {activeTab === 'withdraw' && (
          <div className="mt-4 space-y-4 animate-fadeIn">
            {/* View Selector: [ উত্তোলন করুন ] | [ আমার উত্তোলন হিস্ট্রি ] */}
            <div className="flex items-center justify-between border-b border-[#1b263b] pb-2">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    soundManager.playClick();
                    setWithdrawView('form');
                  }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                    withdrawView === 'form'
                      ? 'bg-[#1b2538] text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  টাকা উত্তোলন করুন
                </button>

                <button
                  onClick={() => {
                    soundManager.playClick();
                    setWithdrawView('history');
                  }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                    withdrawView === 'history'
                      ? 'bg-[#1b2538] text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>উত্তোলন হিস্ট্রি</span>
                  {userWithdrawals.length > 0 && (
                    <span className="bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                      {userWithdrawals.length}
                    </span>
                  )}
                </button>
              </div>

              <span className="text-[11px] text-slate-400">
                ব্যালেন্স: <strong className="text-white font-mono">৳{displayedBalance.toLocaleString()}</strong>
              </span>
            </div>

            {/* WITHDRAW FORM */}
            {withdrawView === 'form' && (
              !bonusInfo.hasDeposited ? (
                <div className="bg-gradient-to-b from-rose-950/70 via-[#16101c] to-[#0d121c] border-2 border-rose-500/50 rounded-2xl p-5 sm:p-6 text-center space-y-4 shadow-2xl animate-fadeIn">
                  <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-400 mx-auto flex items-center justify-center shadow-lg">
                    <AlertCircle className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="text-base sm:text-lg font-black text-white">
                      🚫 ডিপোজিট ছাড়া উইথড্র সম্পূর্ণ বন্ধ!
                    </h4>
                    <p className="text-xs text-rose-200/90 leading-relaxed max-w-sm mx-auto mt-2">
                      ভবিষ্যতে ফ্রড ও বোনাস অপব্যবহার রোধে <strong>নূন্যতম ১ বার সফল ডিপোজিট</strong> করা বাধ্যতামূলক। ডিপোজিট করার সাথে সাথেই আপনার অ্যাকাউন্ট ভেরিফাইড হবে ও উত্তোলনের সুযোগ চালু হবে।
                    </p>
                  </div>
                  <div className="bg-[#0b0f17] border border-white/10 rounded-xl p-3 text-xs text-slate-300 flex items-center justify-between">
                    <span className="text-slate-400">আপনার ডিপোজিট স্ট্যাটাস:</span>
                    <span className="font-bold text-rose-400 bg-rose-500/20 px-2 py-0.5 rounded-md">০ ডিপোজিট (অসম্পূর্ণ)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playClick();
                      setActiveTab('deposit');
                    }}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-black text-sm uppercase tracking-wide shadow-xl shadow-emerald-900/40 transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-98"
                  >
                    <PlusCircle className="w-4 h-4 font-bold" />
                    <span>এখনই ডিপোজিট করুন (এড মানি)</span>
                  </button>
                </div>
              ) : (
              <form onSubmit={handleSubmitWithdrawal} className="space-y-4">
                {/* 1. Payment Method Selector: bKash / Nagad / Rocket */}
                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-2">
                    ১. উত্তোলন মাধ্যম সিলেক্ট করুন (Select Method):
                  </label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {/* bKash */}
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playClick();
                        setSelectedWithdrawMethod('bkash');
                      }}
                      className={`p-2.5 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative ${
                        selectedWithdrawMethod === 'bkash'
                          ? 'bg-[#e2136e]/20 border-[#e2136e] shadow-lg shadow-[#e2136e]/20 ring-1 ring-[#e2136e]'
                          : 'bg-[#0a0e16] border-[#1e2a3f] hover:border-slate-500 text-slate-400'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-[#e2136e] text-white flex items-center justify-center font-black text-sm shadow">
                        ব
                      </div>
                      <span className="text-xs font-black text-white">বিকাশ (bKash)</span>
                      <span className="text-[10px] text-[#e2136e] font-bold">Personal</span>
                      {paymentSettings.bkash?.isActive === false && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40">
                          সাময়িক বন্ধ
                        </span>
                      )}
                      {selectedWithdrawMethod === 'bkash' && (
                        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#e2136e] text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </div>
                      )}
                    </button>

                    {/* Nagad */}
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playClick();
                        setSelectedWithdrawMethod('nagad');
                      }}
                      className={`p-2.5 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative ${
                        selectedWithdrawMethod === 'nagad'
                          ? 'bg-[#f7941d]/20 border-[#f7941d] shadow-lg shadow-[#f7941d]/20 ring-1 ring-[#f7941d]'
                          : 'bg-[#0a0e16] border-[#1e2a3f] hover:border-slate-500 text-slate-400'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-[#f7941d] text-white flex items-center justify-center font-black text-sm shadow">
                        ন
                      </div>
                      <span className="text-xs font-black text-white">নগদ (Nagad)</span>
                      <span className="text-[10px] text-[#f7941d] font-bold">Personal</span>
                      {paymentSettings.nagad?.isActive === false && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40">
                          সাময়িক বন্ধ
                        </span>
                      )}
                      {selectedWithdrawMethod === 'nagad' && (
                        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#f7941d] text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </div>
                      )}
                    </button>

                    {/* Rocket */}
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playClick();
                        setSelectedWithdrawMethod('rocket');
                      }}
                      className={`p-2.5 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative ${
                        selectedWithdrawMethod === 'rocket'
                          ? 'bg-[#8c3494]/20 border-[#8c3494] shadow-lg shadow-[#8c3494]/20 ring-1 ring-[#8c3494]'
                          : 'bg-[#0a0e16] border-[#1e2a3f] hover:border-slate-500 text-slate-400'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-[#8c3494] text-white flex items-center justify-center font-black text-sm shadow">
                        র
                      </div>
                      <span className="text-xs font-black text-white">রকেট (Rocket)</span>
                      <span className="text-[10px] text-[#a855f7] font-bold">Personal</span>
                      {paymentSettings.rocket?.isActive === false && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40">
                          সাময়িক বন্ধ
                        </span>
                      )}
                      {selectedWithdrawMethod === 'rocket' && (
                        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#8c3494] text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </div>
                      )}
                    </button>
                  </div>
                </div>

                {/* Notice if selected withdrawal method is inactive */}
                {!isWithdrawActive && (
                  <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-rose-950/40 via-red-950/30 to-[#0e131d] border-2 border-rose-500/60 shadow-xl shadow-rose-950/30 text-center space-y-2.5 animate-fadeIn">
                    <div className="w-11 h-11 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center mx-auto shadow-inner">
                      <AlertTriangle className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-black text-rose-300">
                        এই সার্ভিসটি সাময়িক সময়ের জন্য বন্ধ আছে
                      </h3>
                      <p className="text-xs text-slate-300 mt-1 max-w-sm mx-auto leading-relaxed">
                        বর্তমানে <strong className="text-white uppercase">{selectedWithdrawMethod === 'bkash' ? 'বিকাশ (bKash)' : selectedWithdrawMethod === 'nagad' ? 'নগদ (Nagad)' : 'রকেট (Rocket)'}</strong>-এর মাধ্যমে ক্যাশ আউট / উত্তোলন সাময়িকভাবে বন্ধ রয়েছে।
                      </p>
                      <p className="text-[11px] text-amber-300 font-medium mt-1">
                        অনুগ্রহ করে সচল থাকা অন্য মেথড নির্বাচন করুন।
                      </p>
                    </div>
                  </div>
                )}

                {/* 2. Personal Number Input (strictly personal - no agent!) */}
                <div className="bg-[#090d15] border border-[#1b2538] rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-400 inline-block"></span>
                      <span>আপনার পার্সোনাল {selectedWithdrawMethod === 'bkash' ? 'বিকাশ' : selectedWithdrawMethod === 'nagad' ? 'নগদ' : 'রকেট'} নম্বর:</span>
                    </label>
                    <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      Personal Only
                    </span>
                  </div>

                  <input
                    type="tel"
                    value={withdrawPhone}
                    onChange={(e) => setWithdrawPhone(e.target.value)}
                    placeholder="যেমন: 017xxxxxxxx"
                    maxLength={14}
                    className="w-full bg-[#0d131f] border border-[#233149] focus:border-rose-500 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white placeholder-slate-500 focus:outline-hidden transition-colors"
                  />

                  <p className="text-[11px] text-amber-300/90 flex items-center gap-1.5 font-medium">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                    <span>শুধুমাত্র আপনার পার্সোনাল নম্বর দিন। কোনো এজেন্ট নম্বর গ্রহণযোগ্য নয়।</span>
                  </p>
                </div>

                {/* Balance & Rules Breakdown */}
                <div className="bg-[#0b101a] border border-[#1e2a3f] rounded-2xl p-3.5 space-y-2.5">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-[#080d16] p-2.5 rounded-xl border border-amber-500/30">
                      <span className="text-[10px] text-slate-400 block font-medium">অ-উত্তোলনযোগ্য বোনাস/কমিশন:</span>
                      <span className="font-bold text-amber-300 font-mono text-sm">৳ {bonusInfo.totalLockedBonuses.toLocaleString()}</span>
                      <span className="text-[9.5px] text-slate-500 block mt-0.5">(খেলার জন্য সংরক্ষিত)</span>
                    </div>
                    <div className="bg-[#080d16] p-2.5 rounded-xl border border-emerald-500/30">
                      <span className="text-[10px] text-slate-400 block font-medium">উইন হওয়া উত্তোলনযোগ্য লাভ:</span>
                      <span className="font-bold text-emerald-400 font-mono text-sm">৳ {bonusInfo.withdrawableAmount.toLocaleString()}</span>
                      <span className="text-[9.5px] text-emerald-400/80 block mt-0.5">(ক্যাশআউট যোগ্য)</span>
                    </div>
                  </div>

                  {/* Bonus breakdown details badge */}
                  {bonusInfo.totalLockedBonuses > 0 && (
                    <div className="p-2 rounded-lg bg-[#0e1522] border border-[#1d293d] text-[10px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                      <span>• ওয়েলকাম বোনাস: <strong className="text-slate-300">৳{bonusInfo.initialBonus}</strong></span>
                      {bonusInfo.firstDepBonus > 0 && (
                        <span>• ১ম ডিপোজিট বোনাস: <strong className="text-amber-300">৳{bonusInfo.firstDepBonus.toLocaleString()}</strong></span>
                      )}
                      {bonusInfo.refBonus > 0 && (
                        <span>• ইনভাইট বোনাস ১০০% (লকড): <strong className="text-cyan-300">৳{bonusInfo.refBonus.toLocaleString()}</strong></span>
                      )}
                      {bonusInfo.rewardBonus > 0 && (
                        <span>• রিওয়ার্ড বোনাস: <strong className="text-amber-300">৳{bonusInfo.rewardBonus.toLocaleString()}</strong></span>
                      )}
                    </div>
                  )}

                  <div className="bg-amber-950/25 border border-amber-800/30 rounded-xl p-2.5 text-[10.5px] text-slate-300 leading-snug space-y-1">
                    <p className="font-bold text-amber-300 flex items-center gap-1">
                      <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>ক্যাশআউট ও বোনাস নীতিমালা:</span>
                    </p>
                    <ul className="space-y-0.5 list-disc pl-3.5 text-slate-300 text-[10px]">
                      <li><strong>বোনাস ও ইনভাইট বোনাস ১০০%:</strong> সকল বোনাস টাকা (ওয়েলকাম, ১ম ডিপোজিট, ইনভাইট বোনাস ১০০%) কখনই উত্তোলন করা যাবে না এবং ইনভাইট বোনাস দিয়ে লাভবান হওয়া যাবে না।</li>
                      <li><strong>উত্তোলনযোগ্য অর্থ:</strong> শুধুমাত্র নিজস্ব ডিপোজিট থেকে গেম খেলে উইন হওয়া টাকা উইথড্র দিতে পারবেন।</li>
                      <li><strong>সীমা:</strong> মিনিমাম ক্যাশআউট <strong>৳ ৫০০</strong> এবং একাউন্টে সর্বনিম্ন <strong>৳ ১০০</strong> ব্যালেন্স সংরক্ষিত থাকতে হবে।</li>
                    </ul>
                  </div>
                </div>

                {/* 3. Withdrawal Amount Selection */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200">
                      ৩. উত্তোলনের পরিমাণ (মিনিমাম ৫০০ ৳):
                    </label>
                    <span className="text-[11px] text-emerald-400 font-mono font-bold">
                      উত্তোলনযোগ্য ব্যালেন্স: ৳{bonusInfo.withdrawableAmount.toLocaleString()}
                    </span>
                  </div>

                  {/* Preset Chips (Starting from 500) */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {[500, 630, 1000, 2000, 5000].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          soundManager.playClick();
                          setWithdrawAmount(val);
                        }}
                        disabled={bonusInfo.withdrawableAmount < val}
                        className={`py-2 rounded-xl text-xs font-bold font-mono-numbers transition-all cursor-pointer ${
                          withdrawAmount === val
                            ? 'bg-rose-600 text-white shadow-md shadow-rose-900/40 ring-1 ring-rose-400'
                            : 'bg-[#0a0e16] border border-[#1b2538] text-slate-300 hover:border-slate-500 hover:text-white'
                        } disabled:opacity-25 disabled:cursor-not-allowed`}
                      >
                        ৳{val.toLocaleString()}
                      </button>
                    ))}
                  </div>

                  {/* Custom Amount Input Field */}
                  <div className="bg-[#090d15] border border-[#1e2a3f] rounded-xl px-3.5 py-2 flex items-center justify-between focus-within:border-rose-500 transition-colors">
                    <span className="text-xs text-slate-400 font-medium">পরিমাণ (মিনিমাম ৫০০ ৳):</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="500"
                        max={bonusInfo.withdrawableAmount}
                        value={withdrawAmount || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setWithdrawAmount(val);
                        }}
                        placeholder="যেমন: 630"
                        className="w-32 bg-transparent text-right font-mono font-bold text-base text-rose-400 focus:outline-hidden"
                      />
                      <span className="text-xs text-slate-400 font-bold">৳</span>
                    </div>
                  </div>
                </div>

                {/* Error Banner */}
                {withdrawError && (
                  <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2 animate-fadeIn">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{withdrawError}</span>
                  </div>
                )}

                {/* Success Card */}
                {withdrawSuccess && (
                  <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs space-y-1.5 animate-fadeIn">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      <span>উত্তোলন রিকোয়েস্ট সফলভাবে জমা হয়েছে!</span>
                    </div>
                    <p className="text-slate-300">
                      পরিমাণ: <strong className="text-white">৳ {withdrawSuccess.amount.toLocaleString()}</strong> | মাধ্যম:{' '}
                      <strong className="text-amber-300 uppercase">{withdrawSuccess.method}</strong> (পার্সোনাল:{' '}
                      <strong className="text-white font-mono">{withdrawSuccess.personalNumber}</strong>)
                    </p>
                    <p className="text-[11px] text-slate-400">
                      এডমিন যাচাই বাচাই করে আপনার নম্বরে টাকা সেন্ড করে স্ট্যাটাস আপডেট করে দিবেন।
                    </p>
                  </div>
                )}

                {/* Primary Submit Button */}
                {(() => {
                  const isEligible = bonusInfo.withdrawableAmount >= 500 && withdrawAmount >= 500 && withdrawAmount <= bonusInfo.withdrawableAmount;

                  return (
                    <button
                      type="submit"
                      disabled={isWithdrawSubmitting || !isEligible || !isWithdrawActive}
                      className={`w-full py-3 rounded-2xl shadow-xl active:scale-98 transition-all flex flex-col items-center justify-center ${
                        !isWithdrawActive
                          ? 'bg-rose-950/60 border border-rose-500/40 text-rose-300 cursor-not-allowed opacity-80'
                          : 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-rose-900/40 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-sm font-black tracking-wide">
                        {!isWithdrawActive ? (
                          <>
                            <AlertTriangle className="w-4 h-4 text-rose-400" />
                            <span>এই সার্ভিসটি সাময়িক সময়ের জন্য বন্ধ আছে</span>
                          </>
                        ) : (
                          <>
                            <ArrowDownLeft className="w-4 h-4 font-bold" />
                            <span>
                              {isWithdrawSubmitting
                                ? 'রিকোয়েস্ট পাঠানো হচ্ছে...'
                                : bonusInfo.withdrawableAmount < 500
                                ? 'উত্তোলনযোগ্য লাভ ৫০০ ৳ এর কম'
                                : 'উত্তোলন রিকুয়েস্ট সাবমিট'}
                            </span>
                          </>
                        )}
                      </div>
                      {!isWithdrawSubmitting && isEligible && isWithdrawActive && (
                        <span className="text-xs font-mono font-bold text-rose-100 opacity-95 mt-0.5">
                          (৳ {withdrawAmount.toLocaleString()})
                        </span>
                      )}
                    </button>
                  );
                })()}

                {/* Notice text */}
                <div className="bg-[#090d14] p-3 rounded-xl border border-[#182132] text-[11px] text-slate-400 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    এডমিন যাচাই বাচাই করে আপনার প্রদানকৃত বিকাশ/নগদ/রকেট পার্সোনাল নম্বরে টাকা পাঠিয়ে দিবেন এবং স্ট্যাটাস আপডেট করবেন।
                  </span>
                </div>
              </form>
            ))}

            {/* WITHDRAW HISTORY VIEW */}
            {withdrawView === 'history' && (
              <div className="space-y-2.5 animate-fadeIn">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-xs font-semibold text-slate-300">
                    আপনার জমা দেওয়া উত্তোলন রিকোয়েস্টসমূহ:
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    মোট: {userWithdrawals.length} টি
                  </span>
                </div>

                {userWithdrawals.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 bg-[#090d14] rounded-2xl border border-[#1b2538]">
                    <Clock className="w-7 h-7 mx-auto mb-2 text-slate-600" />
                    <p className="text-xs font-medium">এখনও কোনো উত্তোলন রিকোয়েস্ট জমা দেওয়া হয়নি।</p>
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {userWithdrawals.map((req) => (
                      <div
                        key={req.id}
                        className={`p-3 rounded-xl border transition-all ${
                          req.status === 'pending'
                            ? 'bg-[#121927] border-amber-500/30'
                            : req.status === 'completed'
                            ? 'bg-[#0d1720] border-emerald-500/30'
                            : 'bg-[#150d12] border-rose-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm text-rose-400 font-mono-numbers">
                              ৳ {req.amount.toLocaleString()}
                            </span>
                            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-white/10 text-slate-300">
                              {req.method} (Personal)
                            </span>
                          </div>

                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                              req.status === 'pending'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                                : req.status === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {req.status === 'pending' && <Clock className="w-3 h-3" />}
                            {req.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                            {req.status === 'rejected' && <XCircle className="w-3 h-3" />}
                            <span>
                              {req.status === 'pending'
                                ? 'অপেক্ষমান (এডমিন যাচাই করছেন)'
                                : req.status === 'completed'
                                ? 'টাকা সেন্ড করা হয়েছে'
                                : 'বাতিল ও রিফান্ড'}
                            </span>
                          </span>
                        </div>

                        <div className="mt-2 pt-1.5 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                          <span>পার্সোনাল নম্বর: <strong className="text-white">{req.personalNumber}</strong></span>
                          <span>{new Date(req.createdAt).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>

                        {req.adminNote && (
                          <p className="mt-1.5 text-[10px] text-emerald-400 bg-emerald-500/10 p-1.5 rounded-md">
                            নোট: {req.adminNote}
                          </p>
                        )}

                        {req.rejectionReason && (
                          <p className="mt-1.5 text-[10px] text-rose-400 bg-rose-500/10 p-1.5 rounded-md">
                            বাতিলের কারণ: {req.rejectionReason} (ব্যালেন্সে রিফান্ড করা হয়েছে)
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
          </>
        )}

        {/* Toast confirmation */}
        {showSuccessToast && (
          <div className="absolute inset-0 bg-[#101724]/95 backdrop-blur-md rounded-3xl flex flex-col items-center justify-center gap-2 z-50 animate-fadeIn p-4 text-center">
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center border ${
                showSuccessToast.type === 'deposit'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-400 border-rose-500/40'
              }`}
            >
              <Check className="w-6 h-6 stroke-[3]" />
            </div>
            <p className={`font-bold text-base ${showSuccessToast.type === 'deposit' ? 'text-emerald-300' : 'text-rose-300'}`}>
              {showSuccessToast.type === 'deposit'
                ? 'ব্যালেন্স সফলভাবে যোগ হয়েছে!'
                : 'উত্তোলন সফলভাবে সম্পন্ন হয়েছে!'}
            </p>
            <p className="text-xs text-slate-300 font-mono">
              ৳ {showSuccessToast.amount.toLocaleString()} {selectedMethod.toUpperCase()} নম্বরে পাঠানো হয়েছে
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              বর্তমান অবশিষ্ট ব্যালেন্স:{' '}
              <span className="font-bold text-cyan-300">
                ৳ {(currentBalance - showSuccessToast.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
