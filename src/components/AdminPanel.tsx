import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  RefreshCw,
  Phone,
  Save,
  AlertTriangle,
  Lock,
  Unlock,
  Coins,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  Search,
  Filter,
  DollarSign,
  Smartphone,
  Eye,
  EyeOff,
  UserCheck,
  Send,
  MessageCircle,
  User as UserIcon,
  Edit3,
  History,
  KeyRound,
  Globe,
  ExternalLink,
  Download,
  Megaphone,
  Bell,
  Volume2,
  Users,
  Radio as RadioIcon,
  Trash2,
  Sparkles,
  Calendar,
} from 'lucide-react';
import {
  getActivePlayersSettings,
  saveActivePlayersSettings,
  ActivePlayersSettings,
} from '../services/activePlayersService';
import {
  SystemPaymentSettings,
  ManualDepositRequest,
  ManualWithdrawalRequest,
  getStoredPaymentSettings,
  savePaymentSettings,
  getStoredDepositRequests,
  approveManualDepositRequest,
  rejectManualDepositRequest,
  syncDepositRequestsFromFirestore,
  syncPaymentSettingsFromFirestore,
  getStoredWithdrawalRequests,
  completeManualWithdrawalRequest,
  rejectManualWithdrawalRequest,
  syncWithdrawalRequestsFromFirestore,
  listenToDepositRequests,
  listenToWithdrawalRequests,
} from '../services/manualPayment';
import { soundManager } from '../services/audio';
import {
  BroadcastNotification,
  getStoredBroadcastNotifications,
  sendBroadcastNotification,
  deleteBroadcastNotification,
  listenToBroadcastNotifications,
  getDailyReminderStatus,
} from '../services/notificationService';
import { UserFullHistoryModal } from './UserFullHistoryModal';
import { AdminUserEditModal } from './AdminUserEditModal';
import { AdminStealthGuideModal } from './AdminStealthGuideModal';
import { getAllAccountsWithStats, calculateWithdrawableBalance, syncUsersFromFirestore } from '../services/userManagement';
import { StoredPhoneAccount, getStoredPhoneAccounts } from '../services/phoneAuth';
import { setAdminVisible, getRegisteredAdminPhone, saveRegisteredAdminPhone, isUserAdminAccount } from '../services/adminAuth';
import { db } from '../services/firebase';
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserPhone?: string | null;
  onBalanceAdjusted?: () => void;
  initialTab?: 'requests' | 'withdrawals' | 'settings' | 'users' | 'marquee' | 'notifications';
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  isOpen,
  onClose,
  currentUserPhone,
  onBalanceAdjusted,
  initialTab,
}) => {
  const isAuthorized = isUserAdminAccount(currentUserPhone);

  useEffect(() => {
    if (isOpen && !isAuthorized) {
      onClose();
    }
  }, [isOpen, isAuthorized, onClose]);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [showPin, setShowPin] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<'requests' | 'withdrawals' | 'users' | 'marquee' | 'settings' | 'notifications'>(initialTab || 'requests');

  useEffect(() => {
    if (initialTab && isOpen && isAuthorized) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen, isAuthorized]);

  // Broadcast Notification Tab State
  const [broadcastList, setBroadcastList] = useState<BroadcastNotification[]>(getStoredBroadcastNotifications);
  const [notifTitle, setNotifTitle] = useState<string>('');
  const [notifMessage, setNotifMessage] = useState<string>('');
  const [notifType, setNotifType] = useState<BroadcastNotification['type']>('info');
  const [isSendingNotif, setIsSendingNotif] = useState<boolean>(false);
  const [isPinnedNotif, setIsPinnedNotif] = useState<boolean>(false);

  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // User History & Edit Modal states
  const [selectedHistoryUserId, setSelectedHistoryUserId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<StoredPhoneAccount | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');
  const [accountsWithStats, setAccountsWithStats] = useState<ReturnType<typeof getAllAccountsWithStats>>([]);
  const [copiedCredentialId, setCopiedCredentialId] = useState<string | null>(null);

  // Withdrawal tab state
  const [withdrawals, setWithdrawals] = useState<ManualWithdrawalRequest[]>(getStoredWithdrawalRequests);
  const [withdrawFilterStatus, setWithdrawFilterStatus] = useState<'all' | 'pending' | 'completed' | 'rejected'>('pending');
  const [withdrawSearchQuery, setWithdrawSearchQuery] = useState<string>('');
  const [copiedPersonalNumber, setCopiedPersonalNumber] = useState<string | null>(null);

  // Reject withdrawal modal state
  const [rejectingWithdrawalId, setRejectingWithdrawalId] = useState<string | null>(null);
  const [rejectWithdrawalReason, setRejectWithdrawalReason] = useState<string>('ভুল বা অসত্য পার্সোনাল নম্বর');

  // Complete withdrawal confirmation state
  const [completingWithdrawal, setCompletingWithdrawal] = useState<ManualWithdrawalRequest | null>(null);
  const [completeAdminNote, setCompleteAdminNote] = useState<string>('টাকা সেন্ড করা হয়েছে');

  const [settings, setSettings] = useState<SystemPaymentSettings>(getStoredPaymentSettings);
  const [activePlayersSettings, setActivePlayersSettings] = useState<ActivePlayersSettings>(getActivePlayersSettings);
  const [requests, setRequests] = useState<ManualDepositRequest[]>(getStoredDepositRequests);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string>('');
  const [copiedTgDesc, setCopiedTgDesc] = useState<boolean>(false);

  // Prominent Floating Action Notification Toast
  interface AdminActionToast {
    id: string;
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
  }
  const [actionToast, setActionToast] = useState<AdminActionToast | null>(null);
  const toastTimeoutRef = React.useRef<any>(null);

  const showAdminToast = (title: string, message: string, type: 'success' | 'error' | 'info' = 'success') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setActionToast({
      id: Date.now().toString(),
      type,
      title,
      message,
    });
    if (type === 'success') {
      soundManager.playWin();
    } else {
      soundManager.playClick();
    }
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: message,
          icon: '/pwa-192x192.png',
        });
      } catch {}
    }
    toastTimeoutRef.current = setTimeout(() => {
      setActionToast(null);
    }, 4500);
  };

  const [copiedTrxId, setCopiedTrxId] = useState<string | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Reject deposit modal state
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('ভুল বা অসত্য ট্রানজেকশন আইডি');

  // Stealth Admin Mode & Admin Phone state
  const [adminPhone, setAdminPhone] = useState<string>(() => getRegisteredAdminPhone());
  const [adminPhoneSavedMsg, setAdminPhoneSavedMsg] = useState<string>('');
  const [showStealthGuideModal, setShowStealthGuideModal] = useState<boolean>(false);

  // Admin PIN Change States (Step 1: Old PIN confirm -> Step 2: New PIN with * masking)
  const [showPinChange, setShowPinChange] = useState<boolean>(false);
  const [oldPinInput, setOldPinInput] = useState<string>('');
  const [isOldPinConfirmed, setIsOldPinConfirmed] = useState<boolean>(false);
  const [newPin, setNewPin] = useState<string>('');
  const [pinChangeError, setPinChangeError] = useState<string>('');
  const [pinChangeMsg, setPinChangeMsg] = useState<string>('');
  const [showOldPinToggle, setShowOldPinToggle] = useState<boolean>(false);
  const [showNewPinToggle, setShowNewPinToggle] = useState<boolean>(false);
  const [revealStoredPin, setRevealStoredPin] = useState<boolean>(false); // default false: masked with '*'

  // Local phone accounts list for Tab 3
  const [localAccounts, setLocalAccounts] = useState<Array<{ uid: string; phone: string; name: string; balance: number }>>([]);
  const [manualAddAmount, setManualAddAmount] = useState<number>(500);

  // Marquee announcement text state
  const [marqueeNotice, setMarqueeNotice] = useState<string>(
    () => localStorage.getItem('aviator_marquee_text') || '🎉 স্বাগতম অ্যাভিয়েটর অফিসিয়াল মোবাইল গেমে! ৳ ৫০০ ডিপোজিট করলেই পাচ্ছেন আকর্ষণীয় বোনাস! বিকাশ, নগদ ও রকেটে ১-৩ মিনিটে দ্রুত পেমেন্ট সম্পন্ন হয়। উপভোগ করুন সেরা ক্র্যাশ গেম ও সেরা জয়! 🚀'
  );

  // Load and subscribe to requests & settings
  const reloadData = () => {
    setRequests(getStoredDepositRequests());
    setWithdrawals(getStoredWithdrawalRequests());
    setSettings(getStoredPaymentSettings());
    setAccountsWithStats(getAllAccountsWithStats());
    setBroadcastList(getStoredBroadcastNotifications());

    // Load local phone accounts
    try {
      const raw = localStorage.getItem('aviator_phone_accounts_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        const list = Object.keys(parsed).map((k) => ({
          uid: parsed[k].uid,
          phone: parsed[k].phoneNumber,
          name: parsed[k].displayName,
          balance: parsed[k].balance || 0,
        }));
        setLocalAccounts(list);
      }
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      reloadData();
      // Attempt background sync
      syncPaymentSettingsFromFirestore().then((s) => {
        setSettings(s);
        if (s.marqueeNotice) setMarqueeNotice(s.marqueeNotice);
      });
      syncDepositRequestsFromFirestore().then((r) => setRequests(r));
      syncWithdrawalRequestsFromFirestore().then((w) => setWithdrawals(w));
      syncUsersFromFirestore().then((u) => setAccountsWithStats(u));

      // Realtime listener for broadcast notifications
      const unsubBroadcast = listenToBroadcastNotifications((list) => {
        setBroadcastList(list);
      });

      // Realtime listener for incoming deposit requests from other devices
      const unsubDeposits = listenToDepositRequests((remoteRequests) => {
        setRequests(remoteRequests);
      });

      // Realtime listener for incoming withdrawal requests from other devices
      const unsubWithdrawals = listenToWithdrawalRequests((remoteWithdrawals) => {
        setWithdrawals(remoteWithdrawals);
      });

      let unsubUsers: (() => void) | null = null;
      try {
        unsubUsers = onSnapshot(collection(db, 'users'), () => {
          syncUsersFromFirestore().then((u) => setAccountsWithStats(u));
        });
      } catch (err) {
        console.warn('AdminPanel users onSnapshot error:', err);
      }

      return () => {
        if (unsubUsers) unsubUsers();
        unsubBroadcast();
        unsubDeposits();
        unsubWithdrawals();
      };
    }
  }, [isOpen]);

  useEffect(() => {
    const handleRequestsUpdated = () => setRequests(getStoredDepositRequests());
    const handleWithdrawalsUpdated = () => setWithdrawals(getStoredWithdrawalRequests());
    const handleSettingsUpdated = () => {
      const s = getStoredPaymentSettings();
      setSettings(s);
      if (s.marqueeNotice) setMarqueeNotice(s.marqueeNotice);
    };
    const handleAccountsUpdated = () => setAccountsWithStats(getAllAccountsWithStats());
    const handleBalanceCredited = () => {
      reloadData();
      if (onBalanceAdjusted) onBalanceAdjusted();
    };

    window.addEventListener('deposit_requests_updated', handleRequestsUpdated);
    window.addEventListener('withdrawal_requests_updated', handleWithdrawalsUpdated);
    window.addEventListener('payment_settings_updated', handleSettingsUpdated);
    window.addEventListener('accounts_updated', handleAccountsUpdated);
    window.addEventListener('balance_credited', handleBalanceCredited);

    return () => {
      window.removeEventListener('deposit_requests_updated', handleRequestsUpdated);
      window.removeEventListener('withdrawal_requests_updated', handleWithdrawalsUpdated);
      window.removeEventListener('payment_settings_updated', handleSettingsUpdated);
      window.removeEventListener('accounts_updated', handleAccountsUpdated);
      window.removeEventListener('balance_credited', handleBalanceCredited);
    };
  }, [onBalanceAdjusted]);

  if (!isOpen || !isAuthorized) return null;

  // Handle PIN verification (Strict check against currently saved admin PIN)
  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Always fetch fresh settings from storage to ensure latest active PIN
    const latestSettings = getStoredPaymentSettings();
    const activeAdminPin = (latestSettings.adminPin || settings.adminPin || '1234').trim();
    if (pinInput.trim() === activeAdminPin) {
      setIsAuthenticated(true);
      setPinError('');
      soundManager.playClick();
    } else {
      setPinError('ভুল এডমিন পিন! অনুগ্রহ করে আপনার সঠিক সিক্রেট পিন দিন।');
      soundManager.playCrash();
    }
  };

  // Handle Save Admin Phone Number
  const handleSaveAdminPhone = () => {
    saveRegisteredAdminPhone(adminPhone);
    setAdminPhoneSavedMsg('এডমিন ফোন নম্বর সংরক্ষিত হয়েছে! এই নম্বর দিয়ে লগইন করলে এডমিন মোড স্বয়ংক্রিয়ভাবে সক্রিয় হবে।');
    soundManager.playWin();
    showAdminToast(
      'এডমিন ফোন নম্বর সংরক্ষিত হয়েছে!',
      `+88 ${adminPhone} নম্বর দিয়ে লগইন করলে এডমিন সুবিধা স্বয়ংক্রিয়ভাবে সক্রিয় থাকবে।`,
      'success'
    );
    setTimeout(() => setAdminPhoneSavedMsg(''), 4500);
  };

  // Mask helper:
  // শুরুতে ****** এমন থাকবে (সবগুলো '*')
  // ভিও এ ক্লিক করলে শুধু প্রথম ও শেষ অক্ষর দেখাবে বাকিগুলো '*' থাকবে (যেমন: 2****0)
  // পুরো পিন (যেমন: 224700) কোনো অবস্থাতেই সম্পূর্ণ দৃশ্যমান হবে না।
  const getMaskedPin = (pin: string, isViewClicked: boolean = false) => {
    const target = (pin || '1234').trim();
    if (!isViewClicked) {
      // শুরুতে ****** এমন থাকবে
      return '*'.repeat(target.length);
    }
    // ভিও এ ক্লিক করলে শুধু প্রথম ও শেষ অক্ষর দেখাবে বাকিগুলো * থাকবে
    if (target.length <= 2) {
      return target;
    }
    const firstChar = target[0];
    const lastChar = target[target.length - 1];
    const middleStars = '*'.repeat(target.length - 2);
    return `${firstChar}${middleStars}${lastChar}`;
  };

  // Step 1: Verify Current PIN (শুধুমাত্র বর্তমান সক্রিয় পিন গ্রহণ করবে)
  const handleVerifyOldPin = () => {
    setPinChangeError('');
    setPinChangeMsg('');
    const latestSettings = getStoredPaymentSettings();
    const activeAdminPin = (latestSettings.adminPin || settings.adminPin || '1234').trim();
    if (oldPinInput.trim() === activeAdminPin) {
      setIsOldPinConfirmed(true);
      setPinChangeError('');
      soundManager.playWin();
    } else {
      setPinChangeError('ভুল বর্তমান পিন! সঠিক বর্তমান পিন দিয়ে কনফার্ম করুন।');
      soundManager.playCrash();
    }
  };

  // Step 2: Save New PIN after verification ("নতুন পিন দিয়ে আপডেট হবে")
  const handleSaveNewPin = async () => {
    setPinChangeError('');
    if (!isOldPinConfirmed) {
      setPinChangeError('প্রথমে বর্তমান পিন দিয়ে কনফার্ম করুন');
      return;
    }
    const cleanNewPin = newPin.trim();
    if (cleanNewPin.length < 4) {
      setPinChangeError('নতুন পিন ন্যূনতম ৪ সংখ্যার হতে হবে');
      soundManager.playCrash();
      return;
    }
    try {
      const updated = { ...settings, adminPin: cleanNewPin };
      setSettings(updated);
      await savePaymentSettings(updated);
      // পিন আপডেট বার্তা: শুধু প্রথম ও শেষ অক্ষর দেখাবে, বাকিগুলো *
      const maskedPreview = getMaskedPin(cleanNewPin, true);
      const msg = `নতুন পিন সফলভাবে আপডেট হয়েছে! বর্তমান পিন: ${maskedPreview}`;
      setPinChangeMsg(msg);
      showAdminToast('এডমিন পিন পরিবর্তন সফল!', msg, 'success');
      setNewPin('');
      setOldPinInput('');
      setIsOldPinConfirmed(false);
      setTimeout(() => {
        setPinChangeMsg('');
      }, 5000);
    } catch {
      setPinChangeError('পিন আপডেট করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
      showAdminToast('পিন পরিবর্তন ব্যর্থ', 'আবার চেষ্টা করুন।', 'error');
    }
  };

  const handleResetPinChangeForm = () => {
    setOldPinInput('');
    setNewPin('');
    setIsOldPinConfirmed(false);
    setPinChangeError('');
    setPinChangeMsg('');
  };

  // Handle Save Numbers & Settings
  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSaveSuccessMsg('');
    try {
      const mergedSettings = {
        ...settings,
        marqueeNotice,
      };
      await savePaymentSettings(mergedSettings);
      saveActivePlayersSettings(activePlayersSettings);
      localStorage.setItem('aviator_marquee_text', marqueeNotice);
      window.dispatchEvent(new Event('marquee_text_updated'));
      const msg = 'সেটিংস ও স্ক্রোলিং শিরোনাম সফলভাবে সংরক্ষিত ও ক্লাউডে আপডেট হয়েছে!';
      setSaveSuccessMsg(msg);
      showAdminToast(
        'সফলভাবে সংরক্ষিত ও ক্লাউডে আপডেট হয়েছে!',
        'আপনার নতুন শিরোনাম ও পেমেন্ট সেটিংস ফায়ারবেস ক্লাউডে সেভ হয়েছে এবং সকল ইউজারের ফোনে এখনই লাইভ পরিবর্তন হয়ে গেছে।',
        'success'
      );
      setTimeout(() => setSaveSuccessMsg(''), 5000);
    } catch (e) {
      console.error(e);
      showAdminToast('সংরক্ষণ ব্যর্থ হয়েছে', 'ইন্টারনেট কানেকশন চেক করে আবার চেষ্টা করুন।', 'error');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Handle Approve Request
  const handleApprove = async (req: ManualDepositRequest) => {
    soundManager.playClick();
    const res = await approveManualDepositRequest(req.id, 'Approved via Admin Panel');
    if (res.success) {
      reloadData();
      if (onBalanceAdjusted) onBalanceAdjusted();
      const bonusText = res.isFirstDeposit && res.bonusAmount && res.bonusAmount > 0
        ? ` (মূল ৳${req.amount.toLocaleString()} + প্রথম ডিপোজিট ${res.bonusPercent}% বোনাস ৳${res.bonusAmount.toLocaleString()} = মোট ৳${(res.totalCredited || (req.amount + res.bonusAmount)).toLocaleString()})`
        : ` ৳${req.amount.toLocaleString()}`;
      showAdminToast(
        'ডিপোজিট সফলভাবে অনুমোদিত!',
        `গ্রাহক ${req.userIdentifier}-এর একাউন্টে${bonusText} ব্যালেন্স সফলভাবে যোগ ও বোনাস লক করা হয়েছে।`,
        'success'
      );
    } else {
      showAdminToast('অনুমোদনে সমস্যা হয়েছে', res.error || 'অনুমোদন ব্যর্থ হয়েছে', 'error');
    }
  };

  // Handle Reject Request
  const handleReject = async () => {
    if (!rejectingRequestId) return;
    soundManager.playClick();
    const res = await rejectManualDepositRequest(rejectingRequestId, rejectReason);
    if (res.success) {
      setRejectingRequestId(null);
      reloadData();
      showAdminToast(
        'ডিপোজিট রিকোয়েস্ট বাতিল করা হয়েছে',
        'বাতিলের তথ্য সফলভাবে ক্লাউডে রেকর্ড করা হয়েছে।',
        'error'
      );
    } else {
      showAdminToast('বাতিল করতে সমস্যা হয়েছে', res.error || 'বাতিল ব্যর্থ হয়েছে', 'error');
    }
  };

  // Handle Manual Add Balance to Phone Account
  const handleDirectCreditPhoneAccount = async (phone: string, amount: number) => {
    try {
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const raw = localStorage.getItem('aviator_phone_accounts_v1');
      let targetUid = `phone_${cleanPhone}`;
      let newBalance = amount;
      if (raw) {
        const accounts = JSON.parse(raw);
        if (accounts[cleanPhone] || accounts[phone]) {
          const accKey = accounts[cleanPhone] ? cleanPhone : phone;
          targetUid = accounts[accKey].uid || targetUid;
          accounts[accKey].balance = (accounts[accKey].balance || 0) + amount;
          accounts[accKey].totalDeposited = (accounts[accKey].totalDeposited || 0) + amount;
          accounts[accKey].updatedAt = new Date().toISOString();
          newBalance = accounts[accKey].balance;
          localStorage.setItem('aviator_phone_accounts_v1', JSON.stringify(accounts));
        }
      }

      // Sync to Firestore user document
      try {
        await setDoc(
          doc(db, 'users', targetUid),
          {
            balance: newBalance,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        if (cleanPhone && targetUid !== cleanPhone) {
          await setDoc(
            doc(db, 'users', cleanPhone),
            {
              balance: newBalance,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
      } catch (fsErr) {
        console.warn('Error syncing manual balance credit to Firestore:', fsErr);
      }

      reloadData();
      window.dispatchEvent(
        new CustomEvent('balance_credited', {
          detail: { userId: targetUid, phone: cleanPhone, amount },
        })
      );
      if (onBalanceAdjusted) onBalanceAdjusted();
      showAdminToast(
        'ব্যালেন্স যোগ সফল হয়েছে!',
        `+88 ${cleanPhone} একাউন্টে ৳${amount.toLocaleString()} সফলভাবে যোগ করা হয়েছে।`,
        'success'
      );
    } catch (err) {
      console.error(err);
    }
  };

  // Handle Manual Reset Balance
  const handleDirectResetPhoneAccount = async (phone: string) => {
    try {
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const raw = localStorage.getItem('aviator_phone_accounts_v1');
      let targetUid = `phone_${cleanPhone}`;
      if (raw) {
        const accounts = JSON.parse(raw);
        if (accounts[cleanPhone] || accounts[phone]) {
          const accKey = accounts[cleanPhone] ? cleanPhone : phone;
          targetUid = accounts[accKey].uid || targetUid;
          accounts[accKey].balance = 0;
          accounts[accKey].updatedAt = new Date().toISOString();
          localStorage.setItem('aviator_phone_accounts_v1', JSON.stringify(accounts));
        }
      }

      // Sync reset to Firestore
      try {
        await setDoc(
          doc(db, 'users', targetUid),
          {
            balance: 0,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        if (cleanPhone && targetUid !== cleanPhone) {
          await setDoc(
            doc(db, 'users', cleanPhone),
            {
              balance: 0,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
      } catch (fsErr) {
        console.warn('Error syncing reset balance to Firestore:', fsErr);
      }

      reloadData();
      window.dispatchEvent(
        new CustomEvent('balance_credited', {
          detail: { userId: targetUid, phone: cleanPhone, amount: 0 },
        })
      );
      if (onBalanceAdjusted) onBalanceAdjusted();
      showAdminToast(
        'ব্যালেন্স রিসেট সম্পন্ন',
        `+88 ${cleanPhone} একাউন্টের ব্যালেন্স ০ টাকা করা হয়েছে।`,
        'info'
      );
    } catch (err) {
      console.error(err);
    }
  };

  // Handle Refresh from Firestore
  const handleRefresh = async () => {
    setIsRefreshing(true);
    soundManager.playClick();
    try {
      const updatedReqs = await syncDepositRequestsFromFirestore();
      const updatedWithdrawals = await syncWithdrawalRequestsFromFirestore();
      const updatedSettings = await syncPaymentSettingsFromFirestore();
      setRequests(updatedReqs);
      setWithdrawals(updatedWithdrawals);
      setSettings(updatedSettings);
      showAdminToast(
        'ক্লাউড ডাটা রিফ্রেশ সম্পন্ন!',
        'ফায়ারবেস ক্লাউড থেকে সর্বশেষ সকল রিকোয়েস্ট ও সেটিংস আপডেট করা হয়েছে।',
        'info'
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  // Copy TrxID
  const handleCopyTrx = (trxId: string) => {
    navigator.clipboard.writeText(trxId);
    setCopiedTrxId(trxId);
    soundManager.playClick();
    showAdminToast('TrxID কপি হয়েছে!', trxId, 'info');
    setTimeout(() => setCopiedTrxId(null), 2000);
  };

  // Copy User Personal Number
  const handleCopyPersonalNum = (num: string) => {
    navigator.clipboard.writeText(num.replace(/[^0-9]/g, ''));
    setCopiedPersonalNumber(num);
    soundManager.playClick();
    showAdminToast('পার্সোনাল নম্বর কপি হয়েছে!', num, 'info');
    setTimeout(() => setCopiedPersonalNumber(null), 2000);
  };

  // Complete Withdrawal Request (Mark as sent)
  const handleCompleteWithdrawal = async (req: ManualWithdrawalRequest, note?: string) => {
    soundManager.playClick();
    const res = await completeManualWithdrawalRequest(req.id, note || 'টাকা সফলভাবে পাঠানো হয়েছে');
    if (res.success) {
      setCompletingWithdrawal(null);
      reloadData();
      showAdminToast(
        'উত্তোলন সফলভাবে সম্পন্ন!',
        `নম্বর ${req.personalNumber}-এ ৳${req.amount.toLocaleString()} পাঠানো নিশ্চিত করা হয়েছে।`,
        'success'
      );
    } else {
      showAdminToast('উত্তোলন সম্পন্ন করতে সমস্যা হয়েছে', res.error || 'ব্যর্থ হয়েছে', 'error');
    }
  };

  // Reject Withdrawal Request (Refund back to wallet)
  const handleRejectWithdrawalConfirm = async () => {
    if (!rejectingWithdrawalId) return;
    soundManager.playClick();
    const res = await rejectManualWithdrawalRequest(rejectingWithdrawalId, rejectWithdrawalReason);
    if (res.success) {
      soundManager.playCrash();
      setRejectingWithdrawalId(null);
      setRejectWithdrawalReason('ভুল বা অসত্য পার্সোনাল নম্বর');
      reloadData();
      if (onBalanceAdjusted) onBalanceAdjusted();
      showAdminToast(
        'উত্তোলন রিকোয়েস্ট বাতিল করা হয়েছে',
        'টাকা স্বয়ংক্রিয়ভাবে গ্রাহকের ওয়ালেটে ফেরত যোগ হয়েছে।',
        'error'
      );
    } else {
      showAdminToast('বাতিল করতে সমস্যা হয়েছে', res.error || 'ব্যর্থ হয়েছে', 'error');
    }
  };

  // Broadcast notification send handler
  const handleSendBroadcast = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!notifTitle.trim() || !notifMessage.trim()) {
      showAdminToast('তথ্য অসম্পূর্ণ', 'অনুগ্রহ করে নটিফিকেশনের শিরোনাম এবং বার্তা উভয়ই লিখুন।', 'error');
      return;
    }

    setIsSendingNotif(true);
    try {
      soundManager.playNotificationChime();
      const sent = await sendBroadcastNotification({
        title: notifTitle,
        message: notifMessage,
        type: notifType,
        sentBy: adminPhone || 'Admin',
        pinned: isPinnedNotif,
      });

      showAdminToast(
        'নটিফিকেশন পাঠানো সম্পন্ন হয়েছে! 🚀',
        `"${sent.title}" নটিফিকেশনটি সকল ইউজারের স্ক্রিনে ও ডিভাইসে লাইভ পাঠানো হয়েছে।`,
        'success'
      );

      // Reset form
      setNotifTitle('');
      setNotifMessage('');
      setNotifType('info');
      setIsPinnedNotif(false);
    } catch {
      showAdminToast('পাঠাতে সমস্যা হয়েছে', 'নটিফিকেশন পাঠাতে ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।', 'error');
    } finally {
      setIsSendingNotif(false);
    }
  };

  const handleDeleteBroadcast = async (id: string) => {
    soundManager.playClick();
    try {
      await deleteBroadcastNotification(id);
      showAdminToast('নটিফিকেশন মুছে ফেলা হয়েছে', 'নির্বাচিত বার্তাটি সফলভাবে মুছে ফেলা হয়েছে।', 'info');
    } catch {
      showAdminToast('ডিলিট ব্যর্থ', 'নটিফিকেশন মুছতে সমস্যা হয়েছে।', 'error');
    }
  };

  const handleSelectNotifPreset = (title: string, msg: string, type: BroadcastNotification['type']) => {
    soundManager.playClick();
    setNotifTitle(title);
    setNotifMessage(msg);
    setNotifType(type);
  };

  // Filter requests
  const filteredRequests = requests.filter((r) => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        r.trxId.toLowerCase().includes(q) ||
        r.senderNumber.toLowerCase().includes(q) ||
        r.userIdentifier.toLowerCase().includes(q) ||
        (r.userCode && r.userCode.toLowerCase().includes(q)) ||
        r.amount.toString().includes(q)
      );
    }
    return true;
  });

  // Filter withdrawals
  const filteredWithdrawals = withdrawals.filter((w) => {
    if (withdrawFilterStatus !== 'all' && w.status !== withdrawFilterStatus) return false;
    if (withdrawSearchQuery.trim()) {
      const q = withdrawSearchQuery.toLowerCase();
      return (
        w.personalNumber.toLowerCase().includes(q) ||
        w.userIdentifier.toLowerCase().includes(q) ||
        (w.userCode && w.userCode.toLowerCase().includes(q)) ||
        w.amount.toString().includes(q) ||
        w.method.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Filter accounts for Users tab
  const filteredAccounts = accountsWithStats.filter((acc) => {
    if (!userSearchQuery.trim()) return true;
    const q = userSearchQuery.toLowerCase();
    return (
      acc.userCode.toLowerCase().includes(q) ||
      acc.phoneNumber.includes(q) ||
      acc.displayName.toLowerCase().includes(q) ||
      acc.referralCode.toLowerCase().includes(q)
    );
  });

  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const approvedCount = requests.filter((r) => r.status === 'approved').length;
  const totalApprovedAmount = requests
    .filter((r) => r.status === 'approved')
    .reduce((sum, r) => sum + r.amount, 0);

  const pendingWithdrawalCount = withdrawals.filter((w) => w.status === 'pending').length;
  const completedWithdrawalCount = withdrawals.filter((w) => w.status === 'completed').length;
  const totalCompletedWithdrawalAmount = withdrawals
    .filter((w) => w.status === 'completed')
    .reduce((sum, w) => sum + w.amount, 0);
  const totalPendingActionCount = pendingCount + pendingWithdrawalCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-2 sm:p-4 animate-fadeIn">
      <div className="bg-[#0e1420] border border-[#223048] rounded-3xl max-w-4xl w-full shadow-2xl text-white relative max-h-[94vh] flex flex-col overflow-hidden">
        {/* ==================== PROMINENT FLOATING ACTION NOTIFICATION TOAST ==================== */}
        {actionToast && (
          <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[99999] max-w-lg w-[94%] sm:w-[500px] shadow-2xl pointer-events-auto animate-in fade-in slide-in-from-top-3 duration-300">
            <div
              className={`p-4 rounded-2xl border-2 backdrop-blur-xl flex items-start gap-3 shadow-2xl transition-all ${
                actionToast.type === 'success'
                  ? 'bg-[#091a13]/98 border-emerald-400 text-emerald-100 shadow-emerald-950/90 ring-4 ring-emerald-500/20'
                  : actionToast.type === 'error'
                  ? 'bg-[#220d11]/98 border-rose-400 text-rose-100 shadow-rose-950/90 ring-4 ring-rose-500/20'
                  : 'bg-[#0f1827]/98 border-cyan-400 text-cyan-100 shadow-cyan-950/90 ring-4 ring-cyan-500/20'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold shadow-md ${
                  actionToast.type === 'success'
                    ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-400/60'
                    : actionToast.type === 'error'
                    ? 'bg-rose-500/30 text-rose-300 border border-rose-400/60'
                    : 'bg-cyan-500/30 text-cyan-300 border border-cyan-400/60'
                }`}
              >
                {actionToast.type === 'success' ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-300 animate-pulse" />
                ) : actionToast.type === 'error' ? (
                  <XCircle className="w-6 h-6 text-rose-300" />
                ) : (
                  <Bell className="w-6 h-6 text-cyan-300" />
                )}
              </div>

              <div className="flex-1 min-w-0 pr-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-black text-sm text-white tracking-wide">{actionToast.title}</h4>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider ${
                      actionToast.type === 'success'
                        ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                        : actionToast.type === 'error'
                        ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40'
                        : 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/40'
                    }`}
                  >
                    {actionToast.type === 'success' ? 'সফল হয়েছে' : actionToast.type === 'error' ? 'বাতিল' : 'আপডেট'}
                  </span>
                </div>
                <p className="text-xs text-slate-200 mt-1 leading-snug font-medium">{actionToast.message}</p>
              </div>

              <button
                type="button"
                onClick={() => setActionToast(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
                title="বন্ধ করুন"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Top Header */}
        <div className="p-4 sm:p-5 border-b border-[#1b263b] flex items-center justify-between bg-gradient-to-r from-[#111927] to-[#141e30]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shadow-lg">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-wide">এডমিন কন্ট্রোল প্যানেল (Admin Panel)</h2>
                {pendingCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-300 font-bold text-xs animate-pulse">
                    {pendingCount} টি অপেক্ষমান
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">ম্যানুয়াল বিকাশ, নগদ, রকেট নম্বর সেটআপ ও ডিপোজিট অনুমোদন</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {isAuthenticated && (
              <>
                {/* Secret Access Guide Button */}
                <button
                  onClick={() => setShowStealthGuideModal(true)}
                  className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer"
                  title="অনলাইনে পাবলিশিং ও গোপন এডমিন এক্সেস নির্দেশিকা"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">সিক্রেট গাইড</span>
                </button>

                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="p-2 rounded-xl bg-[#1a2538] hover:bg-[#24334c] text-slate-300 hover:text-white transition-all flex items-center gap-1.5 text-xs font-semibold"
                  title="রিফ্রেশ করুন"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
                  <span className="hidden sm:inline">রিফ্রেশ</span>
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-[#1a2538] hover:bg-[#25344e] text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ==================== PIN PROTECTION SCREEN ==================== */}
        {!isAuthenticated ? (
          <div className="p-6 sm:p-12 flex flex-col items-center justify-center text-center max-w-md mx-auto my-auto">
            <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4 shadow-xl">
              <Lock className="w-8 h-8" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold mb-1">অ্যাডমিন প্রমাণীকরণ (Admin Login)</h3>
            <p className="text-xs text-slate-400 mb-6">
              পেমেন্ট নম্বর পরিচালনা, ডিপোজিট-উত্তোলন অনুমোদন ও ইউজার কন্ট্রোলের জন্য আপনার সিক্রেট এডমিন পিন দিন।
            </p>

            <form onSubmit={handlePinSubmit} className="w-full space-y-4">
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  maxLength={10}
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError('');
                  }}
                  placeholder="গোপন এডমিন পিন লিখুন"
                  autoFocus
                  className="w-full bg-[#0a0e17] border border-[#24334c] rounded-2xl px-4 py-3 text-center text-lg font-mono tracking-widest text-white focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {pinError && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-rose-400 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{pinError}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-[#120e00] font-black text-sm uppercase tracking-wider rounded-2xl shadow-lg shadow-amber-500/20 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Unlock className="w-4 h-4 font-bold" />
                <span>লগইন করুন</span>
              </button>
            </form>
          </div>
        ) : (
          /* ==================== AUTHENTICATED ADMIN PANEL ==================== */
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Stats Cards */}
            <div className="p-3 sm:p-4 bg-[#0a0e16] border-b border-[#1b2537] grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 shrink-0">
              <div className="bg-[#121a28] border border-[#202d44] rounded-2xl p-2.5 sm:p-3 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-400">ডিপোজিট পেন্ডিং</p>
                  <p className="text-base sm:text-lg font-black text-emerald-400 font-mono-numbers">
                    {pendingCount} টি
                  </p>
                </div>
              </div>

              <div className="bg-[#121a28] border border-[#202d44] rounded-2xl p-2.5 sm:p-3 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-400">উত্তোলন পেন্ডিং</p>
                  <p className="text-base sm:text-lg font-black text-rose-400 font-mono-numbers">
                    {pendingWithdrawalCount} টি
                  </p>
                </div>
              </div>

              <div className="bg-[#121a28] border border-[#202d44] rounded-2xl p-2.5 sm:p-3 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
                  <Coins className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-400">মোট ডিপোজিট অনুমোদন</p>
                  <p className="text-base sm:text-lg font-black text-cyan-400 font-mono-numbers truncate">
                    ৳ {totalApprovedAmount.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="bg-[#121a28] border border-[#202d44] rounded-2xl p-2.5 sm:p-3 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-400">মোট উত্তোলন সম্পন্ন</p>
                  <p className="text-base sm:text-lg font-black text-purple-400 font-mono-numbers truncate">
                    ৳ {totalCompletedWithdrawalAmount.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="px-3 sm:px-4 pt-3 border-b border-[#1b2537] flex items-center justify-between shrink-0 bg-[#0e1420] overflow-x-auto">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    soundManager.playClick();
                    setActiveTab('requests');
                  }}
                  className={`py-2 px-3 sm:px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'requests'
                      ? 'bg-[#1e2a3f] text-white border-b-2 border-emerald-400 shadow-md'
                      : 'text-slate-400 hover:text-white hover:bg-[#151e2e]'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                  <span>ডিপোজিট রিকোয়েস্ট</span>
                  {pendingCount > 0 && (
                    <span className="w-5 h-5 rounded-full bg-emerald-500 text-black font-black text-[10px] flex items-center justify-center">
                      {pendingCount}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => {
                    soundManager.playClick();
                    setActiveTab('withdrawals');
                  }}
                  className={`py-2 px-3 sm:px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'withdrawals'
                      ? 'bg-[#1e2a3f] text-white border-b-2 border-rose-400 shadow-md'
                      : 'text-slate-400 hover:text-white hover:bg-[#151e2e]'
                  }`}
                >
                  <ArrowDownLeft className="w-4 h-4 text-rose-400" />
                  <span>উত্তোলন রিকোয়েস্ট</span>
                  {pendingWithdrawalCount > 0 && (
                    <span className="w-5 h-5 rounded-full bg-rose-500 text-white font-black text-[10px] flex items-center justify-center animate-pulse">
                      {pendingWithdrawalCount}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => {
                    soundManager.playClick();
                    setActiveTab('users');
                  }}
                  className={`py-2 px-3 sm:px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'users'
                      ? 'bg-[#1e2a3f] text-white border-b-2 border-cyan-400 shadow-md'
                      : 'text-slate-400 hover:text-white hover:bg-[#151e2e]'
                  }`}
                >
                  <UserCheck className="w-4 h-4 text-cyan-400" />
                  <span>ইউজার লিস্ট ও হিস্ট্রি</span>
                  <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-bold text-[10px] border border-cyan-500/30">
                    {accountsWithStats.length}
                  </span>
                </button>

                <button
                  onClick={() => {
                    soundManager.playClick();
                    setActiveTab('marquee');
                  }}
                  className={`py-2 px-3 sm:px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'marquee'
                      ? 'bg-[#1e2a3f] text-white border-b-2 border-amber-400 shadow-md'
                      : 'text-slate-400 hover:text-white hover:bg-[#151e2e]'
                  }`}
                >
                  <Megaphone className="w-4 h-4 text-amber-400" />
                  <span>শিরোনাম ও নোটিশ এডিট</span>
                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                    লাইভ
                  </span>
                </button>

                <button
                  onClick={() => {
                    soundManager.playClick();
                    setActiveTab('settings');
                  }}
                  className={`py-2 px-3 sm:px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'settings'
                      ? 'bg-[#1e2a3f] text-white border-b-2 border-emerald-400 shadow-md'
                      : 'text-slate-400 hover:text-white hover:bg-[#151e2e]'
                  }`}
                >
                  <Phone className="w-4 h-4 text-emerald-400" />
                  <span>পেমেন্ট নম্বর ও সিস্টেম</span>
                </button>

                <button
                  onClick={() => {
                    soundManager.playClick();
                    setActiveTab('notifications');
                  }}
                  className={`py-2 px-3 sm:px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'notifications'
                      ? 'bg-[#1e2a3f] text-white border-b-2 border-amber-400 shadow-md ring-1 ring-amber-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-[#151e2e]'
                  }`}
                >
                  <Bell className="w-4 h-4 text-amber-400 animate-pulse" />
                  <span>ইউজারকে নটিফিকেশন পাঠান</span>
                  {broadcastList.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">
                      {broadcastList.length}
                    </span>
                  )}
                </button>
              </div>

              <button
                onClick={() => setShowPinChange(!showPinChange)}
                className="text-[11px] text-slate-400 hover:text-amber-300 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#151e2e] hover:bg-[#1e2a3e] transition-colors"
                title="এডমিন পিন পরিবর্তন করুন"
              >
                <Lock className="w-3 h-3" />
                <span className="hidden sm:inline">পিন পরিবর্তন</span>
              </button>
            </div>

            {/* Quick Change PIN panel */}
            {showPinChange && (
              <div className="bg-[#121926] border-b border-[#24334c] p-3 sm:p-4 space-y-3 shrink-0 animate-fadeIn">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#1f2b3e]">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold text-white">এডমিন পিন পরিবর্তন</span>
                    <span className="text-[11px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md flex items-center gap-1.5 border border-amber-500/20">
                      <span className="text-slate-400">বর্তমান পিন:</span>
                      <strong className="font-bold tracking-widest text-white text-xs">
                        {getMaskedPin(settings.adminPin || '1234', revealStoredPin)}
                      </strong>
                      <button
                        type="button"
                        onClick={() => setRevealStoredPin(!revealStoredPin)}
                        className="text-slate-400 hover:text-amber-300 ml-1 transition-colors cursor-pointer"
                        title={revealStoredPin ? 'পিন লুকান' : 'পিন দেখুন'}
                      >
                        {revealStoredPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      handleResetPinChangeForm();
                      setShowPinChange(false);
                    }}
                    className="text-slate-400 hover:text-white text-xs px-2.5 py-1 rounded-lg bg-[#182234] hover:bg-[#202d44] transition-colors cursor-pointer"
                  >
                    বন্ধ করুন
                  </button>
                </div>

                {/* Step 1: Verify Current PIN (পুরাতন পিন লিখুন এর ঘরে বর্তমান পিন হবে) */}
                {!isOldPinConfirmed ? (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold flex items-center justify-center border border-amber-500/40">১</span>
                      <span>বর্তমান পিন লিখুন:</span>
                    </span>

                    <div className="relative">
                      <input
                        type={showOldPinToggle ? 'text' : 'password'}
                        maxLength={10}
                        value={oldPinInput}
                        onChange={(e) => {
                          setOldPinInput(e.target.value);
                          setPinChangeError('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleVerifyOldPin();
                        }}
                        placeholder="বর্তমান পিন"
                        autoFocus
                        className="bg-[#0b1019] border border-[#2b3a54] rounded-xl px-3 py-1.5 pr-8 text-xs text-white font-mono w-36 tracking-widest focus:outline-hidden focus:border-amber-400"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOldPinToggle(!showOldPinToggle)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                      >
                        {showOldPinToggle ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleVerifyOldPin}
                      className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-black text-xs rounded-xl shadow cursor-pointer active:scale-95 transition-all flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>কনফার্ম করুন</span>
                    </button>
                  </div>
                ) : (
                  /* Step 2: Set New PIN (নতুন পিন দিয়ে আপডেট হবে) */
                  <div className="flex flex-wrap items-center gap-2.5 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/30 animate-fadeIn">
                    <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>বর্তমান পিন নিশ্চিত! এবার নতুন পিন লিখুন:</span>
                    </span>

                    <div className="relative">
                      <input
                        type={showNewPinToggle ? 'text' : 'password'}
                        maxLength={10}
                        value={newPin}
                        onChange={(e) => {
                          setNewPin(e.target.value);
                          setPinChangeError('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveNewPin();
                        }}
                        placeholder="নতুন পিন"
                        autoFocus
                        className="bg-[#0b1019] border border-emerald-500/50 rounded-xl px-3 py-1.5 pr-8 text-xs text-white font-mono w-40 tracking-widest focus:outline-hidden focus:border-emerald-400"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPinToggle(!showNewPinToggle)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                      >
                        {showNewPinToggle ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {/* Asterisk Preview while typing */}
                    {newPin.length > 0 && (
                      <span className="text-xs font-mono text-cyan-300 tracking-widest bg-cyan-950/40 px-2 py-1 rounded border border-cyan-800/40">
                        {getMaskedPin(newPin)}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={handleSaveNewPin}
                      className="px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white font-black text-xs rounded-xl shadow cursor-pointer active:scale-95 transition-all flex items-center gap-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>আপডেট করুন</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsOldPinConfirmed(false)}
                      className="px-2.5 py-1.5 bg-[#1b2538] hover:bg-[#25344c] text-slate-300 text-xs rounded-xl cursor-pointer"
                    >
                      বাতিল
                    </button>
                  </div>
                )}

                {/* Error Banner */}
                {pinChangeError && (
                  <div className="flex items-center gap-1.5 text-xs text-rose-400 font-medium animate-fadeIn">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{pinChangeError}</span>
                  </div>
                )}

                {/* Success Banner */}
                {pinChangeMsg && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold animate-fadeIn">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{pinChangeMsg}</span>
                  </div>
                )}
              </div>
            )}

            {/* ==================== TAB 1: DEPOSIT REQUESTS ==================== */}
            {activeTab === 'requests' && (
              <div className="flex-1 flex flex-col min-h-0 p-3 sm:p-4 overflow-hidden">
                {/* Search & Filter Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3 shrink-0">
                  <div className="flex items-center gap-1 bg-[#0b1018] p-1 rounded-xl border border-[#1d273a]">
                    <button
                      onClick={() => setFilterStatus('pending')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        filterStatus === 'pending'
                          ? 'bg-amber-500 text-[#120e00] shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      অপেক্ষমান ({pendingCount})
                    </button>
                    <button
                      onClick={() => setFilterStatus('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        filterStatus === 'all'
                          ? 'bg-[#1f2b3e] text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      সকল ({requests.length})
                    </button>
                    <button
                      onClick={() => setFilterStatus('approved')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        filterStatus === 'approved'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      অনুমোদিত ({approvedCount})
                    </button>
                    <button
                      onClick={() => setFilterStatus('rejected')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        filterStatus === 'rejected'
                          ? 'bg-rose-600 text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      বাতিল ({requests.filter((r) => r.status === 'rejected').length})
                    </button>
                  </div>

                  <div className="relative min-w-[200px] flex-1 sm:flex-initial">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="TrxID বা নম্বর খুঁজুন..."
                      className="w-full bg-[#0b1018] border border-[#1e2a3f] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white focus:outline-hidden focus:border-amber-400"
                    />
                  </div>
                </div>

                {/* Requests List */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {filteredRequests.length === 0 ? (
                    <div className="h-48 flex flex-col items-center justify-center text-center p-6 bg-[#0a0e16] border border-[#1b2537] rounded-2xl">
                      <Clock className="w-8 h-8 text-slate-600 mb-2" />
                      <p className="text-sm font-semibold text-slate-400">কোনো ডিপোজিট রিকোয়েস্ট পাওয়া যায়নি</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {filterStatus === 'pending'
                          ? 'বর্তমানে কোনো পেন্ডিং রিকোয়েস্ট নেই'
                          : 'ফিল্টার পরিবর্তন করে দেখুন'}
                      </p>
                    </div>
                  ) : (
                    filteredRequests.map((req) => {
                      const isBkash = req.method === 'bkash';
                      const isNagad = req.method === 'nagad';
                      const isPending = req.status === 'pending';
                      const isApproved = req.status === 'approved';

                      return (
                        <div
                          key={req.id}
                          className={`p-3.5 rounded-2xl border transition-all ${
                            isPending
                              ? 'bg-[#121927] border-amber-500/40 shadow-lg shadow-amber-500/5'
                              : isApproved
                              ? 'bg-[#0e1622] border-emerald-500/20 opacity-90'
                              : 'bg-[#0c121c] border-rose-500/20 opacity-70'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            {/* Left: Method & Amount */}
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`px-2.5 py-1 rounded-xl text-xs font-black uppercase flex items-center gap-1.5 ${
                                  isBkash
                                    ? 'bg-[#e2136e]/20 text-[#ff4f9a] border border-[#e2136e]/40'
                                    : isNagad
                                    ? 'bg-[#f7941d]/20 text-[#ffa843] border border-[#f7941d]/40'
                                    : 'bg-[#8c3494]/20 text-[#ba68c8] border border-[#8c3494]/40'
                                }`}
                              >
                                <span>{req.method.toUpperCase()}</span>
                              </div>

                              <div>
                                <span className="text-lg sm:text-xl font-black text-emerald-400 font-mono-numbers">
                                  ৳ {req.amount.toLocaleString()}
                                </span>
                              </div>

                              {/* Status Badge */}
                              <span
                                className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 ${
                                  isPending
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                                    : isApproved
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                {isPending && <Clock className="w-3 h-3" />}
                                {isApproved && <CheckCircle2 className="w-3 h-3" />}
                                {!isPending && !isApproved && <XCircle className="w-3 h-3" />}
                                <span>
                                  {isPending ? 'অপেক্ষমান (Pending)' : isApproved ? 'অনুমোদিত' : 'বাতিল'}
                                </span>
                              </span>
                            </div>

                            {/* Right: Date & Time */}
                            <div className="text-[11px] text-slate-400 font-mono">
                              {new Date(req.createdAt).toLocaleString('bn-BD', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </div>
                          </div>

                          {/* Middle: Details Grid */}
                          <div className="mt-3 pt-2.5 border-t border-[#1e2a3e] grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                            <div className="bg-[#0b1018] p-2 rounded-xl">
                              <span className="text-slate-500 text-[10px] block">যে নম্বর থেকে পাঠানো হয়েছে (Sender):</span>
                              <span className="font-mono font-bold text-white tracking-wide">
                                {req.senderNumber}
                              </span>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="text-[10px] text-slate-400 truncate">
                                  {req.userIdentifier}
                                </span>
                                {req.userCode && (
                                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-500/30">
                                    {req.userCode}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setSelectedHistoryUserId(req.userCode || req.senderNumber || req.userId)}
                                  className="px-1.5 py-0.5 rounded bg-[#172337] hover:bg-[#20304a] text-cyan-300 hover:text-white text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                  title="এই ইউজারের সম্পূর্ণ হিস্ট্রি দেখুন"
                                >
                                  <History className="w-3 h-3" />
                                  <span>হিস্ট্রি</span>
                                </button>
                              </div>
                            </div>

                            <div className="bg-[#0b1018] p-2 rounded-xl">
                              <span className="text-slate-500 text-[10px] block">অ্যাডমিন প্রাপ্ত নম্বর (Target):</span>
                              <span className="font-mono font-bold text-slate-300 tracking-wide">
                                {req.targetNumber}
                              </span>
                            </div>

                            <div className="bg-[#0b1018] p-2 rounded-xl flex items-center justify-between">
                              <div>
                                <span className="text-slate-500 text-[10px] block">ট্রানজেকশন আইডি (TrxID):</span>
                                <span className="font-mono font-black text-amber-300 tracking-wider text-sm select-all">
                                  {req.trxId}
                                </span>
                              </div>
                              <button
                                onClick={() => handleCopyTrx(req.trxId)}
                                className="p-1.5 rounded-lg bg-[#1a2538] hover:bg-[#25354e] text-slate-300 hover:text-white transition-colors"
                                title="TrxID কপি করুন"
                              >
                                {copiedTrxId === req.trxId ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>

                          {/* First deposit bonus indicator */}
                          {(req.isFirstDeposit || (!req.hasDeposited && isPending)) && (
                            <div className="mt-2.5 p-2 rounded-xl bg-gradient-to-r from-amber-500/15 via-yellow-500/10 to-emerald-500/15 border border-amber-500/30 flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                <span>প্রথম ডিপোজিট অফার: +{req.bonusPercent ?? (settings.firstDepositBonusPercent ?? 50)}% বোনাস (+৳{(req.bonusAmount || Math.round((req.amount * ((req.bonusPercent ?? (settings.firstDepositBonusPercent ?? 50)) / 100)) * 100) / 100).toLocaleString()})</span>
                              </div>
                              <div className="text-[11px] font-mono font-black text-emerald-400">
                                মোট যোগ হবে: ৳{(req.totalCredited || (req.amount + (req.bonusAmount || Math.round((req.amount * ((req.bonusPercent ?? (settings.firstDepositBonusPercent ?? 50)) / 100)) * 100) / 100))).toLocaleString()}
                              </div>
                            </div>
                          )}

                          {/* If already approved and had bonus */}
                          {isApproved && req.bonusAmount && req.bonusAmount > 0 && (
                            <div className="mt-2 p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-center gap-1 font-medium">
                              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span>প্রথম ডিপোজিট সফল: মূল ৳{req.amount.toLocaleString()} + {req.bonusPercent}% বোনাস ৳{req.bonusAmount.toLocaleString()} = মোট ৳{req.totalCredited?.toLocaleString()} ক্রেডিট ও লক করা হয়েছে</span>
                            </div>
                          )}

                          {/* Rejection / Note Info if any */}
                          {req.rejectionReason && (
                            <p className="mt-2 text-[11px] text-rose-400 bg-rose-500/10 px-2 py-1 rounded-lg">
                              বাতিলের কারণ: {req.rejectionReason}
                            </p>
                          )}

                          {/* Bottom Action Buttons (for Pending) */}
                          {isPending && (
                            <div className="mt-3 pt-2.5 border-t border-[#1e2a3e] flex items-center justify-end gap-2">
                              <button
                                onClick={() => setRejectingRequestId(req.id)}
                                className="px-3 py-1.5 rounded-xl border border-rose-500/40 hover:bg-rose-500/20 text-rose-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>বাতিল করুন</span>
                              </button>

                              <button
                                onClick={() => handleApprove(req)}
                                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white text-xs font-black shadow-lg shadow-emerald-700/20 active:scale-98 transition-all cursor-pointer flex items-center gap-1.5"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                <span>
                                  অনুমোদন ও ব্যালেন্স যোগ করুন (+৳{(req.totalCredited || (req.amount + (req.isFirstDeposit ? (req.bonusAmount || 0) : 0))).toLocaleString()})
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ==================== TAB 2: WITHDRAWAL REQUESTS ==================== */}
            {activeTab === 'withdrawals' && (
              <div className="flex-1 flex flex-col min-h-0 p-3 sm:p-4 overflow-hidden">
                {/* Search & Filter Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3 shrink-0">
                  <div className="flex items-center gap-1 bg-[#0b1018] p-1 rounded-xl border border-[#1d273a]">
                    <button
                      onClick={() => setWithdrawFilterStatus('pending')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        withdrawFilterStatus === 'pending'
                          ? 'bg-rose-600 text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      অপেক্ষমান ({pendingWithdrawalCount})
                    </button>
                    <button
                      onClick={() => setWithdrawFilterStatus('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        withdrawFilterStatus === 'all'
                          ? 'bg-[#1f2b3e] text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      সকল ({withdrawals.length})
                    </button>
                    <button
                      onClick={() => setWithdrawFilterStatus('completed')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        withdrawFilterStatus === 'completed'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      টাকা পাঠানো হয়েছে ({completedWithdrawalCount})
                    </button>
                    <button
                      onClick={() => setWithdrawFilterStatus('rejected')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        withdrawFilterStatus === 'rejected'
                          ? 'bg-red-900 text-rose-300 shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      বাতিল ও রিফান্ড ({withdrawals.filter((w) => w.status === 'rejected').length})
                    </button>
                  </div>

                  <div className="relative min-w-[220px] flex-1 sm:flex-initial">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={withdrawSearchQuery}
                      onChange={(e) => setWithdrawSearchQuery(e.target.value)}
                      placeholder="পার্সোনাল নম্বর বা ইউজার খুঁজুন..."
                      className="w-full bg-[#0b1018] border border-[#1e2a3f] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white focus:outline-hidden focus:border-rose-400"
                    />
                  </div>
                </div>

                {/* Withdrawals List */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {filteredWithdrawals.length === 0 ? (
                    <div className="h-48 flex flex-col items-center justify-center text-center p-6 bg-[#0a0e16] border border-[#1b2537] rounded-2xl">
                      <ArrowDownLeft className="w-8 h-8 text-slate-600 mb-2" />
                      <p className="text-sm font-semibold text-slate-400">কোনো উত্তোলন রিকোয়েস্ট পাওয়া যায়নি</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {withdrawFilterStatus === 'pending'
                          ? 'বর্তমানে কোনো পেন্ডিং উত্তোলন রিকোয়েস্ট নেই'
                          : 'ফিল্টার পরিবর্তন করে দেখুন'}
                      </p>
                    </div>
                  ) : (
                    filteredWithdrawals.map((req) => {
                      const isBkash = req.method === 'bkash';
                      const isNagad = req.method === 'nagad';
                      const isPending = req.status === 'pending';
                      const isCompleted = req.status === 'completed';

                      return (
                        <div
                          key={req.id}
                          className={`p-3.5 rounded-2xl border transition-all ${
                            isPending
                              ? 'bg-[#15121e] border-rose-500/40 shadow-lg shadow-rose-950/20'
                              : isCompleted
                              ? 'bg-[#0e1622] border-emerald-500/20 opacity-90'
                              : 'bg-[#150d12] border-rose-900/40 opacity-70'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            {/* Left: Method & Amount */}
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`px-2.5 py-1 rounded-xl text-xs font-black uppercase flex items-center gap-1.5 ${
                                  isBkash
                                    ? 'bg-[#e2136e]/20 text-[#ff4f9a] border border-[#e2136e]/40'
                                    : isNagad
                                    ? 'bg-[#f7941d]/20 text-[#ffa843] border border-[#f7941d]/40'
                                    : 'bg-[#8c3494]/20 text-[#ba68c8] border border-[#8c3494]/40'
                                }`}
                              >
                                <span>{req.method.toUpperCase()}</span>
                                <span className="text-[10px] font-medium bg-white/10 px-1 rounded">Personal</span>
                              </div>

                              <div>
                                <span className="text-lg sm:text-xl font-black text-rose-400 font-mono-numbers">
                                  ৳ {req.amount.toLocaleString()}
                                </span>
                              </div>

                              {/* Status Badge */}
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 ${
                                  isPending
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                                    : isCompleted
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                {isPending && <Clock className="w-3 h-3" />}
                                {isCompleted && <CheckCircle2 className="w-3 h-3" />}
                                {!isPending && !isCompleted && <XCircle className="w-3 h-3" />}
                                <span>
                                  {isPending
                                    ? 'অপেক্ষমান (টাকা সেন্ড করুন)'
                                    : isCompleted
                                    ? 'টাকা পাঠানো হয়েছে (Completed)'
                                    : 'বাতিল ও রিফান্ড'}
                                </span>
                              </span>
                            </div>

                            {/* Right: Date & Time */}
                            <div className="text-[11px] text-slate-400 font-mono">
                              {new Date(req.createdAt).toLocaleString('bn-BD', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </div>
                          </div>

                          {/* Middle: Details Grid */}
                          <div className="mt-3 pt-2.5 border-t border-[#1e2a3e] grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                            {/* Personal Phone with copy button */}
                            <div className="bg-[#0b1018] p-2.5 rounded-xl border border-[#1b2538] flex items-center justify-between">
                              <div>
                                <span className="text-slate-400 text-[10px] block font-medium">গ্রাহকের পার্সোনাল নম্বর (Personal No):</span>
                                <span className="font-mono font-black text-white text-sm tracking-wider select-all">
                                  {req.personalNumber}
                                </span>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className="text-[10px] text-slate-400 truncate">
                                    {req.userIdentifier}
                                  </span>
                                  {req.userCode && (
                                    <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-500/30">
                                      {req.userCode}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setSelectedHistoryUserId(req.userCode || req.personalNumber || req.userId)}
                                    className="px-1.5 py-0.5 rounded bg-[#172337] hover:bg-[#20304a] text-cyan-300 hover:text-white text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                    title="এই ইউজারের সম্পূর্ণ হিস্ট্রি দেখুন"
                                  >
                                    <History className="w-3 h-3" />
                                    <span>হিস্ট্রি</span>
                                  </button>
                                </div>
                              </div>
                              <button
                                onClick={() => handleCopyPersonalNum(req.personalNumber)}
                                className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                                  copiedPersonalNumber === req.personalNumber
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-[#182335] hover:bg-[#22314a] text-amber-300 hover:text-white'
                                }`}
                                title="নম্বর কপি করুন"
                              >
                                {copiedPersonalNumber === req.personalNumber ? (
                                  <>
                                    <Check className="w-3 h-3 stroke-[3]" />
                                    <span>কপি হয়েছে</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>কপি</span>
                                  </>
                                )}
                              </button>
                            </div>

                            <div className="bg-[#0b1018] p-2.5 rounded-xl border border-[#1b2538]">
                              <span className="text-slate-400 text-[10px] block font-medium">উত্তোলন মাধ্যম (Method):</span>
                              <span className="font-mono font-bold text-amber-300 text-sm uppercase">
                                {req.method} Personal
                              </span>
                              <span className="text-[10px] text-slate-400 block mt-0.5">
                                শুধুমাত্র পার্সোনাল একাউন্টে সেন্ড মানি করুন
                              </span>
                            </div>

                            <div className="bg-[#0b1018] p-2.5 rounded-xl border border-[#1b2538]">
                              <span className="text-slate-400 text-[10px] block font-medium">প্রদেয় টাকা (Payable Amount):</span>
                              <span className="font-mono font-black text-emerald-400 text-sm">
                                ৳ {req.amount.toLocaleString()}
                              </span>
                              <span className="text-[10px] text-slate-400 block mt-0.5">
                                {isPending ? 'ইউজার ব্যালেন্স থেকে কাটা হয়েছে' : isCompleted ? 'সফলভাবে পাঠানো হয়েছে' : 'ব্যালেন্সে রিফান্ড করা হয়েছে'}
                              </span>
                            </div>
                          </div>

                          {/* Admin Note if present */}
                          {req.adminNote && (
                            <p className="mt-2 text-[11px] text-emerald-300 bg-emerald-500/10 px-2.5 py-1.5 rounded-xl border border-emerald-500/20">
                              এডমিন নোট: {req.adminNote}
                            </p>
                          )}

                          {/* Rejection Info if rejected */}
                          {req.rejectionReason && (
                            <p className="mt-2 text-[11px] text-rose-300 bg-rose-500/10 px-2.5 py-1.5 rounded-xl border border-rose-500/20">
                              বাতিলের কারণ: {req.rejectionReason} (টাকা ইউজারের একাউন্টে ফেরত দেওয়া হয়েছে)
                            </p>
                          )}

                          {/* Action Buttons for Pending */}
                          {isPending && (
                            <div className="mt-3 pt-2.5 border-t border-[#1e2a3e] flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[11px] text-slate-400">
                                💡 নির্দেশিকা: নম্বর কপি করে আপনার বিকাশ/নগদ/রকেট অ্যাপ থেকে সেন্ড মানি করুন, তারপর নিশ্চিত করুন।
                              </span>

                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    setRejectingWithdrawalId(req.id);
                                    setRejectWithdrawalReason('ভুল বা বন্ধ পার্সোনাল নম্বর');
                                  }}
                                  className="px-3 py-1.5 rounded-xl border border-rose-500/40 hover:bg-rose-500/20 text-rose-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>বাতিল ও রিফান্ড</span>
                                </button>

                                <button
                                  onClick={() => {
                                    setCompletingWithdrawal(req);
                                    setCompleteAdminNote(`টাকা পাঠানো হয়েছে (${req.method.toUpperCase()} Personal)`);
                                  }}
                                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white text-xs font-black shadow-lg shadow-emerald-700/20 active:scale-98 transition-all cursor-pointer flex items-center gap-1.5"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  <span>টাকা সেন্ড করেছি (Mark as Sent)</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ==================== TAB 2: PAYMENT NUMBERS SETTINGS ==================== */}
            {activeTab === 'settings' && (
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-300">
                    <p className="font-bold text-amber-300">ম্যানুয়াল পেমেন্ট নম্বর কনফিগারেশন</p>
                    <p className="mt-0.5 text-slate-400">
                      এখানে যে বিকাশ, নগদ ও রকেট নম্বর সেট করবেন, ইউজার যখন ডিপোজিটে ক্লিক করবে ঠিক সেই নম্বরটিই দেখতে পাবে। ইউজার সেই নম্বরে টাকা পাঠিয়ে TrxID সাবমিট করবে।
                    </p>
                  </div>
                </div>

                {saveSuccessMsg && (
                  <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-fadeIn">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{saveSuccessMsg}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* bKash Card */}
                  <div className="bg-[#0b1018] border border-[#e2136e]/40 rounded-2xl p-4 shadow-lg shadow-[#e2136e]/5 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[#1f2838]">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#e2136e] text-white font-black text-xs flex items-center justify-center">
                          bK
                        </div>
                        <span className="font-black text-sm text-[#ff4f9a]">বিকাশ (bKash)</span>
                      </div>
                      <label className="text-[11px] flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="checkbox"
                          checked={settings.bkash.isActive}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              bkash: { ...settings.bkash, isActive: e.target.checked },
                            })
                          }
                          className="rounded accent-emerald-500"
                        />
                        <span>সক্রিয়</span>
                      </label>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        বিকাশ নম্বর (Admin Number):
                      </label>
                      <input
                        type="text"
                        value={settings.bkash.number}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            bkash: { ...settings.bkash, number: e.target.value },
                          })
                        }
                        placeholder="যেমন: 01712-345678"
                        className="w-full bg-[#121926] border border-[#233148] rounded-xl px-3 py-2 text-sm font-mono font-bold text-white focus:outline-hidden focus:border-[#e2136e]"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        অ্যাকাউন্টের ধরন:
                      </label>
                      <select
                        value={settings.bkash.accountType}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            bkash: {
                              ...settings.bkash,
                              accountType: e.target.value as 'Personal' | 'Agent' | 'Merchant',
                            },
                          })
                        }
                        className="w-full bg-[#121926] border border-[#233148] rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-[#e2136e]"
                      >
                        <option value="Personal">Personal (সেন্ড মানি)</option>
                        <option value="Agent">Agent (ক্যাশ আউট)</option>
                        <option value="Merchant">Merchant (পেমেন্ট)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        ব্যবহারকারীর জন্য নির্দেশনা:
                      </label>
                      <input
                        type="text"
                        value={settings.bkash.instructions}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            bkash: { ...settings.bkash, instructions: e.target.value },
                          })
                        }
                        placeholder="নির্দেশনা..."
                        className="w-full bg-[#121926] border border-[#233148] rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-hidden focus:border-[#e2136e]"
                      />
                    </div>
                  </div>

                  {/* Nagad Card */}
                  <div className="bg-[#0b1018] border border-[#f7941d]/40 rounded-2xl p-4 shadow-lg shadow-[#f7941d]/5 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[#1f2838]">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#f7941d] text-white font-black text-xs flex items-center justify-center">
                          ন
                        </div>
                        <span className="font-black text-sm text-[#ffa843]">নগদ (Nagad)</span>
                      </div>
                      <label className="text-[11px] flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="checkbox"
                          checked={settings.nagad.isActive}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              nagad: { ...settings.nagad, isActive: e.target.checked },
                            })
                          }
                          className="rounded accent-emerald-500"
                        />
                        <span>সক্রিয়</span>
                      </label>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        নগদ নম্বর (Admin Number):
                      </label>
                      <input
                        type="text"
                        value={settings.nagad.number}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            nagad: { ...settings.nagad, number: e.target.value },
                          })
                        }
                        placeholder="যেমন: 01812-345678"
                        className="w-full bg-[#121926] border border-[#233148] rounded-xl px-3 py-2 text-sm font-mono font-bold text-white focus:outline-hidden focus:border-[#f7941d]"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        অ্যাকাউন্টের ধরন:
                      </label>
                      <select
                        value={settings.nagad.accountType}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            nagad: {
                              ...settings.nagad,
                              accountType: e.target.value as 'Personal' | 'Agent' | 'Merchant',
                            },
                          })
                        }
                        className="w-full bg-[#121926] border border-[#233148] rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-[#f7941d]"
                      >
                        <option value="Personal">Personal (সেন্ড মানি)</option>
                        <option value="Agent">Agent (ক্যাশ আউট)</option>
                        <option value="Merchant">Merchant (পেমেন্ট)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        ব্যবহারকারীর জন্য নির্দেশনা:
                      </label>
                      <input
                        type="text"
                        value={settings.nagad.instructions}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            nagad: { ...settings.nagad, instructions: e.target.value },
                          })
                        }
                        placeholder="নির্দেশনা..."
                        className="w-full bg-[#121926] border border-[#233148] rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-hidden focus:border-[#f7941d]"
                      />
                    </div>
                  </div>

                  {/* Rocket Card */}
                  <div className="bg-[#0b1018] border border-[#8c3494]/40 rounded-2xl p-4 shadow-lg shadow-[#8c3494]/5 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[#1f2838]">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#8c3494] text-white font-black text-xs flex items-center justify-center">
                          R
                        </div>
                        <span className="font-black text-sm text-[#ba68c8]">রকেট (Rocket)</span>
                      </div>
                      <label className="text-[11px] flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="checkbox"
                          checked={settings.rocket.isActive}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              rocket: { ...settings.rocket, isActive: e.target.checked },
                            })
                          }
                          className="rounded accent-emerald-500"
                        />
                        <span>সক্রিয়</span>
                      </label>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        রকেট নম্বর (Admin Number):
                      </label>
                      <input
                        type="text"
                        value={settings.rocket.number}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            rocket: { ...settings.rocket, number: e.target.value },
                          })
                        }
                        placeholder="যেমন: 01912-345678"
                        className="w-full bg-[#121926] border border-[#233148] rounded-xl px-3 py-2 text-sm font-mono font-bold text-white focus:outline-hidden focus:border-[#8c3494]"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        অ্যাকাউন্টের ধরন:
                      </label>
                      <select
                        value={settings.rocket.accountType}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            rocket: {
                              ...settings.rocket,
                              accountType: e.target.value as 'Personal' | 'Agent' | 'Merchant',
                            },
                          })
                        }
                        className="w-full bg-[#121926] border border-[#233148] rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-[#8c3494]"
                      >
                        <option value="Personal">Personal (সেন্ড মানি)</option>
                        <option value="Agent">Agent (ক্যাশ আউট)</option>
                        <option value="Merchant">Merchant (পেমেন্ট)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        ব্যবহারকারীর জন্য নির্দেশনা:
                      </label>
                      <input
                        type="text"
                        value={settings.rocket.instructions}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            rocket: { ...settings.rocket, instructions: e.target.value },
                          })
                        }
                        placeholder="নির্দেশনা..."
                        className="w-full bg-[#121926] border border-[#233148] rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-hidden focus:border-[#8c3494]"
                      />
                    </div>
                  </div>
                </div>

                {/* ==================== FIRST DEPOSIT BONUS & WITHDRAWAL SECURITY POLICY ==================== */}
                <div className="bg-[#0b1019] border border-amber-500/40 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl shadow-amber-500/5">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#1d293d]">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 to-yellow-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40 shadow-sm">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>প্রথম ডিপোজিট বোনাস (%) ও উইথড্র সিকিউরিটি পলিসি</span>
                          <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 font-semibold font-mono">
                            অটো-ক্রেডিট
                          </span>
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          ইউজার যখন প্রথমবার টাকা পাঠাবে এবং আপনি ডিপোজিট অনুমোদন দিবেন, সাথে সাথে ঠিক এই % বোনাস স্বয়ংক্রিয়ভাবে যুক্ত হবে
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono font-bold text-xs">
                      <span>বর্তমান রেট: {settings.firstDepositBonusPercent ?? 50}%</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Bonus % Input & Presets */}
                    <div className="bg-[#121926] border border-[#233148] rounded-xl p-3.5 space-y-3">
                      <label className="text-xs font-bold text-slate-200 block">
                        প্রথম ডিপোজিটে কত % বোনাস পাবে (বোনাস রেট):
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="500"
                          value={settings.firstDepositBonusPercent ?? 50}
                          onChange={(e) => {
                            const val = Math.max(0, parseInt(e.target.value) || 0);
                            setSettings({
                              ...settings,
                              firstDepositBonusPercent: val,
                            });
                          }}
                          placeholder="50"
                          className="w-28 bg-[#0b1018] border border-amber-500/50 rounded-xl px-3 py-2 text-base font-mono font-black text-amber-300 text-center focus:outline-hidden focus:border-amber-400"
                        />
                        <span className="text-sm font-bold text-amber-400">%</span>
                        <span className="text-xs text-slate-400 ml-2">
                          (যেমন: ৳১,০০০ ডিপোজিটে +{(settings.firstDepositBonusPercent ?? 50)}% = ৳{1000 + Math.round(1000 * ((settings.firstDepositBonusPercent ?? 50) / 100))} যোগ হবে)
                        </span>
                      </div>

                      {/* Quick Presets */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] text-slate-400 mr-1">কুইক সিলেক্ট:</span>
                        {[
                          { label: '০% (বন্ধ)', val: 0 },
                          { label: '২০%', val: 20 },
                          { label: '৫০% (ডিফল্ট)', val: 50 },
                          { label: '১০০% (দ্বিগুণ)', val: 100 },
                          { label: '১৫০%', val: 150 },
                          { label: '২০০%', val: 200 },
                        ].map((preset) => (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() =>
                              setSettings({
                                ...settings,
                                firstDepositBonusPercent: preset.val,
                              })
                            }
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer ${
                              (settings.firstDepositBonusPercent ?? 50) === preset.val
                                ? 'bg-amber-500 text-black shadow-md'
                                : 'bg-[#0b1018] border border-[#233148] text-slate-300 hover:text-white hover:border-slate-500'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Business Rules Summary */}
                    <div className="bg-[#121926] border border-[#233148] rounded-xl p-3.5 space-y-2 text-[11px] text-slate-300">
                      <span className="font-bold text-amber-300 flex items-center gap-1 text-xs">
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                        <span>সিস্টেমের সক্রিয় সিকিউরিটি ও ক্যাশআউট নীতিমালা:</span>
                      </span>
                      <ul className="space-y-1.5 list-disc pl-4 text-slate-300">
                        <li>
                          <strong className="text-emerald-400">প্রথম ডিপোজিট বোনাস:</strong> আপনি পেন্ডিং তালিকা থেকে অনুমোদন দিলে ব্যবহারকারীর প্রথম ডিপোজিটে স্বয়ংক্রিয়ভাবে এই % বোনাস যুক্ত ও হিস্ট্রিতে রেকর্ড হবে।
                        </li>
                        <li>
                          <strong className="text-rose-400">অ-উত্তোলনযোগ্য ব্যালেন্স:</strong> বোনাস পাওয়া, কমিশন পাওয়া, রেফার কমিশন বা স্পিন রিওয়ার্ড—সকল এক্সট্রা টাকা কখনই সরাসরি উইথড্র দেওয়া যাবে না। শুধুমাত্র গেম খেলে উইন হওয়া টাকা উইথড্র দেওয়া যাবে।
                        </li>
                        <li>
                          <strong className="text-cyan-400">ডিভাইস লিমিট:</strong> একই ডিভাইসে ২ টার বেশি একাউন্ট খুলতে পারবে না। ৩য় একাউন্ট খোলার চেষ্টা করলেই সিস্টেম স্বয়ংক্রিয়ভাবে ব্লক করে আগের একাউন্টে লগইন করতে বলবে।
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Notice text */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    সার্বজনীন ডিপোজিট নোটিশ (ডিপোজিট মডালে প্রদর্শিত হবে):
                  </label>
                  <textarea
                    rows={2}
                    value={settings.noticeText}
                    onChange={(e) => setSettings({ ...settings, noticeText: e.target.value })}
                    className="w-full bg-[#0b1018] border border-[#223048] rounded-xl p-3 text-xs text-white focus:outline-hidden focus:border-amber-400"
                  />
                </div>

                {/* Marquee Ticker Notice */}
                <div className="bg-[#0b1018] border border-amber-500/30 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <Megaphone className="w-4 h-4 text-amber-400" />
                      <span>হেডার স্ক্রোলিং শিরোনাম (ডান থেকে বামে চলমান নোটিশ):</span>
                    </label>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 font-mono">
                      লাইভ স্ক্রিন
                    </span>
                  </div>
                  <textarea
                    rows={2}
                    value={marqueeNotice}
                    onChange={(e) => setMarqueeNotice(e.target.value)}
                    placeholder="এখানে যা লিখবেন তা অ্যাপের উপরে ডান থেকে বামে স্ক্রল হবে..."
                    className="w-full bg-[#121926] border border-[#223048] rounded-xl p-3 text-xs text-amber-100 font-medium focus:outline-hidden focus:border-amber-400"
                  />
                  <p className="text-[10.5px] text-slate-400">
                    💡 আপনি এখানে যেকোনো টেক্সট, ঘোষণা বা অফার লিখে নিচে <strong>"সেটিংস সংরক্ষণ করুন"</strong> চাপলেই তা অ্যাপের উপরে স্বয়ংক্রিয়ভাবে ডান থেকে বামে স্ক্রোল হতে থাকবে।
                  </p>
                </div>

                {/* ==================== LIVE FIREBASE & NOTIFICATION SYSTEM ==================== */}
                <div className="bg-[#0b1019] border border-emerald-500/30 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-xl">
                  <div className="flex items-center justify-between pb-2 border-b border-[#1d293d]">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                        <Bell className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>রিয়েল-টাইম নোটিফিকেশন ও অনলাইন ক্লাউড</span>
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30 font-semibold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                            অনলাইন সক্রিয়
                          </span>
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          কোনো ইউজার এডমানি (ডিপোজিট) বা ক্যাশআউট (উইথড্র) দিলে সাথে সাথে সাউন্ড ও নোটিফিকেশন পাবেন
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#121926] border border-[#233148] rounded-xl p-3.5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div>
                        <p className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span>মোবাইল ও ব্রাউজার পুশ নোটিফিকেশন:</span>
                          <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-emerald-500/20 text-emerald-300">
                            সক্রিয়
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          স্ক্রিন অফ বা ব্যাকগ্রাউন্ডে থাকলেও আপনার মোবাইলে সরাসরি নোটিফিকেশন শো করবে
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={async () => {
                          if (typeof window !== 'undefined' && 'Notification' in window) {
                            soundManager.playClick();
                            const res = await Notification.requestPermission();
                            if (res === 'granted') {
                              soundManager.playNotificationChime();
                              new Notification('🔔 নোটিফিকেশন চালু হয়েছে!', {
                                body: 'এডমিন নোটিফিকেশন এখন থেকে আপনার ফোনে সরাসরি আসবে।',
                                icon: '/pwa-192x192.png',
                              });
                            }
                          }
                        }}
                        className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 cursor-pointer shrink-0"
                      >
                        <Bell className="w-3.5 h-3.5" />
                        <span>নোটিফিকেশন সক্রিয় করুন</span>
                      </button>
                    </div>

                    <div className="pt-2.5 border-t border-[#1e2a3c] flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-400">পরীক্ষা করুন:</span>
                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playNotificationChime();
                          window.dispatchEvent(
                            new CustomEvent('trigger_admin_test_notification', { detail: { type: 'deposit' } })
                          );
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>এডমানি নোটিফিকেশন টেস্ট</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playNotificationChime();
                          window.dispatchEvent(
                            new CustomEvent('trigger_admin_test_notification', { detail: { type: 'withdrawal' } })
                          );
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-950/80 hover:bg-amber-900 border border-amber-500/40 text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>ক্যাশআউট নোটিফিকেশন টেস্ট</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* ==================== WEB & GOOGLE DRIVE SHARING ==================== */}
                <div className="bg-[#0b1019] border border-cyan-500/30 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-xl">
                  <div className="flex items-center gap-2 pb-2 border-b border-[#1d293d]">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">অ্যাপ ওয়েবসাইট ও ড্রাইভ শেয়ারিং লিংক</h4>
                      <p className="text-[11px] text-slate-400">বন্ধুদের মাঝে সরাসরি ওয়েবসাইট লিংক শেয়ার অথবা সম্পূর্ণ ফাইল ডাউনলোড</p>
                    </div>
                  </div>

                  {/* Public Live Shared Link */}
                  <div className="bg-[#121926] border border-[#233148] rounded-xl p-3 space-y-2">
                    <span className="text-xs text-slate-300 font-medium block">
                      ১. বন্ধুদের সরাসরি খেলার লাইভ ওয়েবসাইট লিংক:
                    </span>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <div className="flex-1 bg-[#090d14] border border-[#1e2a3c] rounded-xl px-3 py-2 text-xs font-mono text-cyan-300 break-all select-all">
                        https://ais-pre-rcq6agpjqpcvfptktadv4m-196713937546.asia-southeast1.run.app
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText('https://ais-pre-rcq6agpjqpcvfptktadv4m-196713937546.asia-southeast1.run.app');
                            setCopiedShareLink(true);
                            setTimeout(() => setCopiedShareLink(false), 2000);
                          }}
                          className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
                        >
                          {copiedShareLink ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedShareLink ? 'কপি হয়েছে!' : 'লিংক কপি করুন'}</span>
                        </button>
                        <a
                          href="https://ais-pre-rcq6agpjqpcvfptktadv4m-196713937546.asia-southeast1.run.app"
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-2 rounded-xl bg-[#1a2538] hover:bg-[#253550] text-slate-300 hover:text-white transition-colors flex items-center justify-center"
                          title="ওপেন করুন"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      💡 এই লিংকটি আপনি WhatsApp, Facebook বা মেসেঞ্জারে বন্ধুদের দিলে তারা সাথে সাথে কোনো কিছু ডাউনলোড করা ছাড়াই ফোনে খেলতে পারবে।
                    </p>
                  </div>

                  {/* ZIP download for Google Drive / Hosting */}
                  <div className="bg-[#121926] border border-[#233148] rounded-xl p-3 space-y-2">
                    <span className="text-xs text-slate-300 font-medium block">
                      ২. গুগল ড্রাইভে রাখা বা নিজস্ব ওয়েবসাইটে আপলোড করার জন্য সম্পূর্ণ ফাইল (ZIP):
                    </span>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[#080d16] p-3 rounded-xl border border-[#1b263b]">
                      <div className="text-left">
                        <span className="text-xs font-bold text-white block font-mono">aviator-app-website.zip</span>
                        <span className="text-[10px] text-slate-400 block">সম্পূর্ণ ফ্রন্টএন্ড কোড, এইচটিএমএল, পিডব্লিউএ আইকন ও ফাইল</span>
                      </div>
                      <a
                        href="/aviator-app-website.zip"
                        download="aviator-app-website.zip"
                        className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-md shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>ডাউনলোড জিপ (ZIP)</span>
                      </a>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      💡 এই জিপ ফাইলটি ডাউনলোড করে আপনার গুগল ড্রাইভ (Google Drive)-এ আপলোড করে বন্ধুদের সাথে ড্রাইভ লিংক শেয়ার করতে পারেন, অথবা যেকোনো cPanel / Netlify / Vercel ওয়েবসাইটে আপলোড করতে পারেন।
                    </p>
                  </div>
                </div>

                {/* ==================== ADMIN STEALTH & SECURITY CONTROLS ==================== */}
                <div className="bg-[#0b1019] border border-amber-500/40 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#1d293d]">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">এডমিন সিকিউরিটি ও অনলাইন পাবলিশিং কন্ট্রোল</h4>
                        <p className="text-[11px] text-slate-400">সাধারণ প্লেয়ারদের থেকে এডমিন সেকশন গোপন রাখার ব্যবস্থাপনা</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowStealthGuideModal(true)}
                      className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer border border-amber-500/30"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>গোপন এক্সেস নির্দেশিকা</span>
                    </button>
                  </div>

                  {/* The Single Secret Access Method */}
                  <div className="bg-[#121926] border border-amber-500/30 rounded-2xl p-3.5 space-y-2">
                    <div className="flex items-center gap-2 text-white font-bold text-xs sm:text-sm">
                      <div className="w-5 h-5 rounded-full bg-red-600/30 text-red-400 flex items-center justify-center text-xs font-black border border-red-500/40">
                        ১
                      </div>
                      <span className="text-amber-300">পদ্ধতি ১: লোগোতে ৫ বার ট্যাপ (সবচেয়ে সহজ)</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-xs pl-7">
                      পাবলিক সাইটে কোনো এডমিন বাটন থাকবে না। শুধুমাত্র আপনি উপরে বামের <strong className="text-red-400 font-bold italic">"SkyWin BD"</strong> লোগোতে দ্রুত <strong className="text-white font-mono bg-white/10 px-1 py-0.5 rounded">৫ বার ট্যাপ</strong> করলেই এডমিন প্যানেল খুলে যাবে।
                    </p>
                  </div>

                  {/* Change Admin PIN */}
                  <div className="pt-3 border-t border-[#1d293d] space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300">
                        এডমিন লগইন পিন পরিবর্তন (Change Admin PIN):
                      </label>
                      <span className="text-[11px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md flex items-center gap-1.5 border border-amber-500/20">
                        <span className="text-slate-400">বর্তমান পিন:</span>
                        <strong className="tracking-widest text-white text-xs">
                          {getMaskedPin(settings.adminPin || '1234', revealStoredPin)}
                        </strong>
                        <button
                          type="button"
                          onClick={() => setRevealStoredPin(!revealStoredPin)}
                          className="text-slate-400 hover:text-amber-300 ml-1 transition-colors cursor-pointer"
                          title={revealStoredPin ? 'পিন লুকান' : 'পিন দেখুন'}
                        >
                          {revealStoredPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </span>
                    </div>

                    {!isOldPinConfirmed ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[200px]">
                          <input
                            type={showOldPinToggle ? 'text' : 'password'}
                            maxLength={10}
                            value={oldPinInput}
                            onChange={(e) => {
                              setOldPinInput(e.target.value);
                              setPinChangeError('');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleVerifyOldPin();
                            }}
                            placeholder="বর্তমান পিন লিখুন"
                            className="w-full bg-[#121926] border border-[#233148] rounded-xl px-3.5 py-2 pr-9 text-xs font-mono tracking-widest text-white focus:outline-hidden focus:border-amber-400"
                          />
                          <button
                            type="button"
                            onClick={() => setShowOldPinToggle(!showOldPinToggle)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                          >
                            {showOldPinToggle ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={handleVerifyOldPin}
                          className="px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-black text-xs rounded-xl shadow-md transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                          <span>কনফার্ম করুন</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/30 animate-fadeIn">
                        <div className="w-full text-xs text-emerald-300 font-semibold flex items-center gap-1.5 mb-1">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>বর্তমান পিন যাচাই সম্পন্ন! নতুন পিন লিখুন:</span>
                        </div>
                        <div className="relative flex-1 min-w-[200px]">
                          <input
                            type={showNewPinToggle ? 'text' : 'password'}
                            maxLength={10}
                            value={newPin}
                            onChange={(e) => {
                              setNewPin(e.target.value);
                              setPinChangeError('');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveNewPin();
                            }}
                            placeholder="নতুন পিন লিখুন (যেমন: 224700)"
                            autoFocus
                            className="w-full bg-[#121926] border border-emerald-500/50 rounded-xl px-3.5 py-2 pr-9 text-xs font-mono tracking-widest text-white focus:outline-hidden focus:border-emerald-400"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPinToggle(!showNewPinToggle)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                          >
                            {showNewPinToggle ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>

                        {newPin.length > 0 && (
                          <span className="text-xs font-mono text-cyan-300 tracking-widest bg-cyan-950/40 px-2 py-1.5 rounded border border-cyan-800/40">
                            {getMaskedPin(newPin)}
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={handleSaveNewPin}
                          className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white font-black text-xs rounded-xl shadow-md transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>নতুন পিন আপডেট করুন</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsOldPinConfirmed(false)}
                          className="px-3 py-2 bg-[#1b2538] hover:bg-[#25344c] text-slate-300 text-xs rounded-xl cursor-pointer"
                        >
                          বাতিল
                        </button>
                      </div>
                    )}

                    {pinChangeError && (
                      <p className="text-xs text-rose-400 font-medium animate-fadeIn">{pinChangeError}</p>
                    )}
                    {pinChangeMsg && (
                      <p className="text-xs text-emerald-400 font-semibold animate-fadeIn">{pinChangeMsg}</p>
                    )}
                  </div>
                </div>

                {/* ==================== TELEGRAM SUPPORT & CONTACT LINKS ==================== */}
                <div className="bg-[#0b1019] border border-sky-500/40 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
                  <div className="flex items-center justify-between pb-3 border-b border-[#1d293d]">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold">
                        <Send className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>টেলিগ্রাম চ্যানেল ও সাপোর্ট লিংক সেটিংস</span>
                          <span className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full border border-sky-500/30 font-semibold">
                            যোগাযোগ ও অভিযোগ
                          </span>
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          এখানে যে লিংক দিবেন তা সরাসরি প্লেয়ারদের থ্রি-লাইন (3 Lines) ড্রয়ার মেনুতে সেট হয়ে যাবে
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {/* Telegram Channel Link */}
                    <div className="bg-[#121926] border border-[#233148] rounded-xl p-3.5 space-y-2">
                      <label className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5 text-sky-400" />
                        <span>অফিসিয়াল টেলিগ্রাম চ্যানেল লিংক:</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={settings.telegramChannel || ''}
                          onChange={(e) => setSettings({ ...settings, telegramChannel: e.target.value })}
                          placeholder="যেমন: https://t.me/SkyWinBD_Channel বা @SkyWinBD_Channel"
                          className="flex-1 bg-[#0b1018] border border-[#233148] rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-hidden focus:border-sky-400"
                        />
                        {settings.telegramChannel && (
                          <a
                            href={settings.telegramChannel.startsWith('http') ? settings.telegramChannel : `https://t.me/${settings.telegramChannel.replace('@', '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-[11px] font-bold border border-sky-500/40 flex items-center gap-1 shrink-0 transition-colors"
                          >
                            <span>টেস্ট</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <p className="text-[10.5px] text-slate-400">
                        প্লেয়াররা ত্রি-লাইন মেনুর <strong>&quot;টেলিগ্রাম চ্যানেল&quot;</strong> অপশনে ক্লিক করলে সরাসরি এই চ্যানেলে যুক্ত হবে।
                      </p>
                    </div>

                    {/* Telegram Support ID Link */}
                    <div className="bg-[#121926] border border-[#233148] rounded-xl p-3.5 space-y-2">
                      <label className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                        <span>টেলিগ্রাম সাপোর্ট / অভিযোগ আইডি লিংক:</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={settings.telegramSupport || ''}
                          onChange={(e) => setSettings({ ...settings, telegramSupport: e.target.value })}
                          placeholder="যেমন: https://t.me/SkyWinBD_Support বা @SkyWinBD_Support"
                          className="flex-1 bg-[#0b1018] border border-[#233148] rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-hidden focus:border-emerald-400"
                        />
                        {settings.telegramSupport && (
                          <a
                            href={settings.telegramSupport.startsWith('http') ? settings.telegramSupport : `https://t.me/${settings.telegramSupport.replace('@', '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-bold border border-emerald-500/40 flex items-center gap-1 shrink-0 transition-colors"
                          >
                            <span>টেস্ট</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <p className="text-[10.5px] text-slate-400">
                        প্লেয়াররা ত্রি-লাইন মেনুর <strong>&quot;টেলিগ্রাম সাপোর্ট আইডি&quot;</strong> অপশনে ক্লিক করলে সরাসরি আপনার সাথে চ্যাটে অভিযোগ বা কথা বলতে পারবে।
                      </p>
                    </div>

                    {/* Setup Guide & Download Helper */}
                    <div className="md:col-span-2 p-3.5 rounded-xl bg-gradient-to-r from-sky-950/40 via-[#0d1726] to-[#0b1018] border border-sky-500/30 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f2e45] pb-2">
                        <span className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                          <span>💡 https://t.me/SkyWinBD_Channel লিংক কীভাবে বানাবেন ও চ্যানেল সাজাবেন?</span>
                        </span>
                        <div className="flex items-center gap-2">
                          {/* Download official logo for Telegram avatar */}
                          <a
                            href="/skywin-telegram-avatar.png"
                            download="SkyWinBD-Logo.png"
                            className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[11px] font-bold border border-amber-500/40 flex items-center gap-1.5 transition-colors cursor-pointer"
                            title="টেলিগ্রাম চ্যানেলে দেওয়ার জন্য অফিসিয়াল লোগো নামান"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>চ্যানেল লোগো নামান</span>
                          </a>

                          {/* Copy ready description */}
                          <button
                            type="button"
                            onClick={() => {
                              const desc = '🎮 SkyWin BD - বাংলাদেশের সেরা ও বিশ্বস্ত এভিয়েটর ক্র্যাশ গেম প্ল্যাটফর্ম 🚀\n⚡ বিকাশ, নগদ ও রকেটে ১-৩ মিনিটে দ্রুত ডিপোজিট ও উইথড্র!\n🔥 দৈনিক ফ্রি প্রেডিকশন, সিগন্যাল ও সেরা বোনাস অফার।\n💬 যেকোনো সাহায্য ও সহযোগিতায় সাপোর্ট আইডি: @SkyWinBD_Support';
                              navigator.clipboard.writeText(desc);
                              setCopiedTgDesc(true);
                              setTimeout(() => setCopiedTgDesc(false), 3000);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-[11px] font-bold border border-sky-500/40 flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            {copiedTgDesc ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedTgDesc ? 'কপি হয়েছে!' : 'ডেসক্রিপশন কপি করুন'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-300">
                        <div className="bg-[#0b1018] p-2.5 rounded-lg border border-[#1d2b40]">
                          <span className="font-bold text-sky-400 block mb-1">১. Private থেকে Public করুন:</span>
                          টেলিগ্রামের Edit স্ক্রিনে <strong>Channel Type (বর্তমানে Private)</strong>-এ ক্লিক করে <strong>Public</strong> অপশন সিলেক্ট করুন।
                        </div>
                        <div className="bg-[#0b1018] p-2.5 rounded-lg border border-[#1d2b40]">
                          <span className="font-bold text-amber-400 block mb-1">২. ইউজারনেম লিংক সেট করুন:</span>
                          পাবলিক লিংক বক্সে লিখুন: <strong className="text-white font-mono bg-white/10 px-1 rounded">SkyWinBD_Channel</strong>। এটি লিখলে আপনার লিংক হবে <span className="text-sky-300 font-mono">https://t.me/SkyWinBD_Channel</span>
                        </div>
                        <div className="bg-[#0b1018] p-2.5 rounded-lg border border-[#1d2b40]">
                          <span className="font-bold text-emerald-400 block mb-1">৩. লোগো ও ডেসক্রিপশন দিন:</span>
                          উপরের নীল ক্যামেরা আইকনে ক্লিক করে আমাদের লোগো দিন এবং Description ঘরে লেখা পেস্ট করে টিক/Save বাটনে চাপুন।
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section: Live Active Players Simulation (সক্রিয় প্লেয়ার কাউন্টার) */}
                <div className="bg-[#0b1018] border border-emerald-500/40 rounded-2xl p-4 shadow-lg shadow-emerald-500/5 space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-[#1f2838]">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40">
                        <Users className="w-4 h-4" />
                      </div>
                      <div>
                        <h5 className="font-bold text-sm text-emerald-300">লাইভ সক্রিয় প্লেয়ার কাউন্টার সেটিংস (Live Players)</h5>
                        <p className="text-[11px] text-slate-400">
                          গেমের নিচে দেখানো &ldquo;((•)) জন সক্রিয়&rdquo; প্লেয়ার কাউন্টার নিয়ন্ত্রণ করুন (১০০ এর নিচে নামবে না)
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-bold">
                      <RadioIcon className="w-3 h-3 text-emerald-400 animate-pulse" />
                      <span>{activePlayersSettings.min.toLocaleString()} - {activePlayersSettings.max.toLocaleString()} জন</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Minimum Active Players */}
                    <div className="bg-[#121926] border border-[#233148] rounded-xl p-3.5 space-y-1.5">
                      <label className="text-xs font-bold text-slate-200 block">
                        সর্বনিম্ন সক্রিয় প্লেয়ার (কমপক্ষে ১০০):
                      </label>
                      <input
                        type="number"
                        min="100"
                        value={activePlayersSettings.min}
                        onChange={(e) => {
                          const val = Math.max(100, parseInt(e.target.value) || 100);
                          setActivePlayersSettings({
                            ...activePlayersSettings,
                            min: val,
                            max: Math.max(val + 50, activePlayersSettings.max),
                          });
                        }}
                        className="w-full bg-[#0b1018] border border-[#233148] rounded-xl px-3 py-2 text-sm font-mono font-bold text-white focus:outline-hidden focus:border-emerald-400"
                      />
                      <p className="text-[10px] text-emerald-400/90 font-medium">
                        ✓ এটি কখনোই ১০০ এর নিচে যাবে না।
                      </p>
                    </div>

                    {/* Maximum Active Players */}
                    <div className="bg-[#121926] border border-[#233148] rounded-xl p-3.5 space-y-1.5">
                      <label className="text-xs font-bold text-slate-200 block">
                        স্বাভাবিক সর্বোচ্চ সক্রিয় প্লেয়ার:
                      </label>
                      <input
                        type="number"
                        min="200"
                        max="5000"
                        value={activePlayersSettings.max}
                        onChange={(e) => {
                          const val = Math.max(activePlayersSettings.min + 20, parseInt(e.target.value) || 1200);
                          setActivePlayersSettings({
                            ...activePlayersSettings,
                            max: val,
                          });
                        }}
                        className="w-full bg-[#0b1018] border border-[#233148] rounded-xl px-3 py-2 text-sm font-mono font-bold text-white focus:outline-hidden focus:border-emerald-400"
                      />
                      <p className="text-[10px] text-slate-400">
                        স্বাভাবিক খেলা চলাকালীন ১০০ থেকে এই সংখ্যা পর্যন্ত দেখাবে।
                      </p>
                    </div>
                  </div>

                  {/* Allow 1,000+ Surge Peak Rounds Toggle */}
                  <div className="bg-[#121926] border border-[#233148] rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                        <span>মাঝে মাঝে ১,০০০+ পিক রাশ দেখান (Rush Hours)</span>
                      </p>
                      <p className="text-[10.5px] text-slate-400 mt-0.5">
                        কিছুক্ষণ পর পর অথবা বড় রাউন্ডে সংখ্যা ১,০০০ থেকে ১,৪৫০+ পর্যন্ত বেড়ে যাবে।
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activePlayersSettings.allowSurgePast1000}
                        onChange={(e) =>
                          setActivePlayersSettings({
                            ...activePlayersSettings,
                            allowSurgePast1000: e.target.checked,
                          })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                </div>

                {/* Save Button */}
                <button
                  onClick={handleSaveSettings}
                  disabled={isSavingSettings}
                  className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-[#120e00] font-black text-sm uppercase tracking-wider rounded-2xl shadow-xl shadow-amber-500/20 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4 font-bold" />
                  <span>{isSavingSettings ? 'সংরক্ষণ হচ্ছে...' : 'পেমেন্ট নম্বর ও টেলিগ্রাম লিংক সংরক্ষণ করুন (Save Settings)'}</span>
                </button>
              </div>
            )}

            {/* ==================== TAB 3: USER MANAGEMENT & FULL HISTORY ==================== */}
            {activeTab === 'users' && (
              <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
                {/* Header & Search */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1f2838]">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-emerald-400" />
                      <span>সকল ব্যবহারকারী অ্যাকাউন্ট ও ইতিহাস পরিচালনা</span>
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      ইউজার আইডি অনুসন্ধান, সম্পূর্ণ হিস্ট্রি দেখা, আইডি রিসেট/আপডেট ও সরাসরি ব্যালেন্স অ্যাড
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">কুইক অ্যাড:</span>
                    <input
                      type="number"
                      value={manualAddAmount}
                      onChange={(e) => setManualAddAmount(Math.max(10, parseFloat(e.target.value) || 0))}
                      className="w-20 bg-[#0b1018] border border-[#24334c] rounded-lg px-2 py-1 text-xs text-center font-mono text-emerald-400 font-bold"
                    />
                  </div>
                </div>

                {/* Search Bar for Users */}
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    placeholder="ইউজার আইডি (যেমন: USER-18492), মোবাইল নম্বর বা নাম দিয়ে খুঁজুন..."
                    className="w-full bg-[#0b1018] border border-[#223149] focus:border-amber-400 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-hidden transition-colors"
                  />
                  {userSearchQuery && (
                    <button
                      onClick={() => setUserSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                    >
                      মুছুন
                    </button>
                  )}
                </div>

                {/* Users List */}
                {(() => {
                  const query = userSearchQuery.trim().toLowerCase();
                  const list = accountsWithStats.filter((acc) => {
                    if (!query) return true;
                    return (
                      acc.userCode.toLowerCase().includes(query) ||
                      acc.phoneNumber.includes(query) ||
                      acc.displayName.toLowerCase().includes(query) ||
                      acc.referralCode.toLowerCase().includes(query)
                    );
                  });

                  if (list.length === 0) {
                    return (
                      <div className="p-8 text-center text-slate-500 bg-[#0b1018] rounded-2xl border border-[#1b2537]">
                        <UserIcon className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                        <p className="text-xs font-medium">কোনো ইউজার অ্যাকাউন্ট পাওয়া যায়নি।</p>
                        {userSearchQuery && (
                          <p className="text-[11px] text-slate-400 mt-1">
                            "{userSearchQuery}" দিয়ে কোনো ফলাফল পাওয়া যায়নি।
                          </p>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {list.map((acc) => {
                        const copyUserCredentials = () => {
                          const text = `🎮 SkyWin BD গেম একাউন্ট তথ্য\n━━━━━━━━━━━━━━━━━\nইউজার আইডি: ${acc.userCode}\nমোবাইল নম্বর: +88 ${acc.phoneNumber}\nপাসওয়ার্ড: ${acc.password || 'গোপনীয়'}\nবর্তমান ব্যালেন্স: ৳ ${acc.balance.toFixed(2)}\nউত্তোলনযোগ্য লাভ: ৳ ${acc.withdrawableBalance.toFixed(2)}\nরেফারেল কোড: ${acc.referralCode}\n━━━━━━━━━━━━━━━━━`;
                          navigator.clipboard.writeText(text);
                          setCopiedCredentialId(acc.userCode);
                          soundManager.playClick();
                          showAdminToast('ইউজার লগইন তথ্য কপি হয়েছে!', `${acc.userCode} (+88 ${acc.phoneNumber}) এর আইডি ও পাসওয়ার্ড ক্লিপবোর্ডে কপি করা হয়েছে।`, 'info');
                          setTimeout(() => setCopiedCredentialId(null), 2500);
                        };

                        const handleOpenEdit = () => {
                          const accounts = getStoredPhoneAccounts();
                          const found = accounts[acc.phoneNumber];
                          if (found) {
                            setEditingAccount(found);
                          } else {
                            setEditingAccount({
                              uid: acc.uid,
                              userCode: acc.userCode,
                              phoneNumber: acc.phoneNumber,
                              password: acc.password || '123456',
                              displayName: acc.displayName,
                              balance: acc.balance,
                              initialBonus: 100,
                              lockedPrincipal: acc.lockedPrincipal,
                              totalDeposited: acc.totalDeposited,
                              hasDeposited: acc.hasDeposited,
                              referralCode: acc.referralCode,
                              referralCount: acc.referralCount,
                              referralBonusEarned: acc.referralBonusEarned,
                              status: acc.status || 'active',
                              suspendedUntil: acc.suspendedUntil,
                              deactivationReason: acc.deactivationReason,
                              createdAt: acc.createdAt,
                              updatedAt: acc.updatedAt,
                            });
                          }
                        };

                        const isSuspended = acc.status === 'suspended' && acc.suspendedUntil && new Date(acc.suspendedUntil).getTime() > Date.now();
                        const isBanned = acc.status === 'banned';

                        return (
                          <div
                            key={acc.uid}
                            className={`border rounded-2xl p-4 flex flex-col justify-between gap-3 transition-colors shadow-lg ${
                              isBanned
                                ? 'bg-[#180a0d] border-rose-600/50 hover:border-rose-500'
                                : isSuspended
                                ? 'bg-[#18120a] border-amber-500/40 hover:border-amber-400'
                                : 'bg-[#0b1018] border-[#1e2a3e] hover:border-[#2f4262]'
                            }`}
                          >
                            {/* User Header */}
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-bold text-sm text-white">{acc.displayName}</span>
                                  <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-mono text-[11px] font-bold border border-amber-500/30">
                                    {acc.userCode}
                                  </span>

                                  {/* Status Badge */}
                                  {isBanned ? (
                                    <span className="px-1.5 py-0.5 rounded-md bg-rose-500/20 text-rose-300 text-[10px] font-bold border border-rose-500/40">
                                      🚫 ব্যান
                                    </span>
                                  ) : isSuspended ? (
                                    <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/40">
                                      ⏳ স্থগিত
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/40">
                                      ✓ সক্রিয়
                                    </span>
                                  )}

                                  {/* Deposit Badge */}
                                  {acc.hasDeposited || (acc.totalDeposited && acc.totalDeposited > 0) ? (
                                    <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-[10px] font-mono font-bold border border-emerald-500/30">
                                      ডিপোজিট: ৳{acc.totalDeposited.toLocaleString()}
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded-md bg-rose-500/15 text-rose-400 text-[10px] font-bold border border-rose-500/30">
                                      ডিপোজিট নেই (উইথড্র ব্লক)
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs font-mono text-slate-300 block mt-0.5">
                                  📱 +88 {acc.phoneNumber}
                                </span>
                                <span className="text-[10px] text-slate-400 block mt-0.5">
                                  রেজিস্ট্রেশন: {new Date(acc.createdAt).toLocaleDateString('bn-BD')}
                                </span>
                                {isSuspended && acc.suspendedUntil && (
                                  <span className="text-[10px] text-amber-400 block mt-0.5 font-mono">
                                    স্থগিত মেয়াদ: {new Date(acc.suspendedUntil).toLocaleString('bn-BD', { dateStyle: 'short', timeStyle: 'short' })}
                                  </span>
                                )}
                              </div>

                              <div className="text-right">
                                <span className="text-[10px] text-slate-400 block font-medium">মোট ব্যালেন্স</span>
                                <span className="text-base font-black font-mono-numbers text-cyan-300">
                                  ৳ {acc.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            </div>

                            {/* Financial Breakdown & Referral Metrics */}
                            <div className="grid grid-cols-3 gap-1.5 text-center bg-[#070b12] p-2 rounded-xl border border-white/5 text-[10.5px]">
                              <div>
                                <span className="text-slate-400 block text-[9.5px]">প্লে ব্যালেন্স (লক):</span>
                                <span className="font-bold text-amber-400 font-mono">
                                  ৳ {acc.lockedPrincipal.toLocaleString()}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400 block text-[9.5px]">উত্তোলনযোগ্য:</span>
                                <span className="font-bold text-emerald-400 font-mono">
                                  ৳ {acc.withdrawableBalance.toLocaleString()}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400 block text-[9.5px]">রেফারেল ({acc.referralCount} জন):</span>
                                <span className="font-bold text-purple-400 font-mono">
                                  +৳{acc.referralBonusEarned}
                                </span>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="space-y-2 pt-2 border-t border-[#182234]">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedHistoryUserId(acc.userCode)}
                                  className="flex-1 py-1.5 px-2 bg-[#162338] hover:bg-[#20314d] text-cyan-300 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                                  title="এই ইউজারের সম্পূর্ণ ডিপোজিট, উইথড্র ও বেট হিস্ট্রি দেখুন"
                                >
                                  <History className="w-3.5 h-3.5" />
                                  <span>সম্পূর্ণ হিস্ট্রি</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={handleOpenEdit}
                                  className="flex-1 py-1.5 px-2 bg-[#231e14] hover:bg-[#332b1d] border border-amber-600/30 text-amber-300 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                                  title="আইডি বা পাসওয়ার্ড ভুলে গেলে রিসেট ও পরিবর্তন করুন"
                                >
                                  <KeyRound className="w-3.5 h-3.5" />
                                  <span>আইডি রিসেট/এডিট</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={copyUserCredentials}
                                  className={`py-1.5 px-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                    copiedCredentialId === acc.userCode
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-[#141b28] hover:bg-[#1d273a] text-slate-300 hover:text-white border border-[#223048]'
                                  }`}
                                  title="ইউজারের জন্য আইডি ও পাসওয়ার্ড কপি করুন"
                                >
                                  {copiedCredentialId === acc.userCode ? (
                                    <>
                                      <Check className="w-3.5 h-3.5" />
                                      <span className="hidden sm:inline">কপি হয়েছে</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      <span className="hidden sm:inline">তথ্য কপি</span>
                                    </>
                                  )}
                                </button>
                              </div>

                              {/* Quick Balance Operations */}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleDirectCreditPhoneAccount(acc.phoneNumber, manualAddAmount)}
                                  className="flex-1 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
                                >
                                  <ArrowUpRight className="w-3.5 h-3.5" />
                                  <span>+৳{manualAddAmount} ব্যালেন্স যোগ</span>
                                </button>

                                <button
                                  onClick={() => handleDirectResetPhoneAccount(acc.phoneNumber)}
                                  className="px-2.5 py-1.5 bg-[#172030] hover:bg-[#202d44] text-slate-400 hover:text-rose-400 rounded-xl text-xs font-medium transition-colors cursor-pointer"
                                  title="ব্যালেন্স ০ করুন"
                                >
                                  ০ করুন
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ==================== TAB 4: HEADER SCROLLING TITLE & NOTICES (শিরোনাম ও নোটিশ এডিট) ==================== */}
            {activeTab === 'marquee' && (
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
                  <Megaphone className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-300">
                    <p className="font-bold text-amber-300 text-sm">হেডার স্ক্রোলিং শিরোনাম ও সার্বজনীন নোটিশ আপডেট</p>
                    <p className="mt-0.5 text-slate-400">
                      এখানে যে শিরোনাম বা নোটিশ লিখে সংরক্ষণ করবেন, তা সাথে সাথে ফায়ারবেস ক্লাউডের মাধ্যমে সকল ইউজারের ফোনে লাইভ আপডেট হয়ে যাবে।
                    </p>
                  </div>
                </div>

                {saveSuccessMsg && (
                  <div className="p-3.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-fadeIn">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <span>{saveSuccessMsg}</span>
                  </div>
                )}

                {/* 1. Live Preview of Marquee */}
                <div className="bg-[#0b1018] border border-amber-500/40 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                      <span>লাইভ স্ক্রোলিং প্রিভিউ (ইউজাররা ঠিক যেভাবে দেখবে):</span>
                    </span>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 font-mono">
                      LIVE
                    </span>
                  </div>

                  <div className="w-full bg-gradient-to-r from-[#171208] via-[#1a140b] to-[#171208] border border-amber-500/30 rounded-xl px-2.5 py-2 overflow-hidden flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-gradient-to-r from-red-600 to-amber-600 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 shadow-sm">
                      <Megaphone className="w-3 h-3 text-yellow-200" />
                      <span>শিরোনাম</span>
                    </div>
                    <div className="flex-1 overflow-hidden whitespace-nowrap text-xs font-semibold text-amber-200">
                      <span className="inline-block animate-pulse">{marqueeNotice}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Headline Editor */}
                <div className="bg-[#0b1018] border border-[#223048] rounded-2xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Edit3 className="w-4 h-4 text-amber-400" />
                      <span>হেডার স্ক্রোলিং শিরোনাম লিখুন:</span>
                    </label>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {marqueeNotice.length} অক্ষর
                    </span>
                  </div>

                  <textarea
                    rows={3}
                    value={marqueeNotice}
                    onChange={(e) => setMarqueeNotice(e.target.value)}
                    placeholder="এখানে যা লিখবেন তা অ্যাপের উপরে চলমান শিরোনাম হিসেবে স্ক্রল হবে..."
                    className="w-full bg-[#121926] border border-[#24334c] focus:border-amber-400 rounded-xl p-3 text-xs text-amber-100 font-medium focus:outline-hidden transition-colors"
                  />

                    {/* Preset Template Chips */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[11px] font-semibold text-slate-400">তাত্ক্ষণিক টেমপ্লেট নির্বাচন করুন:</span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setMarqueeNotice('🎉 স্বাগতম SkyWin BD অফিসিয়াল গেমে! 🚀 বিকাশ, নগদ ও রকেটে ১-৩ মিনিটে ইনস্ট্যান্ট ডিপোজিট ও উইথড্র! 🔥 প্রথম ডিপোজিটে ১০০% ওয়েলকাম বোনাস! এখনই খেলুন ও বড় জয় লুফে নিন! 💰');
                            soundManager.playClick();
                            showAdminToast('টেমপ্লেট লোড হয়েছে!', '১০০% ওয়েলকাম বোনাস শিরোনাম লোড হয়েছে। লাইভ করতে নিচের সংরক্ষণ বাটনে চাপুন।', 'info');
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-[#141d2c] hover:bg-[#1e2a3f] border border-amber-500/40 text-[11px] text-amber-300 cursor-pointer transition-colors font-medium"
                        >
                          🚀 ১. স্বাগতম ও ১০০% বোনাস অফার
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMarqueeNotice('⚡ SkyWin BD - বাংলাদেশের ১ নম্বর বিশ্বস্ত এভিয়েটর ক্র্যাশ গেম! 🎮 অটো ক্যাশ-আউট সুবিধা, ২৪/৭ লাইভ কাস্টমার সাপোর্ট এবং ১০০% নিরাপদ লেনদেন। প্রতিদিন জিতুন আকর্ষণীয় প্রাইজ! 🏆');
                            soundManager.playClick();
                            showAdminToast('টেমপ্লেট লোড হয়েছে!', 'বিশ্বাসযোগ্যতা ও দ্রুত সার্ভিস শিরোনাম লোড হয়েছে। লাইভ করতে সংরক্ষণ বাটনে চাপুন।', 'info');
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-[#141d2c] hover:bg-[#1e2a3f] border border-cyan-500/40 text-[11px] text-cyan-300 cursor-pointer transition-colors font-medium"
                        >
                          🏆 ২. বিশ্বস্ত ও দ্রুত সার্ভিস
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMarqueeNotice('📢 প্রতিদিনের ফ্রি এভিয়েটর প্রেডিকশন, সিগন্যাল ও ধামাকা অফার পেতে আমাদের অফিসিয়াল টেলিগ্রাম চ্যানেলে যুক্ত থাকুন! ত্রি-লাইন মেনু থেকে টেলিগ্রাম জয়েন করুন! ✈️✨');
                            soundManager.playClick();
                            showAdminToast('টেমপ্লেট লোড হয়েছে!', 'টেলিগ্রাম জয়েন শিরোনাম লোড হয়েছে। লাইভ করতে সংরক্ষণ বাটনে চাপুন।', 'info');
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-[#141d2c] hover:bg-[#1e2a3f] border border-sky-500/40 text-[11px] text-sky-300 cursor-pointer transition-colors font-medium"
                        >
                          📱 ৩. টেলিগ্রাম চ্যানেল জয়েন
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMarqueeNotice('🛡️ সতর্কতা: শুধুমাত্র অ্যাপের ডিপোজিট অপশনে থাকা বিকাশ, নগদ ও রকেট নম্বরে টাকা পাঠান। TrxID সাবমিট করার ১-৩ মিনিটের মধ্যে ব্যালেন্স যোগ হবে। ২৪ ঘণ্টা সার্ভিস চালু! 🎮');
                            soundManager.playClick();
                            showAdminToast('টেমপ্লেট লোড হয়েছে!', 'নিরাপদ লেনদেন নোটিশ লোড হয়েছে। লাইভ করতে সংরক্ষণ বাটনে চাপুন।', 'info');
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-[#141d2c] hover:bg-[#1e2a3f] border border-rose-500/40 text-[11px] text-rose-300 cursor-pointer transition-colors font-medium"
                        >
                          🛡️ ৪. নিরাপদ পেমেন্ট সতর্কতা
                        </button>
                      </div>
                    </div>
                </div>

                {/* 3. Universal Deposit Modal Notice */}
                <div className="bg-[#0b1018] border border-[#223048] rounded-2xl p-4 sm:p-5 space-y-2">
                  <label className="text-xs font-bold text-white block">
                    সার্বজনীন ডিপোজিট নোটিশ (ইউজার যখন ডিপোজিট মডাল খুলবে তখন দেখতে পাবে):
                  </label>
                  <textarea
                    rows={2}
                    value={settings.noticeText}
                    onChange={(e) => setSettings({ ...settings, noticeText: e.target.value })}
                    placeholder="ডিপোজিট নোটিশ লিখুন..."
                    className="w-full bg-[#121926] border border-[#24334c] focus:border-emerald-400 rounded-xl p-3 text-xs text-white focus:outline-hidden"
                  />
                </div>

                {/* 4. Universal Withdrawal Modal Notice */}
                <div className="bg-[#0b1018] border border-[#223048] rounded-2xl p-4 sm:p-5 space-y-2">
                  <label className="text-xs font-bold text-white block">
                    সার্বজনীন উত্তোলন নোটিশ (ইউজার যখন ক্যাশআউট মডাল খুলবে তখন দেখতে পাবে):
                  </label>
                  <textarea
                    rows={2}
                    value={settings.withdrawalNoticeText || 'উত্তোলন দেওয়ার পর এডমিন ভেরিফাই করে ৫-১৫ মিনিটের মধ্যে টাকা পাঠিয়ে দিবে। শুধুমাত্র পার্সোনাল বিকাশ/নগদ/রকেট নম্বর ব্যবহার করুন।'}
                    onChange={(e) => setSettings({ ...settings, withdrawalNoticeText: e.target.value })}
                    placeholder="উত্তোলন নোটিশ লিখুন..."
                    className="w-full bg-[#121926] border border-[#24334c] focus:border-rose-400 rounded-xl p-3 text-xs text-white focus:outline-hidden"
                  />
                </div>

                {/* 5. Ready-to-Post Telegram Promotional Posts (ইউজারদের উদ্দেশ্যে পোস্ট টেমপ্লেট) */}
                <div className="bg-[#0b1018] border border-sky-500/40 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-xl">
                  <div className="flex items-center justify-between pb-2 border-b border-[#1c293d]">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-500/30">
                        <Send className="w-4 h-4" />
                      </div>
                      <div>
                        <h5 className="font-bold text-sm text-sky-300">টেলিগ্রাম চ্যানেলে পোস্ট করার প্রস্তুত কনটেন্ট</h5>
                        <p className="text-[11px] text-slate-400">
                          এক ক্লিকে কপি করে আপনার টেলিগ্রাম চ্যানেল বা গ্রুপে সুন্দর করে পোস্ট করুন
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* Post 1: Welcome & Mega Offer */}
                    <div className="bg-[#121926] border border-[#233148] rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-amber-300 flex items-center gap-1.5">
                          <span>🎉 পোস্ট ১: অফিসিয়াল লঞ্চ ও ১০০% ওয়েলকাম বোনাস পোস্ট</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const post = `🚀 বাংলাদেশে সেরা ও ১০০% বিশ্বস্ত এভিয়েটর ক্র্যাশ গেম - SkyWin BD অফিসিয়াল! ✈️💰\n\n🎉 নতুন সকল ইউজারদের জন্য চলছে ধামাকা অফার! প্রথম ডিপোজিট করলেই পাচ্ছেন ১০০% ওয়েলকাম বোনাস!\n\n🌟 SkyWin BD-তে আপনি যা যা পাচ্ছেন:\n✅ বিকাশ, নগদ ও রকেটে ১-৩ মিনিটে অটো ডিপোজিট ও উইথড্র\n✅ সর্বনিম্ন ৫০ টাকা বাজি ধরার সুযোগ\n✅ অটো ক্যাশ-আউট সুবিধা (১.৫০x - ৫০.০০x গুণ পর্যন্ত লাভ)\n✅ সম্পূর্ণ নিরাপদ ও বিশ্বস্ত ২৪/৭ কাস্টমার সার্ভিস\n\n🎮 এখনই গেম খেলুন:\n👉 https://ais-pre-rcq6agpjqpcvfptktadv4m-196713937546.asia-southeast1.run.app\n\n💬 যেকোনো সাহায্য ও লেনদেন সংক্রান্ত প্রয়োজনে সরাসরি এডমিন সাপোর্ট:\n👉 @SkyWinBD_Support\n\n🏆 সেরা জয় হোক SkyWin BD এর সাথে! শুভ গেমিং! 👑`;
                            navigator.clipboard.writeText(post);
                            showAdminToast('পোস্ট ১ কপি হয়েছে!', 'টেলিগ্রাম চ্যানেলে গিয়ে সরাসরি পেস্ট করুন।', 'success');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-bold border border-amber-500/40 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>কপি করুন</span>
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed font-mono bg-[#0b1018] p-2 rounded-lg border border-[#1d2b40]">
                        &quot;🚀 বাংলাদেশে সেরা ও ১০০% বিশ্বস্ত এভিয়েটর ক্র্যাশ গেম - SkyWin BD অফিসিয়াল! ✈️💰...&quot;
                      </p>
                    </div>

                    {/* Post 2: Deposit & Withdrawal Guide */}
                    <div className="bg-[#121926] border border-[#233148] rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-emerald-300 flex items-center gap-1.5">
                          <span>⚡ পোস্ট ২: বিকাশ ও নগদে ডিপোজিট ও উইথড্র করার সহজ নিয়ম</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const post = `📌 SkyWin BD-তে কিভাবে ১ মিনিটে টাকা জমা (ডিপোজিট) ও উত্তোলন (উইথড্র) করবেন? 💳⚡\n\n১️⃣ টাকা জমা করার নিয়ম:\n🔹 অ্যাপের নিচে "টাকা লোড" বা "জমা" বাটনে ক্লিক করুন।\n🔹 বিকাশ বা নগদ সিলেক্ট করে এডমিন নম্বরে Send Money করুন।\n🔹 TrxID ও আপনার মোবাইল নম্বর বসিয়ে সাবমিট করুন। ১-৩ মিনিটে ব্যালেন্স যোগ হবে!\n\n২️⃣ টাকা তোলার নিয়ম (উইথড্র):\n🔹 নিচে "উইথড্র" অপশনে চাপুন।\n🔹 আপনার বিকাশ/নগদ পার্সোনাল নম্বর ও টাকার পরিমাণ লিখে সাবমিট দিন।\n🔹 ৫-১৫ মিনিটের মধ্যে টাকা সরাসরি আপনার একাউন্টে চলে যাবে!\n\n⚠️ সতর্কতা: শুধুমাত্র অ্যাপের ভেতরে দেওয়া অফিসিয়াল নম্বরেই টাকা পাঠাবেন।\n\n💬 সাহায্য লাগলে মেসেজ দিন:\n👉 @SkyWinBD_Support`;
                            navigator.clipboard.writeText(post);
                            showAdminToast('পোস্ট ২ কপি হয়েছে!', 'টেলিগ্রাম চ্যানেলে গিয়ে সরাসরি পেস্ট করুন।', 'success');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold border border-emerald-500/40 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>কপি করুন</span>
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed font-mono bg-[#0b1018] p-2 rounded-lg border border-[#1d2b40]">
                        &quot;📌 SkyWin BD-তে কিভাবে ১ মিনিটে টাকা জমা ও উত্তোলন করবেন? 💳⚡...&quot;
                      </p>
                    </div>

                    {/* Post 3: Daily Winning Signal & Auto Cashout Tips */}
                    <div className="bg-[#121926] border border-[#233148] rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-cyan-300 flex items-center gap-1.5">
                          <span>🎯 পোস্ট ৩: এভিয়েটরে প্রতিদিন জেতার নিরাপদ ট্রিকস ও অটো ক্যাশআউট</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const post = `✈️ এভিয়েটর গেম খেলে প্রতিদিন নিশ্চিত লাভ করার ৩টি সেরা ট্রিকস! 📈🔥\n\n💡 ট্রিকস ১: অটো ক্যাশ-আউট ব্যবহার করুন\nবাজি ধরার পর অটো ক্যাশ-আউট (Auto Cash Out) ১.৫০x বা ২.০০x-এ সেট করে রাখুন। প্লেন ওড়ার সাথে সাথে স্বয়ংক্রিয়ভাবে প্রফিট বুক হয়ে যাবে!\n\n💡 ট্রিকস ২: দুই প্যানেল স্ট্র্যাটেজি\nপ্যানেল ১-এ ১.৫০x সেফ মাল্টিপ্লায়ার রাখুন (যা মূল টাকা তুলে আনবে), এবং প্যানেল ২-এ ছোট বাজি রেখে ৫x থেকে ২০x বড় লাভের চেষ্টা করুন!\n\n💡 ট্রিকস ৩: লোভ না করে নিয়ম মেনে খেলুন\nপ্রতিদিন নির্দিষ্ট টার্গেট নিয়ে খেলুন। লাভ হলে সাথে সাথে উইথড্র করে নিন!\n\n🚀 এখনই কৌশল কাজে লাগান:\n👉 https://ais-pre-rcq6agpjqpcvfptktadv4m-196713937546.asia-southeast1.run.app\n\n👑 SkyWin BD - জয় আপনার হাতের মুঠোয়! 💰`;
                            navigator.clipboard.writeText(post);
                            showAdminToast('পোস্ট ৩ কপি হয়েছে!', 'টেলিগ্রাম চ্যানেলে গিয়ে সরাসরি পেস্ট করুন।', 'success');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-bold border border-cyan-500/40 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>কপি করুন</span>
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed font-mono bg-[#0b1018] p-2 rounded-lg border border-[#1d2b40]">
                        &quot;✈️ এভিয়েটর গেম খেলে প্রতিদিন নিশ্চিত লাভ করার ৩টি সেরা ট্রিকস! 📈🔥...&quot;
                      </p>
                    </div>
                  </div>
                </div>

                {/* Save Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 hover:from-amber-500 hover:to-orange-500 text-white font-black text-sm shadow-xl shadow-amber-950/40 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.99] disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSavingSettings ? 'সংরক্ষণ ও ক্লাউড সিঙ্ক হচ্ছে...' : 'শিরোনাম ও নোটিশ সংরক্ষণ করুন (Save & Sync to Cloud)'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* ==================== TAB 6: ইউজারকে নটিফিকেশন পাঠান (BROADCAST NOTIFICATION) ==================== */}
            {activeTab === 'notifications' && (
              <div className="flex-1 flex flex-col min-h-0 p-3 sm:p-5 overflow-y-auto space-y-4">
                {/* Header banner */}
                <div className="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-rose-500/15 border border-amber-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0 shadow">
                      <Bell className="w-5 h-5 animate-bounce" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm sm:text-base text-white flex items-center gap-2">
                        <span>ইউজারকে নটিফিকেশন পাঠান</span>
                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          লাইভ ব্রডকাস্ট
                        </span>
                      </h3>
                      <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                        এখানে আপনি যে বার্তা, আপডেট বা অফার লিখবেন, তা তাৎক্ষণিকভাবে সকল ইউজারের স্ক্রিনে নোটিফিকেশন ও সাউন্ড চাইম সহ পৌঁছে যাবে।
                      </p>
                    </div>
                  </div>

                  {/* Sound preview button */}
                  <button
                    type="button"
                    onClick={() => soundManager.playNotificationChime()}
                    className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-[#151e2e] hover:bg-[#1e2a3e] border border-amber-500/30 text-amber-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shrink-0 shadow-sm"
                    title="ইউজাররা যে সাউন্ড চেইম শুনতে পাবে তা পরীক্ষা করুন"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>সাউন্ড টেস্ট (Chime)</span>
                  </button>
                </div>

                {/* Daily Auto Reminder Status Banner */}
                {(() => {
                  const reminderStatus = getDailyReminderStatus();
                  return (
                    <div className="bg-[#101726] border border-indigo-500/30 rounded-2xl p-3.5 flex items-start gap-3 text-xs">
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 flex items-center justify-center shrink-0">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-indigo-300">⏰ দৈনিক অটো-রিমাইন্ডার সিস্টেম সক্রিয় (Daily Auto Reminder)</span>
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30 font-bold">
                            Active
                          </span>
                        </div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          প্রতিদিন ইউজার যে টাইমে অ্যাপ অপেন করেন, পরের দিন ঠিক সেই টাইমে তাদের ডিভাইসে স্বয়ংক্রিয়ভাবে নটিফিকেশন যাবে—যাতে তারা সময়মতো ৫০৳ দৈনিক বোনাস ও লাকি স্পিন ক্লেইম করতে পারে।
                          {reminderStatus?.formattedTime && (
                            <span className="block text-amber-300 mt-1 font-mono">
                              সর্বশেষ অ্যাপ ওপেন টাইম: {reminderStatus.formattedTime} (পরবর্তী রিমাইন্ডার শিডিউল প্রস্তুত)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* Quick Presets */}
                <div className="bg-[#111723] border border-[#202d44] rounded-2xl p-3.5 space-y-2.5">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>দ্রুত বার্তা টেমপ্লেট (১ ক্লিকে লিখুন):</span>
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleSelectNotifPreset(
                          '🎁 আজকের ৫০৳ ডেইলি বোনাস ও স্পিন নিন!',
                          'আপনার আজকের ডেইলি বোনাস এবং লাকি স্পিন প্রস্তুত! এখনই অ্যাপে ঢুকে ক্লেইম করুন এবং ফ্রিতে জিতে নিন ৫০৳ পর্যন্ত ব্যালেন্স!',
                          'bonus'
                        )
                      }
                      className="text-left p-2.5 rounded-xl bg-[#162030] hover:bg-[#1e2c44] border border-[#253650] hover:border-amber-500/50 transition-all cursor-pointer group"
                    >
                      <div className="font-bold text-xs text-amber-300 group-hover:text-amber-200">
                        🎁 ৫০৳ ডেইলি বোনাস রিমাইন্ডার
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">আজকের ডেইলি বোনাস ও লাকি স্পিন ক্লেইম করুন...</div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleSelectNotifPreset(
                          '🚀 নতুন সিস্টেম আপডেট চালু হয়েছে!',
                          'SkyWin BD অ্যাপে নতুন ফিচার ও দ্রুত গেম পারফরম্যান্স আপডেট এসেছে। কোনো প্রকার ল্যাগ ছাড়াই স্মুথ গেমপ্লে উপভোগ করুন!',
                          'update'
                        )
                      }
                      className="text-left p-2.5 rounded-xl bg-[#162030] hover:bg-[#1e2c44] border border-[#253650] hover:border-cyan-500/50 transition-all cursor-pointer group"
                    >
                      <div className="font-bold text-xs text-cyan-300 group-hover:text-cyan-200">
                        🚀 নতুন অ্যাপ আপডেট বার্তা
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">নতুন ফিচার ও দ্রুত গেম পারফরম্যান্স আপডেট...</div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleSelectNotifPreset(
                          '⚡ বিকাশ, নগদ ও রকেট সেবা সুপার ফাস্ট!',
                          'সকল ডিপোজিট ও উইথড্র রিকোয়েস্ট এখন মাত্র ১-৫ মিনিটে সম্পন্ন হচ্ছে! নিশ্চিন্তে খেলুন এবং জয় নিশ্চিত করুন!',
                          'success'
                        )
                      }
                      className="text-left p-2.5 rounded-xl bg-[#162030] hover:bg-[#1e2c44] border border-[#253650] hover:border-emerald-500/50 transition-all cursor-pointer group"
                    >
                      <div className="font-bold text-xs text-emerald-300 group-hover:text-emerald-200">
                        ⚡ পেমেন্ট সেবা দ্রুত গতি নোটিশ
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">ডিপোজিট ও ক্যাশআউট ১-৫ মিনিটে সম্পন্ন...</div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleSelectNotifPreset(
                          '⚠️ সাময়িক মেইনটেন্যান্স অ্যালার্ট',
                          'প্রিয় ইউজার, আমাদের সার্ভারে রুটিন আপডেট চলছে। সাময়িক যেকোনো অসুবিধার জন্য আন্তরিকভাবে দুঃখিত। কিছুক্ষণ পর পুনরায় চেষ্টা করুন।',
                          'alert'
                        )
                      }
                      className="text-left p-2.5 rounded-xl bg-[#162030] hover:bg-[#1e2c44] border border-[#253650] hover:border-rose-500/50 transition-all cursor-pointer group"
                    >
                      <div className="font-bold text-xs text-rose-300 group-hover:text-rose-200">
                        ⚠️ সাময়িক সার্ভার মেইনটেন্যান্স
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">রুটিন আপডেটের তথ্য ও সতর্কতা বার্তা...</div>
                    </button>
                  </div>
                </div>

                {/* Compose Form */}
                <form onSubmit={handleSendBroadcast} className="bg-[#111723] border border-[#202d44] rounded-2xl p-4 space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-[#1c273a]">
                    <span className="font-bold text-sm text-white flex items-center gap-2">
                      <Send className="w-4 h-4 text-amber-400" />
                      <span>নতুন নটিফিকেশন তৈরি করুন</span>
                    </span>
                    <span className="text-[11px] text-slate-400">সকল ইউজারের কাছে যাবে</span>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      নটিফিকেশন শিরোনাম (Title) <span className="text-rose-400">*</span>:
                    </label>
                    <input
                      type="text"
                      value={notifTitle}
                      onChange={(e) => setNotifTitle(e.target.value)}
                      placeholder="যেমন: নতুন আপডেট / স্পেশাল বোনাস ঘোষণা"
                      className="w-full bg-[#0a0f18] border border-[#24334c] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-hidden focus:border-amber-400 transition-colors"
                      required
                    />
                  </div>

                  {/* Message */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-300">
                        বিস্তারিত বার্তা (Message) <span className="text-rose-400">*</span>:
                      </label>
                      <span className="text-[11px] text-slate-500">{notifMessage.length} অক্ষর</span>
                    </div>
                    <textarea
                      rows={3}
                      value={notifMessage}
                      onChange={(e) => setNotifMessage(e.target.value)}
                      placeholder="ইউজারদের উদ্দেশ্যে আপনার বার্তা লিখুন যা পপআপ নোটিফিকেশন হিসেবে স্ক্রিনে ভেসে উঠবে..."
                      className="w-full bg-[#0a0f18] border border-[#24334c] rounded-xl p-3 text-xs text-white focus:outline-hidden focus:border-amber-400 transition-colors leading-relaxed"
                      required
                    />

                    {/* Quick Emojis */}
                    <div className="flex items-center gap-1.5 mt-2 overflow-x-auto py-1">
                      <span className="text-[10px] text-slate-500 shrink-0">ইমোজি:</span>
                      {['🎁', '🚀', '💰', '🔔', '⚠️', '৳', '🔥', '✨', '✈️', '🎯', '💎', '🎉'].map((emo) => (
                        <button
                          key={emo}
                          type="button"
                          onClick={() => setNotifMessage((prev) => prev + emo)}
                          className="px-2 py-0.5 rounded-lg bg-[#182335] hover:bg-[#22314a] text-xs cursor-pointer active:scale-90 transition-transform"
                        >
                          {emo}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Type selector */}
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      নটিফিকেশন ক্যাটাগরি / টাইপ:
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { key: 'info', label: '📢 সাধারণ বার্তা', border: 'border-cyan-500/40 text-cyan-300' },
                        { key: 'bonus', label: '🎁 বোনাস এলার্ট', border: 'border-amber-500/40 text-amber-300' },
                        { key: 'update', label: '🚀 নতুন আপডেট', border: 'border-purple-500/40 text-purple-300' },
                        { key: 'alert', label: '⚠️ জরুরী সতর্কতা', border: 'border-rose-500/40 text-rose-300' },
                      ].map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setNotifType(t.key as any)}
                          className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                            notifType === t.key
                              ? `bg-white/10 ${t.border} ring-2 ring-amber-400/30`
                              : 'bg-[#151f2e] border-[#202d44] text-slate-400 hover:text-white'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="pt-2 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={isSendingNotif || !notifTitle.trim() || !notifMessage.trim()}
                      className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-[#120e00] font-black text-xs sm:text-sm shadow-xl shadow-amber-950/40 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.99] disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                      <span>{isSendingNotif ? 'পাঠানো হচ্ছে...' : 'ইউজারদের কাছে নটিফিকেশন পাঠান (Send Notification)'}</span>
                    </button>
                  </div>
                </form>

                {/* Sent History List */}
                <div className="bg-[#111723] border border-[#202d44] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#1c273a]">
                    <span className="font-bold text-xs sm:text-sm text-white flex items-center gap-2">
                      <History className="w-4 h-4 text-cyan-400" />
                      <span>পূর্বে পাঠানো নটিফিকেশন হিস্ট্রি ({broadcastList.length})</span>
                    </span>
                    <span className="text-[10px] text-slate-400">রিয়েলটাইম সিঙ্ক</span>
                  </div>

                  {broadcastList.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-xs">
                      এখনো কোনো নটিফিকেশন পাঠানো হয়নি। উপরে ফরম পূরণ করে প্রথম নটিফিকেশন পাঠান!
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {broadcastList.map((item) => (
                        <div
                          key={item.id}
                          className="bg-[#0b1019] border border-[#1d273a] rounded-xl p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 hover:border-[#2a3a55] transition-colors"
                        >
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                  item.type === 'bonus'
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                    : item.type === 'alert'
                                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                    : item.type === 'update'
                                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                    : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                }`}
                              >
                                {item.type === 'bonus'
                                  ? '🎁 বোনাস'
                                  : item.type === 'alert'
                                  ? '⚠️ অ্যালার্ট'
                                  : item.type === 'update'
                                  ? '🚀 আপডেট'
                                  : '📢 নোটিশ'}
                              </span>
                              <h4 className="font-bold text-xs sm:text-sm text-white">{item.title}</h4>
                              <span className="text-[10px] text-slate-400">
                                {new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} •{' '}
                                {new Date(item.sentAt).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed font-sans">{item.message}</p>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                            <button
                              type="button"
                              onClick={() => handleSelectNotifPreset(item.title, item.message, item.type)}
                              className="px-2.5 py-1 rounded-lg bg-[#182335] hover:bg-[#22314a] text-amber-300 text-[11px] font-semibold transition-colors cursor-pointer"
                              title="এই বার্তা পুনরায় এডিট বা পাঠান"
                            >
                              পুনরায় পাঠান
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBroadcast(item.id)}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors cursor-pointer"
                              title="নটিফিকেশন মুছে ফেলুন"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reject Deposit Dialog Modal */}
        {rejectingRequestId && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-[#121927] border border-rose-500/40 rounded-2xl p-5 max-w-sm w-full shadow-2xl text-white space-y-4">
              <div className="flex items-center gap-2 text-rose-400">
                <XCircle className="w-5 h-5" />
                <h4 className="font-bold text-base">ডিপোজিট রিকোয়েস্ট বাতিল</h4>
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">বাতিলের কারণ লিখুন:</label>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="যেমন: ভুল TrxID বা টাকা পাওয়া যায়নি"
                  className="w-full bg-[#0a0e16] border border-[#233148] rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-rose-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setRejectingRequestId(null)}
                  className="px-3 py-1.5 rounded-xl bg-[#1b2538] hover:bg-[#25344c] text-xs font-medium text-slate-300"
                >
                  ফিরে যান
                </button>
                <button
                  onClick={handleReject}
                  className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  বাতিল নিশ্চিত করুন
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Complete Withdrawal Dialog Modal */}
        {completingWithdrawal && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-[#101724] border border-emerald-500/40 rounded-3xl p-5 max-w-md w-full shadow-2xl text-white space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 border-b border-[#1f2c42] pb-3">
                <CheckCircle2 className="w-6 h-6" />
                <div>
                  <h4 className="font-bold text-base">টাকা পাঠানো নিশ্চিতকরণ (Mark as Sent)</h4>
                  <p className="text-[11px] text-slate-400">গ্রাহকের পার্সোনাল নম্বরে টাকা পাঠিয়ে থাকলে নিশ্চিত করুন</p>
                </div>
              </div>

              <div className="bg-[#0b1018] p-3.5 rounded-2xl border border-[#1d273a] space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">গ্রাহক:</span>
                  <span className="font-bold text-white">{completingWithdrawal.userIdentifier}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">পার্সোনাল নম্বর:</span>
                  <span className="font-mono font-bold text-amber-300 text-sm">{completingWithdrawal.personalNumber}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">মাধ্যম:</span>
                  <span className="font-bold uppercase text-white">{completingWithdrawal.method} Personal</span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                  <span className="text-slate-300 font-bold">প্রদেয় টাকার পরিমাণ:</span>
                  <span className="font-black text-emerald-400 text-base font-mono-numbers">
                    ৳ {completingWithdrawal.amount.toLocaleString()}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">এডমিন নোট / TrxID (ঐচ্ছিক):</label>
                <input
                  type="text"
                  value={completeAdminNote}
                  onChange={(e) => setCompleteAdminNote(e.target.value)}
                  placeholder="যেমন: TrxID 9K34F2... সেন্ড সম্পন্ন"
                  className="w-full bg-[#0a0e16] border border-[#233148] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-hidden focus:border-emerald-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setCompletingWithdrawal(null)}
                  className="px-3.5 py-2 rounded-xl bg-[#1b2538] hover:bg-[#25344c] text-xs font-semibold text-slate-300 cursor-pointer"
                >
                  ফিরে যান
                </button>
                <button
                  onClick={() => handleCompleteWithdrawal(completingWithdrawal, completeAdminNote)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white text-xs font-black shadow-lg shadow-emerald-700/30 cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>টাকা পাঠানো হয়েছে নিশ্চিত করুন</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reject Withdrawal Dialog Modal (With Automatic Refund) */}
        {rejectingWithdrawalId && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-[#140f1a] border border-rose-500/50 rounded-3xl p-5 max-w-md w-full shadow-2xl text-white space-y-4">
              <div className="flex items-center gap-2 text-rose-400 border-b border-[#2d1b28] pb-3">
                <XCircle className="w-6 h-6" />
                <div>
                  <h4 className="font-bold text-base">উত্তোলন রিকোয়েস্ট বাতিল ও ব্যালেন্স রিফান্ড</h4>
                  <p className="text-[11px] text-rose-300/80">বাতিল করলে ইউজারের কাটা টাকা স্বয়ংক্রিয়ভাবে তার একাউন্টে ফেরত চলে যাবে</p>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">বাতিলের কারণ লিখুন:</label>
                <input
                  type="text"
                  value={rejectWithdrawalReason}
                  onChange={(e) => setRejectWithdrawalReason(e.target.value)}
                  placeholder="যেমন: ভুল পার্সোনাল নম্বর / একাউন্ট সমস্যা"
                  className="w-full bg-[#0a0e16] border border-[#233148] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-hidden focus:border-rose-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setRejectingWithdrawalId(null)}
                  className="px-3.5 py-2 rounded-xl bg-[#1b2538] hover:bg-[#25344c] text-xs font-semibold text-slate-300 cursor-pointer"
                >
                  ফিরে যান
                </button>
                <button
                  onClick={handleRejectWithdrawalConfirm}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-black shadow-lg shadow-rose-900/30 cursor-pointer flex items-center gap-1.5"
                >
                  <XCircle className="w-4 h-4" />
                  <span>বাতিল ও রিফান্ড নিশ্চিত করুন</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* User Full History Modal */}
        {selectedHistoryUserId && (
          <UserFullHistoryModal
            userIdOrCode={selectedHistoryUserId}
            onClose={() => setSelectedHistoryUserId(null)}
            onEditAccount={(identifier) => {
              setSelectedHistoryUserId(null);
              const accounts = getStoredPhoneAccounts();
              for (const k of Object.keys(accounts)) {
                const acc = accounts[k];
                if (
                  acc.phoneNumber === identifier ||
                  acc.userCode === identifier ||
                  acc.uid === identifier
                ) {
                  setEditingAccount(acc);
                  break;
                }
              }
            }}
          />
        )}

        {/* Admin User Edit / ID Reset Modal */}
        {editingAccount && (
          <AdminUserEditModal
            userAccount={editingAccount}
            onClose={() => setEditingAccount(null)}
            onSaved={() => {
              setEditingAccount(null);
              reloadData();
              if (onBalanceAdjusted) onBalanceAdjusted();
              showAdminToast(
                'ইউজার তথ্য সফলভাবে সংরক্ষিত ও আপডেট হয়েছে!',
                'ইউজার আইডি, পাসওয়ার্ড ও ব্যালেন্স ফায়ারবেস ক্লাউডে তাৎক্ষণিক আপডেট সম্পন্ন হয়েছে।',
                'success'
              );
            }}
          />
        )}

        {/* Admin Stealth Guide Modal */}
        <AdminStealthGuideModal
          isOpen={showStealthGuideModal}
          onClose={() => setShowStealthGuideModal(false)}
          adminPhone={adminPhone}
        />
      </div>
    </div>
  );
};
