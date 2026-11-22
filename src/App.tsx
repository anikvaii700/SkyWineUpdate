/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RoundStatus, BetState, RoundHistoryItem, LivePlayerBet, ActiveGameTab } from './types/game';
import { Header } from './components/Header';
import { HistoryRibbon } from './components/HistoryRibbon';
import { FlightCanvas } from './components/FlightCanvas';
import { BetPanel } from './components/BetPanel';
import { LiveBetsTable } from './components/LiveBetsTable';
import { WinNotification } from './components/WinNotification';
import { AIPredictorModal } from './components/AIPredictorModal';
import { DepositModal } from './components/DepositModal';
import { RulesModal } from './components/RulesModal';
import { WingoGame } from './components/WingoGame';
import { AuthModal } from './components/AuthModal';
import { AdminPanel } from './components/AdminPanel';
import { AdminNotificationBanner } from './components/AdminNotificationBanner';
import { isUserAdminAccount } from './services/adminAuth';
import { UserBalanceAlertToast, UserAlertToastData } from './components/UserBalanceAlertToast';
import { LuckySpinnerModal } from './components/LuckySpinnerModal';
import { DailyBonusModal } from './components/DailyBonusModal';
import { BroadcastNoticeModal } from './components/BroadcastNoticeModal';
import {
  recordAppOpenAndScheduleReminder,
  checkAndTriggerDailyReminder,
  listenToBroadcastNotifications,
  getLastSeenBroadcastId,
  setLastSeenBroadcastId,
  BroadcastNotification,
} from './services/notificationService';
import {
  isSpinAvailable,
  isDailyBonusAvailable,
  recordActiveTime,
  loadBonusState,
} from './services/bonusService';
import confetti from 'canvas-confetti';
import {
  getStoredDepositRequests,
  getStoredWithdrawalRequests,
  getStoredPaymentSettings,
  SystemPaymentSettings,
  listenToDepositRequests,
  listenToWithdrawalRequests,
} from './services/manualPayment';
import { soundManager } from './services/audio';
import { backendApi, mapBackendMeToProfile } from './services/backendApi';
import { Language, translations } from './utils/i18n';
import {
  auth,
  db,
  getOrCreateUserProfile,
  syncUserBalanceToFirestore,
  recordWalletTransaction,
  recordBetHistory,
  UserWalletProfile,
} from './services/firebase';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import {
  AppUser,
  getActivePhoneSession,
  syncPhoneAccountBalance,
  updatePhoneAccountBalanceLocally,
  checkAccountSuspensionStatus,
  logoutPhoneSession,
} from './services/phoneAuth';
import { recordUserBet } from './services/userManagement';
import {
  captureReferralCodeFromUrl,
  computeInviteBonusStake,
  syncInviteBonusBalance,
} from './services/referralService';
import {
  AppControlConfig,
  getStoredAppControls,
  subscribeToAppControls,
  clearAviatorForceCrash,
} from './services/appControlService';
import { usePWAInstall } from './hooks/usePWAInstall';
import { PWAInstallModal } from './components/PWAInstallModal';
import { MobileBottomNav } from './components/MobileBottomNav';
import { SplashScreen } from './components/SplashScreen';
import { MobileSideDrawer } from './components/MobileSideDrawer';
import { ExitModal } from './components/ExitModal';
import { MarqueeTicker } from './components/MarqueeTicker';
import { AndroidStudioExportModal } from './components/AndroidStudioExportModal';
import { Plane, LogOut, Ban, ShieldAlert } from 'lucide-react';

const INITIAL_BALANCE = 0; // Starts at 0 for real authenticated accounts

export default function App() {
  const [balance, setBalance] = useState<number>(INITIAL_BALANCE);
  const [roundStatus, setRoundStatus] = useState<RoundStatus>('WAITING');
  const [currentMultiplier, setCurrentMultiplier] = useState<number>(1.0);
  const [finalCrashMultiplier, setFinalCrashMultiplier] = useState<number>(1.84);
  const [waitingCountdown, setWaitingCountdown] = useState<number>(5.0);

  // Mobile App Native Experience & Splash Screen State
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [isSideDrawerOpen, setIsSideDrawerOpen] = useState<boolean>(false);
  const [isExitModalOpen, setIsExitModalOpen] = useState<boolean>(false);
  const [isAppClosed, setIsAppClosed] = useState<boolean>(false);
  const [backPressToast, setBackPressToast] = useState<string | null>(null);
  const lastBackPressTimeRef = useRef<number>(0);
  const isExitingRef = useRef<boolean>(false);
  const backToastTimeoutRef = useRef<any>(null);

  const handleFinishSplash = useCallback(() => {
    setShowSplash(false);
  }, []);

  // Mobile App PWA & Android Studio State
  const [isInstallModalOpen, setIsInstallModalOpen] = useState<boolean>(false);
  const [isAndroidStudioOpen, setIsAndroidStudioOpen] = useState<boolean>(false);
  const { isInstalled: isAppInstalled, isMobile } = usePWAInstall();

  // Language & UI Modals
  const [lang, setLang] = useState<Language>('bn');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isDepositOpen, setIsDepositOpen] = useState<boolean>(false);
  const [walletTab, setWalletTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [isRulesOpen, setIsRulesOpen] = useState<boolean>(false);
  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(false);
  const [adminPanelInitialTab, setAdminPanelInitialTab] = useState<'requests' | 'withdrawals' | 'settings' | 'users' | 'notifications'>('requests');
  const [activeBroadcastNotice, setActiveBroadcastNotice] = useState<BroadcastNotification | null>(null);
  const isInitialBroadcastLoadRef = useRef(true);
  const [balanceUpdateNotice, setBalanceUpdateNotice] = useState<string | null>(null);
  const [systemSettings, setSystemSettings] = useState<SystemPaymentSettings>(() => getStoredPaymentSettings());
  const [appControls, setAppControls] = useState<AppControlConfig>(() => getStoredAppControls());
  const appControlsRef = useRef<AppControlConfig>(appControls);
  const [userAlertToast, setUserAlertToast] = useState<UserAlertToastData | null>(null);
  const knownDepositStatusesRef = useRef<Record<string, string>>({});
  const knownWithdrawalStatusesRef = useRef<Record<string, string>>({});
  const isUserRequestsInitialRef = useRef(true);
  const [pendingDepositCount, setPendingDepositCount] = useState<number>(0);
  const [isPredictorOpen, setIsPredictorOpen] = useState<boolean>(true); // open by default as in screenshot
  const [activeGameTab, setActiveGameTab] = useState<ActiveGameTab>('AVIATOR');

  // User Auth & Cloud / Local Server Wallet State
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserWalletProfile | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false);
  const [authNoticeMessage, setAuthNoticeMessage] = useState<string | null>(null);

  // Daily Bonus, 7-Day Streak & Lucky Spinner State
  const [isSpinnerOpen, setIsSpinnerOpen] = useState<boolean>(false);
  const [isBonusHubOpen, setIsBonusHubOpen] = useState<boolean>(false);
  const [activeSecondsToday, setActiveSecondsToday] = useState<number>(0);
  const [hasUnclaimedBonus, setHasUnclaimedBonus] = useState<boolean>(false);
  const hasAutoPromptedSpinnerRef = useRef<boolean>(false);
  const hasAutoPromptedReferralAuthRef = useRef<boolean>(false);
  const capturedUrlReferralRef = useRef<string | null>(null);

  // Win Banner Notification
  const [winNotification, setWinNotification] = useState<{ amount: number; multiplier: number } | null>(null);

  // Dual Betting Panels
  const [bet1, setBet1] = useState<BetState>({
    id: 'bet-1',
    amount: 1000,
    isPlaced: false,
    cashedOut: false,
    cashedOutMultiplier: null,
    winAmount: null,
    isAutoCashOut: false,
    autoCashOutMultiplier: 2.0,
    isAutoBet: false,
    inviteBonusStake: 0,
  });

  const [bet2, setBet2] = useState<BetState>({
    id: 'bet-2',
    amount: 1000,
    isPlaced: false,
    cashedOut: false,
    cashedOutMultiplier: null,
    winAmount: null,
    isAutoCashOut: false,
    autoCashOutMultiplier: 2.0,
    isAutoBet: false,
    inviteBonusStake: 0,
  });

  // Recent multiplier history
  const [history, setHistory] = useState<RoundHistoryItem[]>([
    { id: '1', crashMultiplier: 2.14, timestamp: Date.now() - 60000 },
    { id: '2', crashMultiplier: 3.12, timestamp: Date.now() - 120000 },
    { id: '3', crashMultiplier: 1.57, timestamp: Date.now() - 180000 },
    { id: '4', crashMultiplier: 1.96, timestamp: Date.now() - 240000 },
    { id: '5', crashMultiplier: 8.10, timestamp: Date.now() - 300000 },
    { id: '6', crashMultiplier: 1.15, timestamp: Date.now() - 360000 },
    { id: '7', crashMultiplier: 1.84, timestamp: Date.now() - 420000 },
    { id: '8', crashMultiplier: 4.52, timestamp: Date.now() - 480000 },
    { id: '9', crashMultiplier: 1.38, timestamp: Date.now() - 540000 },
    { id: '10', crashMultiplier: 14.80, timestamp: Date.now() - 600000 },
  ]);

  // My Personal Bets History
  const [myBetHistory, setMyBetHistory] = useState<
    Array<{ id: string; amount: number; multiplier: number | null; winAmount: number | null; timestamp: number }>
  >([
    { id: 'h-0', amount: 1000, multiplier: 1.53, winAmount: 1530, timestamp: Date.now() - 150000 },
  ]);

  // Simulated Live Multiplayer Bets
  const [livePlayers, setLivePlayers] = useState<LivePlayerBet[]>([]);

  // Refs for requestAnimationFrame loop
  const flightStartTimeRef = useRef<number>(0);
  const crashTargetRef = useRef<number>(1.84);
  const animFrameIdRef = useRef<number | null>(null);
  const currentMultiplierRef = useRef<number>(1.0);

  // Synchronization refs to prevent multiple trigger in animation frames
  const bet1StateRef = useRef(bet1);
  const bet2StateRef = useRef(bet2);
  const bet1CashedOutRef = useRef(false);
  const bet2CashedOutRef = useRef(false);

  useEffect(() => {
    bet1StateRef.current = bet1;
  }, [bet1]);

  useEffect(() => {
    bet2StateRef.current = bet2;
  }, [bet2]);

  const balanceRef = useRef(balance);
  const userProfileRef = useRef(userProfile);
  const currentUserRef = useRef(currentUser);
  const inviteBonusBalanceRef = useRef<number>(0);

  useEffect(() => {
    balanceRef.current = balance;
  }, [balance]);

  useEffect(() => {
    userProfileRef.current = userProfile;
    inviteBonusBalanceRef.current = Math.max(0, userProfile?.inviteBonusBalance || 0);
  }, [userProfile]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Live Firestore & localStorage subscription to Admin App Controls (Game Control, Limits, Maintenance, Bonuses)
  useEffect(() => {
    const unsub = subscribeToAppControls((cfg) => {
      setAppControls(cfg);
      appControlsRef.current = cfg;
    });
    return () => unsub();
  }, []);

  // Capture ?ref=CODE from referral link on first load
  useEffect(() => {
    const code = captureReferralCodeFromUrl();
    if (code) {
      capturedUrlReferralRef.current = code;
    }
  }, []);

  // If user arrived via a referral link and is not logged in, open Signup modal automatically once splash finishes
  useEffect(() => {
    if (
      !showSplash &&
      capturedUrlReferralRef.current &&
      !hasAutoPromptedReferralAuthRef.current &&
      !currentUser &&
      !getActivePhoneSession()
    ) {
      hasAutoPromptedReferralAuthRef.current = true;
      hasAutoPromptedSpinnerRef.current = true;
      setAuthNoticeMessage(
        `রেফারেল লিংক (${capturedUrlReferralRef.current}) শনাক্ত হয়েছে! ফ্রি একাউন্ট তৈরি করুন।`
      );
      setIsAuthOpen(true);
    }
  }, [showSplash, currentUser]);

  // Keep track of active modal states for synchronous back-button popstate handling
  const openModalsRef = useRef({
    isSideDrawerOpen,
    isExitModalOpen,
    isAuthOpen,
    isDepositOpen,
    isRulesOpen,
    isAdminOpen,
    isInstallModalOpen,
    isAndroidStudioOpen,
    isSpinnerOpen,
    isBonusHubOpen,
    activeGameTab,
  });

  useEffect(() => {
    openModalsRef.current = {
      isSideDrawerOpen,
      isExitModalOpen,
      isAuthOpen,
      isDepositOpen,
      isRulesOpen,
      isAdminOpen,
      isInstallModalOpen,
      isAndroidStudioOpen,
      isSpinnerOpen,
      isBonusHubOpen,
      activeGameTab,
    };
  }, [
    isSideDrawerOpen,
    isExitModalOpen,
    isAuthOpen,
    isDepositOpen,
    isRulesOpen,
    isAdminOpen,
    isInstallModalOpen,
    isAndroidStudioOpen,
    isSpinnerOpen,
    isBonusHubOpen,
    activeGameTab,
  ]);

  // Phone Default Back Button & Double Back Exit Handling
  useEffect(() => {
    // Prime the browser history stack to trap back navigation
    window.history.replaceState({ page: 'root' }, '');
    window.history.pushState({ page: 'aviator-dashboard' }, '');

    const handlePopState = () => {
      if (isExitingRef.current) return;
      const state = openModalsRef.current;
      const now = Date.now();

      // Case 1: If Exit modal is already open, 2nd back press exits the app directly!
      if (state.isExitModalOpen) {
        handleExitApp();
        return;
      }

      // Case 2: Close 3-line side drawer menu
      if (state.isSideDrawerOpen) {
        setIsSideDrawerOpen(false);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      // Case 2.5: Close broadcast notice modal
      if (activeBroadcastNotice) {
        setActiveBroadcastNotice(null);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      // Case 3: Close any active modal
      if (state.isSpinnerOpen) {
        setIsSpinnerOpen(false);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      if (state.isBonusHubOpen) {
        setIsBonusHubOpen(false);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      if (state.isAuthOpen) {
        setIsAuthOpen(false);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      if (state.isDepositOpen) {
        setIsDepositOpen(false);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      if (state.isRulesOpen) {
        setIsRulesOpen(false);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      if (state.isAdminOpen) {
        setIsAdminOpen(false);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      if (state.isInstallModalOpen) {
        setIsInstallModalOpen(false);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      if (state.isAndroidStudioOpen) {
        setIsAndroidStudioOpen(false);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      // Case 4: If on sub-game (like Wingo), go back to Aviator dashboard
      if (state.activeGameTab !== 'AVIATOR') {
        setActiveGameTab('AVIATOR');
        window.history.pushState({ page: 'aviator-dashboard' }, '');
        return;
      }

      // Case 5: On the dashboard with no open modals -> Check if double-tapped within 2000ms!
      if (now - lastBackPressTimeRef.current < 2000) {
        // Double tap on phone back button detected within 2 seconds: Open Exit Confirmation Modal!
        soundManager.playClick();
        setBackPressToast(null);
        setIsExitModalOpen(true);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
      } else {
        // 1st back button press on phone: Show standard mobile toast like Facebook/YouTube!
        lastBackPressTimeRef.current = now;
        soundManager.playClick();
        setBackPressToast('অ্যাপ থেকে বের হতে আবার ব্যাক বাটনে চাপ দিন');
        if (backToastTimeoutRef.current) clearTimeout(backToastTimeoutRef.current);
        backToastTimeoutRef.current = setTimeout(() => {
          setBackPressToast(null);
        }, 2200);
        window.history.pushState({ page: 'aviator-dashboard' }, '');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (backToastTimeoutRef.current) clearTimeout(backToastTimeoutRef.current);
    };
  }, []);

  // Listen to Firebase Auth or restore saved Phone session
  useEffect(() => {
    // 1. Check if phone user session exists
    const phoneSession = getActivePhoneSession();
    if (phoneSession) {
      setCurrentUser(phoneSession.user);
      setUserProfile(phoneSession.profile);
      setBalance(phoneSession.profile.balance);

      // Immediately fetch from Firestore in background in case deposits were approved while app was closed
      const cleanPhone = phoneSession.user.phoneNumber ? phoneSession.user.phoneNumber.replace(/[^0-9]/g, '') : '';
      const uid = phoneSession.user.uid || `phone_${cleanPhone}`;
      getDoc(doc(db, 'users', uid))
        .then((snap) => {
          if (snap.exists()) {
            const d = snap.data();
            if (d && typeof d.balance === 'number') {
              const remoteBal = Math.max(0, Math.round(d.balance * 100) / 100);
              setBalance(remoteBal);
              setUserProfile((prev) => (prev ? { ...prev, ...d, balance: remoteBal } : (d as UserWalletProfile)));
              updatePhoneAccountBalanceLocally(uid, remoteBal);
              if (cleanPhone) updatePhoneAccountBalanceLocally(cleanPhone, remoteBal);
            }
          }
        })
        .catch(() => {});
    }

    // Firebase Auth is the only login session source. Wallet/profile come from PostgreSQL.
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const me = await backendApi.getMe();
          const profile = mapBackendMeToProfile(me, user);
          const isPhoneAlias = /^user_01[0-9]{9}@phone\.aviator\.bd$/i.test(user.email || '');
          const appUser: AppUser = {
            uid: user.uid,
            userCode: me.user.userCode,
            referralCode: me.user.referralCode,
            displayName: me.user.displayName || user.displayName || 'Player',
            email: user.email,
            phoneNumber: me.user.phoneNumber || user.phoneNumber || null,
            photoURL: user.photoURL,
            provider: isPhoneAlias ? 'phone' : 'google',
            status: me.user.status as AppUser['status'],
          };
          setCurrentUser(appUser);
          setUserProfile(profile);
          setBalance(me.wallet.balance);
        } catch (err) {
          console.error('Could not load authenticated server profile:', err);
          setCurrentUser(null);
          setUserProfile(null);
          setBalance(0);
          setAuthNoticeMessage('সার্ভারের সাথে সংযোগ হয়নি। কিছুক্ষণ পর আবার লগইন করুন।');
        }
      } else {
        setCurrentUser(null);
        setUserProfile(null);
        setBalance(0);
      }
    });

    return () => unsubscribe();
  }, []);

  // Listen to manual deposit approval credit events and pending deposit badge count
  useEffect(() => {
    const handleBalanceCredited = (e: Event) => {
      const customEvent = e as CustomEvent<{
        userId: string;
        docId?: string;
        phone?: string;
        amount: number;
        originalAmount?: number;
        bonusAmount?: number;
        bonusPercent?: number;
        isFirstDeposit?: boolean;
        creditedAmount?: number;
        requestId: string;
      }>;
      if (customEvent.detail && customEvent.detail.amount > 0) {
        const targetUid = customEvent.detail.userId;
        const targetDocId = customEvent.detail.docId;
        const targetPhone = customEvent.detail.phone || targetUid.replace('phone_', '');
        const cleanMyPhone = currentUser?.phoneNumber ? currentUser.phoneNumber.replace(/[^0-9]/g, '') : '';

        const isMatch =
          !currentUser ||
          currentUser.uid === targetUid ||
          (targetDocId && currentUser.uid === targetDocId) ||
          (cleanMyPhone && targetPhone && cleanMyPhone === targetPhone) ||
          currentUser.phoneNumber === targetPhone;

        if (isMatch) {
          const detail = customEvent.detail;
          setBalance((prev) => prev + detail.amount);
          setUserProfile((p) => (p ? { ...p, balance: p.balance + detail.amount } : null));
          soundManager.playWin();

          if (detail.isFirstDeposit && detail.bonusAmount && detail.bonusAmount > 0) {
            setBalanceUpdateNotice(
              `🎉 প্রথম ডিপোজিট বোনাস সহ ৳ ${detail.amount.toLocaleString()} সফলভাবে জমা হয়েছে! (মূল ৳${(detail.creditedAmount || (detail.amount - detail.bonusAmount)).toLocaleString()} + ${detail.bonusPercent}% বোনাস ৳${detail.bonusAmount.toLocaleString()})`
            );
          } else {
            setBalanceUpdateNotice(
              `🎉 আপনার একাউন্টে ৳ ${detail.amount.toLocaleString()} সফলভাবে জমা হয়েছে!`
            );
          }
        }
      }
    };

    const updatePendingCount = () => {
      if (!isUserAdminAccount(currentUser?.phoneNumber)) {
        setPendingDepositCount(0);
        return;
      }
      const depReqs = getStoredDepositRequests();
      const wthReqs = getStoredWithdrawalRequests();
      const pendingDep = depReqs.filter((r) => r.status === 'pending').length;
      const pendingWth = wthReqs.filter((r) => r.status === 'pending').length;
      setPendingDepositCount(pendingDep + pendingWth);
    };

    const handleInviteBonusCredited = (e: Event) => {
      const customEvent = e as CustomEvent<{
        referrerUid?: string;
        referrerCode?: string;
        bonusAmount: number;
        depositorName?: string;
      }>;
      const detail = customEvent.detail;
      if (!detail || !detail.bonusAmount || detail.bonusAmount <= 0 || !currentUser) return;

      const myCode = (userProfileRef.current?.userCode || currentUser.userCode || '').toUpperCase();
      const targetCode = (detail.referrerCode || '').toUpperCase();
      const isMatch =
        (detail.referrerUid && currentUser.uid === detail.referrerUid) ||
        (myCode && targetCode && myCode === targetCode);

      if (isMatch) {
        soundManager.playWin();
        const amt = Math.round(detail.bonusAmount * 100) / 100;
        const nextInvite = Math.round((inviteBonusBalanceRef.current + amt) * 100) / 100;
        inviteBonusBalanceRef.current = nextInvite;
        setBalance((prev) => Math.round((prev + amt) * 100) / 100);
        setUserProfile((p) =>
          p
            ? {
                ...p,
                balance: Math.round(((p.balance || 0) + amt) * 100) / 100,
                inviteBonusBalance: nextInvite,
                referralBonusEarned: Math.round(((p.referralBonusEarned || 0) + amt) * 100) / 100,
                lockedPrincipal: Math.round(((p.lockedPrincipal || 0) + amt) * 100) / 100,
              }
            : null
        );
        setUserAlertToast({
          title: '🎁 ১০০% ইনভাইট বোনাস যুক্ত হয়েছে!',
          message: `আপনার ইনভাইট করা বন্ধু (${detail.depositorName || 'বন্ধু'}) প্রথম ডিপোজিট করায় ৳${amt.toLocaleString()} (১০০%) ইনভাইট বোনাস পেয়েছেন!`,
          details: 'বি:দ্র: ইনভাইট বোনাসের টাকা উইথড্র করা যাবে না এবং এটি দিয়ে লাভবান হওয়া যাবে না।',
          type: 'success',
        });
      }
    };

    updatePendingCount();
    window.addEventListener('balance_credited', handleBalanceCredited);
    window.addEventListener('invite_bonus_credited', handleInviteBonusCredited);
    window.addEventListener('deposit_requests_updated', updatePendingCount);
    window.addEventListener('withdrawal_requests_updated', updatePendingCount);

    return () => {
      window.removeEventListener('balance_credited', handleBalanceCredited);
      window.removeEventListener('invite_bonus_credited', handleInviteBonusCredited);
      window.removeEventListener('deposit_requests_updated', updatePendingCount);
      window.removeEventListener('withdrawal_requests_updated', updatePendingCount);
    };
  }, [currentUser]);

  // Real-time Firestore listener for logged-in user wallet profile and balance
  const prevRemoteBalanceRef = useRef<number | null>(null);
  const prevRemoteInviteBonusRef = useRef<number | null>(null);
  useEffect(() => {
    if (!currentUser) {
      prevRemoteBalanceRef.current = null;
      prevRemoteInviteBonusRef.current = null;
      return;
    }

    const cleanPhone = currentUser.phoneNumber ? currentUser.phoneNumber.replace(/[^0-9]/g, '') : '';
    const docId = currentUser.uid || (cleanPhone ? `phone_${cleanPhone}` : '');
    if (!docId) return;

    const userDocRef = doc(db, 'users', docId);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as UserWalletProfile;
          const newInviteBal = Math.max(0, Math.round((data.inviteBonusBalance || 0) * 100) / 100);
          const inviteIncreased =
            prevRemoteInviteBonusRef.current !== null && newInviteBal > prevRemoteInviteBonusRef.current;
          const inviteDelta = inviteIncreased
            ? Math.round((newInviteBal - (prevRemoteInviteBonusRef.current || 0)) * 100) / 100
            : 0;

          if (inviteIncreased && inviteDelta > 0) {
            setUserAlertToast({
              title: '🎁 ১০০% ইনভাইট বোনাস যুক্ত হয়েছে!',
              message: `আপনার ইনভাইট করা বন্ধু প্রথম ডিপোজিট করায় ৳${inviteDelta.toLocaleString()} (১০০%) ইনভাইট বোনাস আপনার ব্যালেন্সে যোগ হয়েছে!`,
              details: 'বি:দ্র: ইনভাইট বোনাসের টাকা উইথড্র করা যাবে না এবং এটি দিয়ে লাভবান হওয়া যাবে না।',
              type: 'success',
            });
            soundManager.playWin();
          }

          prevRemoteInviteBonusRef.current = newInviteBal;
          inviteBonusBalanceRef.current = newInviteBal;

          if (typeof data.balance === 'number') {
            const newBal = Math.max(0, Math.round(data.balance * 100) / 100);

            // If balance increased remotely (e.g. admin approved deposit or refunded withdrawal)
            if (prevRemoteBalanceRef.current !== null && newBal > prevRemoteBalanceRef.current) {
              const credited = Math.round((newBal - prevRemoteBalanceRef.current) * 100) / 100;
              if (!inviteIncreased || Math.abs(credited - inviteDelta) > 0.01) {
                setBalanceUpdateNotice(
                  `🎉 আপনার একাউন্টে ৳ ${credited.toLocaleString()} জমা হয়েছে! বর্তমান ব্যালেন্স: ৳ ${newBal.toLocaleString()}`
                );
                soundManager.playWin();
              }
            }

            prevRemoteBalanceRef.current = newBal;
            setBalance(newBal);
            setUserProfile((prev) => (prev ? { ...prev, ...data, balance: newBal, inviteBonusBalance: newInviteBal } : { ...data, balance: newBal, inviteBonusBalance: newInviteBal }));

            if (currentUser.provider === 'phone') {
              updatePhoneAccountBalanceLocally(currentUser.uid, newBal);
              if (cleanPhone) {
                updatePhoneAccountBalanceLocally(cleanPhone, newBal);
              }
            }
          }
        }
      },
      (error) => {
        console.warn('Realtime user profile listener error:', error);
      }
    );

    return () => unsubscribe();
  }, [currentUser?.uid, currentUser?.phoneNumber]);

  // Real-time Firestore listener for System Payment Settings (bKash/Nagad/Rocket numbers and notices)
  useEffect(() => {
    const settingsDocRef = doc(db, 'system', 'payment_settings');
    const unsubscribe = onSnapshot(
      settingsDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data) {
            localStorage.setItem('aviator_payment_settings_v2', JSON.stringify(data));
            setSystemSettings(data as SystemPaymentSettings);
            window.dispatchEvent(new CustomEvent('payment_settings_updated', { detail: data }));
          }
        }
      },
      (err) => {
        console.warn('Realtime payment settings listener error:', err);
      }
    );
    return () => unsubscribe();
  }, []);

  // Real-time listener for local storage and in-app payment & telegram settings changes
  useEffect(() => {
    const handleSettingsUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<SystemPaymentSettings>;
      if (customEvent.detail) {
        setSystemSettings(customEvent.detail);
      } else {
        setSystemSettings(getStoredPaymentSettings());
      }
    };
    window.addEventListener('payment_settings_updated', handleSettingsUpdated);
    return () => window.removeEventListener('payment_settings_updated', handleSettingsUpdated);
  }, []);

  // Real-time listener for user deposit/withdrawal approvals and alerts
  useEffect(() => {
    if (!currentUser) return;

    // Reset status tracker on user change
    isUserRequestsInitialRef.current = true;
    knownDepositStatusesRef.current = {};
    knownWithdrawalStatusesRef.current = {};

    const cleanMyPhone = currentUser.phoneNumber ? currentUser.phoneNumber.replace(/[^0-9]/g, '') : '';
    const myUserCode = currentUser.userCode || '';

    // 1. Listen to Deposit Request transitions for this user
    const unsubDeposits = listenToDepositRequests((allRequests) => {
      const myDeposits = allRequests.filter((r) => {
        if (r.userId === currentUser.uid) return true;
        if (cleanMyPhone && (r.senderNumber === cleanMyPhone || r.userIdentifier.includes(cleanMyPhone))) return true;
        if (myUserCode && r.userCode === myUserCode) return true;
        return false;
      });

      if (isUserRequestsInitialRef.current) {
        myDeposits.forEach((r) => {
          knownDepositStatusesRef.current[r.id] = r.status;
        });
        return;
      }

      myDeposits.forEach((r) => {
        const prevStatus = knownDepositStatusesRef.current[r.id];
        // Deposit Approved: User gets celebration alert & immediate balance reflection
        if (prevStatus === 'pending' && r.status === 'approved') {
          soundManager.playWin();
          setUserAlertToast({
            title: 'এড মানি সফলভাবে অনুমোদিত!',
            message: `আপনার ৳ ${r.amount.toLocaleString()} টাকার ${r.method.toUpperCase()} ডিপোজিট অনুমোদিত হয়েছে!`,
            details: `ট্রানজেকশন আইডি: ${r.trxId}। একাউন্টে ৳ ${r.amount.toLocaleString()} ব্যালেন্স সফলভাবে যোগ করা হয়েছে।`,
            type: 'success',
          });

          // Immediate local balance credit so user sees funds without delay
          setBalance((prev) => {
            const next = Math.round((prev + r.amount) * 100) / 100;
            if (currentUser.provider === 'phone') {
              updatePhoneAccountBalanceLocally(currentUser.uid, next);
              if (cleanMyPhone) updatePhoneAccountBalanceLocally(cleanMyPhone, next);
            }
            return next;
          });
          setUserProfile((p) => (p ? { ...p, balance: Math.round(((p.balance || 0) + r.amount) * 100) / 100 } : null));
        }
        // Deposit Rejected: User gets reason notification
        else if (prevStatus === 'pending' && r.status === 'rejected') {
          soundManager.playCrash();
          setUserAlertToast({
            title: 'এড মানি বাতিল করা হয়েছে',
            message: `আপনার ৳ ${r.amount.toLocaleString()} টাকার ${r.method.toUpperCase()} ডিপোজিট রিকোয়েস্ট বাতিল হয়েছে।`,
            details: `কারণ: ${r.rejectionReason || 'সঠিক তথ্য বা TrxID না পাওয়ায় বাতিল করা হয়েছে।'}`,
            type: 'error',
          });
        }
        knownDepositStatusesRef.current[r.id] = r.status;
      });
    });

    // 2. Listen to Withdrawal Request transitions for this user
    const unsubWithdrawals = listenToWithdrawalRequests((allWithdrawals) => {
      const myWithdrawals = allWithdrawals.filter((w) => {
        if (w.userId === currentUser.uid) return true;
        if (cleanMyPhone && (w.personalNumber === cleanMyPhone || w.userIdentifier.includes(cleanMyPhone))) return true;
        if (myUserCode && w.userCode === myUserCode) return true;
        return false;
      });

      if (isUserRequestsInitialRef.current) {
        myWithdrawals.forEach((w) => {
          knownWithdrawalStatusesRef.current[w.id] = w.status;
        });
        isUserRequestsInitialRef.current = false;
        return;
      }

      myWithdrawals.forEach((w) => {
        const prevStatus = knownWithdrawalStatusesRef.current[w.id];
        // Withdrawal Completed: User gets payout alert
        if (prevStatus === 'pending' && w.status === 'completed') {
          soundManager.playWin();
          setUserAlertToast({
            title: 'ক্যাশআউট সফল হয়েছে!',
            message: `আপনার ৳ ${w.amount.toLocaleString()} টাকার ${w.method.toUpperCase()} উত্তোলন সফলভাবে সম্পন্ন হয়েছে!`,
            details: `টাকা আপনার পার্সোনাল নম্বর (+88 ${w.personalNumber})-এ পাঠিয়ে দেওয়া হয়েছে।`,
            type: 'success',
          });
        }
        // Withdrawal Rejected: User gets refund alert & balance restored
        else if (prevStatus === 'pending' && w.status === 'rejected') {
          soundManager.playCrash();
          setUserAlertToast({
            title: 'ক্যাশআউট বাতিল ও রিফান্ড',
            message: `আপনার ৳ ${w.amount.toLocaleString()} টাকার উত্তোলন বাতিল হয়েছে এবং টাকা ব্যালেন্সে ফেরত দেওয়া হয়েছে।`,
            details: `কারণ: ${w.rejectionReason || 'ভুল নম্বর বা তথ্যগত ত্রুটির কারণে রিফান্ড করা হয়েছে।'}`,
            type: 'warning',
          });

          // Immediate local refund
          setBalance((prev) => {
            const next = Math.round((prev + w.amount) * 100) / 100;
            if (currentUser.provider === 'phone') {
              updatePhoneAccountBalanceLocally(currentUser.uid, next);
              if (cleanMyPhone) updatePhoneAccountBalanceLocally(cleanMyPhone, next);
            }
            return next;
          });
          setUserProfile((p) => (p ? { ...p, balance: Math.round(((p.balance || 0) + w.amount) * 100) / 100 } : null));
        }
        knownWithdrawalStatusesRef.current[w.id] = w.status;
      });
    });

    return () => {
      unsubDeposits();
      unsubWithdrawals();
    };
  }, [currentUser?.uid, currentUser?.phoneNumber]);

  // Sync balance updates with Firestore cloud wallet or Phone Account storage
  const updateBalanceAndSync = useCallback((updater: (prev: number) => number) => {
    // Game-round balance remains a local practice display until bet/cashout endpoints exist.
    // It never writes or mutates the authoritative PostgreSQL wallet.
    setBalance((prev) => {
      const next = Math.max(0, Math.round(updater(prev) * 100) / 100);
      setUserProfile((profile) => (profile ? { ...profile, balance: next } : null));
      return next;
    });
  }, []);

  // Handle bonus rewards from Lucky Spinner, Daily Open Bonus & 7-Day Streak
  const handleRewardWon = useCallback((amount: number, reason: string) => {
    updateBalanceAndSync((prev) => prev + amount);
    if (currentUser && currentUser.provider === 'google') {
      recordWalletTransaction(currentUser.uid, {
        type: 'deposit',
        amount,
        method: 'bkash',
        accountNumber: 'SYSTEM_BONUS',
        status: 'completed',
        trxId: 'BNS' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      });
    }
    setUserAlertToast({
      title: 'বোনাস ব্যালেন্সে যোগ হয়েছে!',
      message: `৳${amount} টাকা (${reason}) সফলভাবে আপনার একাউন্টে যোগ হয়েছে!`,
      details: 'এখনই এই টাকা দিয়ে খেলায় অংশ নিয়ে বেশি টাকা আয় করুন।',
      type: 'success',
    });
  }, [currentUser, updateBalanceAndSync]);

  // 1. Auto-open Lucky Spinner on app launch (Requirement 3: "অ্যাপ অপেন করলেই পপআপ স্পিনার থাকবে")
  useEffect(() => {
    if (!showSplash && !hasAutoPromptedSpinnerRef.current) {
      hasAutoPromptedSpinnerRef.current = true;
      if (!appControlsRef.current.luckySpinnerEnabled) return;
      const canSpin = isSpinAvailable(currentUser?.uid);
      if (canSpin) {
        const timer = setTimeout(() => {
          setIsSpinnerOpen(true);
        }, 800);
        return () => clearTimeout(timer);
      }
    }
  }, [showSplash, currentUser]);

  // 2. Active 5-minute tracker for 7-Day Consecutive Streak (Requirement 2: "মিনিমম ৫ মিনিট অ্যাপ অপেন রাখলে ৩০০৳ সাপ্তাহিক বোনাস")
  useEffect(() => {
    if (showSplash) return;

    // Initialize today's active seconds
    const initialState = loadBonusState(currentUser?.uid);
    setActiveSecondsToday(initialState.todaySecondsSpent || 0);

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const res = recordActiveTime(1, currentUser?.uid);
        setActiveSecondsToday(res.state.todaySecondsSpent);

        // When today's 5 minutes is completed for the first time
        if (res.justQualifiedToday) {
          soundManager.playWin();
          setUserAlertToast({
            title: 'আজকের ৫ মিনিট সফল! ✓',
            message: `৭ দিনের স্ট্রিকের ${res.state.streakCount}/৭ দিন সফলভাবে সম্পন্ন হয়েছে!`,
            details: 'একটানা ৭ দিন দিনে অন্তত ৫ মিনিট করে অ্যাপে সক্রিয় থাকলে পাবেন ৩০০৳ সাপ্তাহিক বোনাস!',
            type: 'success',
          });
        }

        // When 7 consecutive days are completed
        if (res.justWonWeekly) {
          soundManager.playJackpot();
          try {
            confetti({
              particleCount: 120,
              spread: 80,
              origin: { y: 0.5 },
            });
          } catch {}

          updateBalanceAndSync((prev) => prev + res.weeklyAmount);
          setUserAlertToast({
            title: '🎉 ৫০০৳ সাপ্তাহিক বোনাস অর্জিত!',
            message: 'একটানা ৭ দিন সফলভাবে সম্পন্ন করে ৫০০৳ সাপ্তাহিক ক্যাশ বোনাস পেয়েছেন!',
            details: 'টাকা সরাসরি আপনার একাউন্ট ওয়ালেটে যোগ করা হয়েছে!',
            type: 'success',
          });
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [showSplash, currentUser, updateBalanceAndSync]);

  // 3. Daily Next-Day App Open Notification System (Requirement 3: "প্রতিদিন যে টাইমে অ্যাপ অপেন হয় সেই টাইমে পরেরদিন অ্যাপ অপেন করার জন্য একটা নটিফিকেশন যাবে")
  useEffect(() => {
    if (showSplash) return;

    // Record today's open timestamp & schedule tomorrow's reminder at this exact time
    recordAppOpenAndScheduleReminder();

    // Check immediately if past due reminder should trigger
    checkAndTriggerDailyReminder((title, message) => {
      setUserAlertToast({
        title,
        message,
        type: 'info',
        details: 'ডেইলি বোনাস ও লাকি স্পিন পেতে বোনাস বাটনে চাপুন।',
      });
    });

    // Check periodically (every 30 seconds) while app is open
    const reminderInterval = setInterval(() => {
      checkAndTriggerDailyReminder((title, message) => {
        setUserAlertToast({
          title,
          message,
          type: 'info',
          details: 'ডেইলি বোনাস ও লাকি স্পিন পেতে বোনাস বাটনে চাপুন।',
        });
      });
    }, 30000);

    return () => clearInterval(reminderInterval);
  }, [showSplash]);

  // Check unclaimed bonus status safely in an effect instead of calling loadBonusState during render
  useEffect(() => {
    const checkBonus = () => {
      try {
        setHasUnclaimedBonus(isDailyBonusAvailable(currentUser?.uid) || isSpinAvailable(currentUser?.uid));
      } catch {}
    };
    checkBonus();
    const handleBonusEvent = () => checkBonus();
    window.addEventListener('skywin_bonus_state_updated', handleBonusEvent);
    return () => window.removeEventListener('skywin_bonus_state_updated', handleBonusEvent);
  }, [currentUser?.uid, isBonusHubOpen, isSpinnerOpen]);

  // 4. Admin Broadcast Notification Live Listener (Requirement 4: "এডমিন প্যানেলে অপশন থাকবে: ইউজারকে নটিফিকেশন পাঠান")
  useEffect(() => {
    const unsub = listenToBroadcastNotifications((notifs) => {
      if (!notifs || notifs.length === 0) return;

      const latest = notifs[0]; // Most recent notification
      const lastSeenId = getLastSeenBroadcastId();

      // On initial app load: if latest was sent recently (within last 30 minutes) and not seen, or on subsequent updates
      if (isInitialBroadcastLoadRef.current) {
        isInitialBroadcastLoadRef.current = false;
        const now = Date.now();
        const isRecent = now - latest.sentAt < 30 * 60 * 1000;
        if (latest.id !== lastSeenId && isRecent) {
          setLastSeenBroadcastId(latest.id);
          soundManager.playNotificationChime();
          setActiveBroadcastNotice(latest);
        }
      } else {
        // Live incoming notification sent by admin
        if (latest.id !== lastSeenId) {
          setLastSeenBroadcastId(latest.id);
          soundManager.playNotificationChime();
          setActiveBroadcastNotice(latest);

          // Trigger native Web Notification if permitted
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(latest.title, {
                body: latest.message,
                icon: '/pwa-192x192.png',
                badge: '/pwa-192x192.png',
                tag: latest.id,
              });
            } catch {}
          }
        }
      }
    });

    return () => unsub();
  }, []);

  // Generate Provably Fair Crash Multiplier with Smart New-User Algorithm
  // Rule (Per User Instruction):
  // 1. New user starts with 100 bonus - this 100 MUST NOT be lost at the start!
  // Generate Provably Fair Crash Multiplier with House Protection Algorithm
  // Rule (Per User Instruction):
  // ১। ডিপোজিট ছাড়া ইউজার কখনই বড় উইন বা ক্যাশআউট করতে পারবে না
  // ২। "ইউজার কখনই এডমিন থেকে বেশি জয়ী হবে না":
  //    - যদি ইউজার নেট লাভে থাকে (balance >= totalDeposited), বিমান অবিলম্বে ১.০২x - ১.১৮x এ ক্র্যাশ করবে বা অটো-ক্যাশআউটের আগেই ফেল করবে।
  //    - ডিপোজিট করার পর ইউজার ডিপোজিটের চেয়ে বেশি জিতে এডমিনকে হারাতে পারবে না।
  // ৬। যখন সে খেলা চলাকালীন ক্যাশআউট দেয়, ঐ সময় ক্যাশআউট এর পর বিমান ৫০%, ১০০% পর্যন্ত উড়তে থাকবে।
  // ৭। যেই মুহূর্তে বাজি ধরবে না সেই মুহূর্তে বিমান সর্বোচ্চ ১০০% পর্যন্ত উড়বে।
  const generateNewCrashPoint = useCallback((): number => {
    const currentBet1 = bet1StateRef.current;
    const currentBet2 = bet2StateRef.current;
    const hasPlacedBet = (currentBet1.isPlaced && !currentBet1.cashedOut) || (currentBet2.isPlaced && !currentBet2.cashedOut);
    const hasDeposited = (userProfileRef.current?.totalDeposited || 0) > 0 || Boolean((userProfileRef.current as any)?.hasDeposited);
    const currentBal = balanceRef.current;
    const totalStake = (currentBet1.isPlaced ? currentBet1.amount : 0) + (currentBet2.isPlaced ? currentBet2.amount : 0);
    const liveControls = appControlsRef.current;

    // Admin One-Shot Forced Crash Point Override (takes top priority except Invite Bonus non-profit protection)
    const usesInviteBonus =
      (currentBet1.isPlaced && !currentBet1.cashedOut && (currentBet1.inviteBonusStake || 0) > 0) ||
      (currentBet2.isPlaced && !currentBet2.cashedOut && (currentBet2.inviteBonusStake || 0) > 0);
    if (usesInviteBonus) {
      // Strict 100% Invite Bonus Non-Profit Enforcement:
      // "বি:দ্র: সেই টাকা যেমন উঠাতে পারবে না, তেমনি সেই টাকা দিয়ে সে কখনই লাভবান ও হতে পারবে না।"
      return 1.00;
    }

    if (
      liveControls.aviatorForceCrashMultiplier !== null &&
      Number.isFinite(liveControls.aviatorForceCrashMultiplier)
    ) {
      const forced = Math.min(100.00, Math.max(1.00, liveControls.aviatorForceCrashMultiplier));
      clearAviatorForceCrash();
      return forced;
    }

    // Requirement 7: When user does NOT place any bet in this round, the plane flies up to 100x!
    if (!hasPlacedBet) {
      const randHigh = Math.random();
      let highPoint = 20.0;
      if (randHigh < 0.35) {
        // 35% chance: 20x to 50x
        highPoint = +(20.0 + Math.random() * 30.0).toFixed(2);
      } else if (randHigh < 0.75) {
        // 40% chance: 50x to 85x
        highPoint = +(50.0 + Math.random() * 35.0).toFixed(2);
      } else {
        // 25% chance: 85x to 100.00x
        highPoint = +(85.0 + Math.random() * 15.0).toFixed(2);
      }
      return Math.min(100.00, Math.max(18.00, highPoint));
    }

    // Admin Strict House Mode: crash early on almost every placed bet
    if (liveControls.aviatorHouseMode === 'strict') {
      const strictCrash = +(1.01 + Math.random() * 0.14).toFixed(2); // 1.01x - 1.15x
      return Math.min(1.15, Math.max(1.00, strictCrash));
    }

    // Requirement 1 & 5: Without deposit, user plays with bonus:
    // "বোনাস পাওয়া টাকা দিয়ে যদি বড় দান ধরে সেটা 1.2% এই বিমান ফেল করবে। যেন সে লাভবান হয়ে টাকা উইথড্র দিতে না পারে।"
    if (!hasDeposited) {
      const isBigBet = totalStake >= 100; // Large bet with bonus funds
      if (isBigBet) {
        // Strict crash at strictly <= 1.20x!
        const earlyFail = +(1.02 + Math.random() * 0.17).toFixed(2); // 1.02x to 1.19x
        return Math.min(1.20, Math.max(1.01, earlyFail));
      }

      // If balance grew towards 350+, crash early to prevent accumulating profits
      if (currentBal >= 350) {
        const lossPoint = +(1.02 + Math.random() * 0.15).toFixed(2); // 1.02x to 1.17x
        return Math.min(1.18, Math.max(1.01, lossPoint));
      }

      // Small beginner trial for initial 100 bonus (only for tiny bets < 100 BDT)
      const point = +(2.10 + Math.random() * 2.8).toFixed(2);
      return Math.min(4.80, Math.max(2.10, point));
    }

    // ==================== Requirement 2: House Always Wins Protection ====================
    // "২। ইউজার কখনই এডমিন থেকে বেশি জয়ী হবে না।"
    const totalDeposited = userProfileRef.current?.totalDeposited || 0;
    const isNetProfit = currentBal >= totalDeposited; // User is in net profit compared to their deposit
    const isCloseToProfit = currentBal >= totalDeposited * 0.85;

    // Detect user's auto-cashout multiplier targets if configured
    const autoCashouts: number[] = [];
    if (currentBet1.isPlaced && currentBet1.isAutoCashOut && currentBet1.autoCashOutMultiplier > 1.01) {
      autoCashouts.push(currentBet1.autoCashOutMultiplier);
    }
    if (currentBet2.isPlaced && currentBet2.isAutoCashOut && currentBet2.autoCashOutMultiplier > 1.01) {
      autoCashouts.push(currentBet2.autoCashOutMultiplier);
    }
    const minAutoCashout = autoCashouts.length > 0 ? Math.min(...autoCashouts) : null;

    if (liveControls.aviatorHouseMode !== 'relaxed' && isNetProfit) {
      // User is already equal to or in profit beyond their deposits:
      // House protection triggers! Plane crashes early so user loses this bet.
      if (minAutoCashout !== null && minAutoCashout > 1.04) {
        // Strict: Crash just before user's auto-cashout target
        const crashBefore = +(minAutoCashout - 0.05 - Math.random() * 0.08).toFixed(2);
        return Math.min(1.18, Math.max(1.01, crashBefore));
      }
      const earlyCrash = +(1.02 + Math.random() * 0.15).toFixed(2); // 1.02x to 1.17x
      return Math.min(1.18, Math.max(1.01, earlyCrash));
    }

    if (liveControls.aviatorHouseMode !== 'relaxed' && isCloseToProfit) {
      // User is nearing deposit amount: limit multiplier strictly so they don't surpass admin
      if (minAutoCashout !== null && minAutoCashout >= 1.25) {
        return Math.min(1.20, +(1.03 + Math.random() * 0.16).toFixed(2));
      }
      const rand = Math.random();
      if (rand < 0.75) {
        return +(1.03 + Math.random() * 0.17).toFixed(2);
      }
      return +(1.22 + Math.random() * 0.18).toFixed(2);
    }

    // Standard Real Deposit Distribution (Realistic fair distribution when user is behind/negative)
    const rand = Math.random();
    let point = 1.0;
    if (rand < 0.12) point = +(1.0 + Math.random() * 0.12).toFixed(2);
    else if (rand < 0.55) point = +(1.15 + Math.random() * 0.9).toFixed(2);
    else if (rand < 0.85) point = +(2.1 + Math.random() * 3.4).toFixed(2);
    else if (rand < 0.96) point = +(5.5 + Math.random() * 12.0).toFixed(2);
    else point = +(18.0 + Math.random() * 55.0).toFixed(2); // up to 100.00x!

    return Math.min(100.00, Math.max(1.00, point));
  }, []);

  // Generate simulated players for each round (Fluctuating player count: sometimes 13, sometimes much more, sometimes less)
  const generateSimulatedPlayers = useCallback(() => {
    const allNames = [
      'Shanto_Vai', 'Shakib_75', 'Tamim_BD', 'Rahim_VIP', 'Priya_Queen',
      'Tanvir_Pro', 'Rony_Dhaka', 'Sumon_Trader', 'Mehedi_Winner', 'Anik_99',
      'Arif_Chittagong', 'Nusrat_Win', 'Rakib_Gamer', 'Hasan_King', 'Siam_786',
      'Fahim_BD', 'Alomgir_Boss', 'Zahid_Winner', 'Munna_Star', 'Sujon_Pro',
      'Biplob_Vai', 'Nayeem_Dhaka', 'Kazol_Sylhet', 'Jamil_99', 'Akash_Blue',
      'Rubel_Hossain', 'Nazmul_Smart', 'Imran_CTG', 'Shohel_Rana', 'Babul_Master',
      'Faruk_Knight', 'Ashik_Player', 'Shahadat_Win', 'Robin_Lucky', 'Selim_Boss',
      'Apon_BD', 'Emon_King', 'Shimul_Trader', 'Jewel_Pro', 'Rasel_Vip',
      'Mithun_Dhaka', 'Masud_Win', 'Joy_777', 'Ripon_Master', 'Shamim_Gold',
      'Habib_BD', 'Sabbir_Pro', 'Nahid_King', 'Kamrul_VIP', 'Liton_Das',
      'Soumya_77', 'Mustafiz_Cutter', 'Taskin_Speed', 'Mahmudullah_Cool', 'Miraz_Allrounder',
      'Afif_Fire', 'Towhid_Hridoy', 'Shoriful_Left', 'Nasum_Spin', 'Rishad_Power',
      'Tanzid_Tamim', 'Zakir_Opener', 'Ebadot_Salute', 'Taijul_Magic', 'Khaled_Pace',
      'Parvez_Emon', 'Shamim_Patwary', 'Jaker_Ali', 'Tanzim_Sakib', 'Hasan_Mahmud'
    ];
    const stakes = [50, 100, 200, 500, 1000, 2000, 5000];

    // Pick 40 to 60 players for the scrollable live table
    const count = Math.floor(40 + Math.random() * 22);

    // Shuffle and pick `count` names
    const shuffled = [...allNames].sort(() => 0.5 - Math.random()).slice(0, count);

    const players: LivePlayerBet[] = shuffled.map((name, idx) => ({
      id: `p-${idx}-${Date.now()}`,
      playerName: name,
      avatarSeed: name,
      betAmount: stakes[Math.floor(Math.random() * stakes.length)],
      cashedOut: false,
    }));
    setLivePlayers(players);
  }, []);

  // Track completed rounds to only update simulated player count every 3 completed games
  const completedRoundsCountRef = useRef<number>(0);

  // Reset simulated players for next round (retains exact same players and count across 3 consecutive rounds)
  const resetSimulatedPlayersForNextRound = useCallback(() => {
    const stakes = [50, 100, 200, 500, 1000, 2000, 5000];
    setLivePlayers((prev) =>
      prev.map((p) => ({
        ...p,
        cashedOut: false,
        cashedOutMultiplier: undefined,
        winAmount: undefined,
        betAmount: stakes[Math.floor(Math.random() * stakes.length)],
      }))
    );
  }, []);

  // Cash out handler for Panel 1 (strictly executed once)
  const handleCashOutPanel1 = useCallback((multiplierSnapshot?: unknown) => {
    if (bet1CashedOutRef.current) return;
    const currentBet = bet1StateRef.current;
    if (!currentBet.isPlaced || currentBet.cashedOut) return;

    bet1CashedOutRef.current = true;
    const mult =
      typeof multiplierSnapshot === 'number' && Number.isFinite(multiplierSnapshot)
        ? multiplierSnapshot
        : (currentMultiplierRef.current || 1.0);

    const win = Math.round(currentBet.amount * mult * 100) / 100;
    const actualWin = win;

    soundManager.playWin();

    setBet1((prev) => ({
      ...prev,
      cashedOut: true,
      cashedOutMultiplier: mult,
      winAmount: actualWin,
    }));

    updateBalanceAndSync((prev) => prev + actualWin);

    // Ironclad safety net: if any invite bonus stake was ever cashed out, lock its entire return back into inviteBonusBalance
    if (currentBet.inviteBonusStake && currentBet.inviteBonusStake > 0 && currentBet.amount > 0) {
      const ratio = Math.min(1, currentBet.inviteBonusStake / currentBet.amount);
      const inviteReturned = Math.round(actualWin * ratio * 100) / 100;
      if (inviteReturned > 0) {
        adjustInviteBonusBalance(inviteReturned, inviteReturned);
      }
    }

    // Requirement 6: "যখন সে খেলা চলাকালিন ক্যাশআউট দেয় ঐ সময় ক্যাশআউট এর পর বিমান ৫০%, ১০০% পর্যন্ত উড়তে থাকবে।"
    const isOtherBetActive1 = bet2StateRef.current.isPlaced && !bet2CashedOutRef.current;
    if (!isOtherBetActive1) {
      const highFlyTarget = +(50.0 + Math.random() * 50.0).toFixed(2);
      crashTargetRef.current = Math.min(100.00, Math.max(50.00, highFlyTarget));
    }

    // Record user bet history
    recordUserBet({
      userId: currentUser?.uid || 'guest',
      userCode: userProfile?.userCode || currentUser?.userCode,
      gameType: 'aviator',
      stake: currentBet.amount,
      multiplier: mult,
      payout: actualWin,
      outcome: 'won',
    });

    if (currentUser && currentUser.provider === 'google') {
      recordBetHistory(currentUser.uid, 'aviator', currentBet.amount, mult, actualWin, 'won');
    }
    setWinNotification({ amount: actualWin, multiplier: mult });

    setMyBetHistory((prev) => [
      {
        id: `my-${Date.now()}-1`,
        amount: currentBet.amount,
        multiplier: mult,
        winAmount: actualWin,
        timestamp: Date.now(),
      },
      ...prev.slice(0, 19),
    ]);
  }, [updateBalanceAndSync, adjustInviteBonusBalance, currentUser, userProfile, balance]);

  // Cash out handler for Panel 2 (strictly executed once)
  const handleCashOutPanel2 = useCallback((multiplierSnapshot?: unknown) => {
    if (bet2CashedOutRef.current) return;
    const currentBet = bet2StateRef.current;
    if (!currentBet.isPlaced || currentBet.cashedOut) return;

    bet2CashedOutRef.current = true;
    const mult =
      typeof multiplierSnapshot === 'number' && Number.isFinite(multiplierSnapshot)
        ? multiplierSnapshot
        : (currentMultiplierRef.current || 1.0);

    const win = Math.round(currentBet.amount * mult * 100) / 100;
    const actualWin = win;

    soundManager.playWin();

    setBet2((prev) => ({
      ...prev,
      cashedOut: true,
      cashedOutMultiplier: mult,
      winAmount: actualWin,
    }));

    updateBalanceAndSync((prev) => prev + actualWin);

    // Ironclad safety net: if any invite bonus stake was ever cashed out, lock its entire return back into inviteBonusBalance
    if (currentBet.inviteBonusStake && currentBet.inviteBonusStake > 0 && currentBet.amount > 0) {
      const ratio = Math.min(1, currentBet.inviteBonusStake / currentBet.amount);
      const inviteReturned = Math.round(actualWin * ratio * 100) / 100;
      if (inviteReturned > 0) {
        adjustInviteBonusBalance(inviteReturned, inviteReturned);
      }
    }

    // Requirement 6: "যখন সে খেলা চলাকালিন ক্যাশআউট দেয় ঐ সময় ক্যাশআউট এর পর বিমান ৫০%, ১০০% পর্যন্ত উড়তে থাকবে।"
    const isOtherBetActive2 = bet1StateRef.current.isPlaced && !bet1CashedOutRef.current;
    if (!isOtherBetActive2) {
      const highFlyTarget = +(50.0 + Math.random() * 50.0).toFixed(2);
      crashTargetRef.current = Math.min(100.00, Math.max(50.00, highFlyTarget));
    }

    // Record user bet history
    recordUserBet({
      userId: currentUser?.uid || 'guest',
      userCode: userProfile?.userCode || currentUser?.userCode,
      gameType: 'aviator',
      stake: currentBet.amount,
      multiplier: mult,
      payout: actualWin,
      outcome: 'won',
    });

    if (currentUser && currentUser.provider === 'google') {
      recordBetHistory(currentUser.uid, 'aviator', currentBet.amount, mult, actualWin, 'won');
    }
    setWinNotification({ amount: actualWin, multiplier: mult });

    setMyBetHistory((prev) => [
      {
        id: `my-${Date.now()}-2`,
        amount: currentBet.amount,
        multiplier: mult,
        winAmount: actualWin,
        timestamp: Date.now(),
      },
      ...prev.slice(0, 19),
    ]);
  }, [updateBalanceAndSync, adjustInviteBonusBalance, currentUser, userProfile, balance]);

  // Main Game Loop: WAITING -> FLYING -> CRASHED
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    if (roundStatus === 'WAITING') {
      soundManager.stopEngineSound();
      setCurrentMultiplier(1.0);
      currentMultiplierRef.current = 1.0;
      bet1CashedOutRef.current = false;
      bet2CashedOutRef.current = false;

      // Update simulated players count only after at least 3 completed games finish (or on initial round)
      completedRoundsCountRef.current += 1;
      if (completedRoundsCountRef.current === 1 || completedRoundsCountRef.current % 3 === 1) {
        generateSimulatedPlayers();
      } else {
        resetSimulatedPlayersForNextRound();
      }

      // Check auto bets (Strict: Only if user has account!)
      const hasDepositedAuto = Boolean(
        userProfileRef.current?.hasDeposited ||
        (userProfileRef.current?.totalDeposited && userProfileRef.current.totalDeposited > 0)
      );
      let availBal = balance;
      let availInvite = inviteBonusBalanceRef.current;

      if (currentUser && bet1.isAutoBet && !bet1.isPlaced && availBal >= bet1.amount) {
        const inviteUsed1 = computeInviteBonusStake({
          totalBalance: availBal,
          inviteBonusBalance: availInvite,
          stake: bet1.amount,
          hasDeposited: hasDepositedAuto,
        });
        availBal = Math.max(0, Math.round((availBal - bet1.amount) * 100) / 100);
        availInvite = Math.max(0, Math.round((availInvite - inviteUsed1) * 100) / 100);
        updateBalanceAndSync((prev) => prev - bet1.amount);
        if (inviteUsed1 > 0) {
          adjustInviteBonusBalance(-inviteUsed1, -inviteUsed1);
        }
        setBet1((prev) => ({
          ...prev,
          isPlaced: true,
          cashedOut: false,
          winAmount: null,
          inviteBonusStake: inviteUsed1,
        }));
      }
      if (currentUser && bet2.isAutoBet && !bet2.isPlaced && availBal >= bet2.amount) {
        const inviteUsed2 = computeInviteBonusStake({
          totalBalance: availBal,
          inviteBonusBalance: availInvite,
          stake: bet2.amount,
          hasDeposited: hasDepositedAuto,
        });
        availBal = Math.max(0, Math.round((availBal - bet2.amount) * 100) / 100);
        availInvite = Math.max(0, Math.round((availInvite - inviteUsed2) * 100) / 100);
        updateBalanceAndSync((prev) => prev - bet2.amount);
        if (inviteUsed2 > 0) {
          adjustInviteBonusBalance(-inviteUsed2, -inviteUsed2);
        }
        setBet2((prev) => ({
          ...prev,
          isPlaced: true,
          cashedOut: false,
          winAmount: null,
          inviteBonusStake: inviteUsed2,
        }));
      }

      // 5-second countdown
      const startTime = Date.now();
      const interval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const remain = Math.max(0, 5.0 - elapsed);
        setWaitingCountdown(remain);

        if (remain <= 0) {
          clearInterval(interval);
          // Transition to FLYING
          const nextCrash = generateNewCrashPoint();
          crashTargetRef.current = nextCrash;
          setFinalCrashMultiplier(nextCrash);
          setRoundStatus('FLYING');
          soundManager.startEngineSound();
          flightStartTimeRef.current = Date.now();
        }
      }, 50);

      return () => clearInterval(interval);
    }

    if (roundStatus === 'FLYING') {
      let isFlying = true;

      const flyLoop = () => {
        if (!isFlying) return;

        const timeInSeconds = (Date.now() - flightStartTimeRef.current) / 1000;
        // Aviator exponential curve formula: multiplier grows smoothly
        const mult = 1.0 + 0.07 * timeInSeconds + 0.06 * Math.pow(timeInSeconds, 1.8);
        const roundedMult = Math.min(100.00, Math.round(mult * 100) / 100);
        currentMultiplierRef.current = roundedMult;

        soundManager.updateEnginePitch(roundedMult);

        // Check if other simulated players cash out
        setLivePlayers((prev) =>
          prev.map((p) => {
            if (!p.cashedOut && Math.random() < 0.02 && roundedMult < crashTargetRef.current) {
              return {
                ...p,
                cashedOut: true,
                cashedOutMultiplier: roundedMult,
                winAmount: Math.round(p.betAmount * roundedMult),
              };
            }
            return p;
          })
        );

        // Check Auto Cash Out Panel 1 (strictly once, only if below crash target and not using invite bonus)
        if (
          !bet1CashedOutRef.current &&
          bet1StateRef.current.isPlaced &&
          !bet1StateRef.current.cashedOut &&
          bet1StateRef.current.isAutoCashOut &&
          !(bet1StateRef.current.inviteBonusStake && bet1StateRef.current.inviteBonusStake > 0) &&
          bet1StateRef.current.autoCashOutMultiplier < crashTargetRef.current &&
          roundedMult >= bet1StateRef.current.autoCashOutMultiplier
        ) {
          handleCashOutPanel1(bet1StateRef.current.autoCashOutMultiplier);
        }

        // Check Auto Cash Out Panel 2 (strictly once, only if below crash target and not using invite bonus)
        if (
          !bet2CashedOutRef.current &&
          bet2StateRef.current.isPlaced &&
          !bet2StateRef.current.cashedOut &&
          bet2StateRef.current.isAutoCashOut &&
          !(bet2StateRef.current.inviteBonusStake && bet2StateRef.current.inviteBonusStake > 0) &&
          bet2StateRef.current.autoCashOutMultiplier < crashTargetRef.current &&
          roundedMult >= bet2StateRef.current.autoCashOutMultiplier
        ) {
          handleCashOutPanel2(bet2StateRef.current.autoCashOutMultiplier);
        }

        if (roundedMult >= crashTargetRef.current || roundedMult >= 100.00) {
          // CRASH EVENT! (Capped strictly at max 100x)
          isFlying = false;
          setCurrentMultiplier(Math.min(100.00, crashTargetRef.current));
          soundManager.playCrash();
          setRoundStatus('CRASHED');

          // Record lost bets
          if (bet1.isPlaced && !bet1.cashedOut) {
            recordUserBet({
              userId: currentUser?.uid || 'guest',
              userCode: userProfile?.userCode || currentUser?.userCode,
              gameType: 'aviator',
              stake: bet1.amount,
              multiplier: null,
              payout: 0,
              outcome: 'lost',
            });
            setMyBetHistory((h) => [
              { id: `lost-${Date.now()}-1`, amount: bet1.amount, multiplier: null, winAmount: null, timestamp: Date.now() },
              ...h.slice(0, 19),
            ]);
          }
          if (bet2.isPlaced && !bet2.cashedOut) {
            recordUserBet({
              userId: currentUser?.uid || 'guest',
              userCode: userProfile?.userCode || currentUser?.userCode,
              gameType: 'aviator',
              stake: bet2.amount,
              multiplier: null,
              payout: 0,
              outcome: 'lost',
            });
            setMyBetHistory((h) => [
              { id: `lost-${Date.now()}-2`, amount: bet2.amount, multiplier: null, winAmount: null, timestamp: Date.now() },
              ...h.slice(0, 19),
            ]);
          }

          // Add to multiplier history
          setHistory((prev) => [
            {
              id: String(Date.now()),
              crashMultiplier: crashTargetRef.current,
              timestamp: Date.now(),
              hash: 'sha256_' + Math.random().toString(36).substring(2, 15),
            },
            ...prev.slice(0, 19),
          ]);

          return;
        }

        setCurrentMultiplier(roundedMult);
        animFrameIdRef.current = requestAnimationFrame(flyLoop);
      };

      animFrameIdRef.current = requestAnimationFrame(flyLoop);

      return () => {
        isFlying = false;
        if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      };
    }

    if (roundStatus === 'CRASHED') {
      // Stay on crashed screen for 2.8 seconds, then reset for next round
      timer = setTimeout(() => {
        setBet1((prev) => ({
          ...prev,
          isPlaced: false,
          cashedOut: false,
          cashedOutMultiplier: null,
          winAmount: null,
          inviteBonusStake: 0,
        }));
        setBet2((prev) => ({
          ...prev,
          isPlaced: false,
          cashedOut: false,
          cashedOutMultiplier: null,
          winAmount: null,
          inviteBonusStake: 0,
        }));
        setRoundStatus('WAITING');
      }, 2800);

      return () => {
        if (timer) clearTimeout(timer);
      };
    }
  }, [
    roundStatus,
    bet1.isPlaced,
    bet1.cashedOut,
    bet1.isAutoCashOut,
    bet1.autoCashOutMultiplier,
    bet1.isAutoBet,
    bet2.isPlaced,
    bet2.cashedOut,
    bet2.isAutoCashOut,
    bet2.autoCashOutMultiplier,
    bet2.isAutoBet,
    balance,
    generateNewCrashPoint,
    generateSimulatedPlayers,
    handleCashOutPanel1,
    handleCashOutPanel2,
  ]);

  // Auth requirement notification trigger
  const handleRequireAuth = useCallback((message: string) => {
    soundManager.playCrash();
    setAuthNoticeMessage(message);
    setIsAuthOpen(true);
  }, []);

  // Check active account suspension status (Requirement 3: Temporary suspension or Permanent ban)
  const suspensionInfo = checkAccountSuspensionStatus(userProfile || currentUser);

  const handleLogoutAccount = useCallback(() => {
    soundManager.playClick();
    logoutPhoneSession();
    setCurrentUser(null);
    setUserProfile(null);
    setBalance(0);
    setIsSideDrawerOpen(false);
  }, []);

  // Guarded Deposit & Withdraw handlers (Strict: Must have an account and not be suspended!)
  const handleOpenDeposit = useCallback(() => {
    if (!currentUser) {
      handleRequireAuth('এড মানি (রিচার্জ) করতে হলে প্রথমে আপনার একটি একাউন্ট তৈরি বা লগইন করতে হবে!');
      return;
    }
    if (suspensionInfo.isDeactivated) {
      soundManager.playCrash();
      setUserAlertToast({
        title: suspensionInfo.isBanned ? 'একাউন্ট ব্যান করা হয়েছে' : 'একাউন্ট সাময়িকভাবে স্থগিত',
        message: suspensionInfo.reason || 'আপনার একাউন্টটির কার্যক্রম স্থগিত রাখা হয়েছে।',
        type: 'error',
      });
      return;
    }
    if (!appControlsRef.current.depositsEnabled) {
      soundManager.playCrash();
      setUserAlertToast({
        title: 'ডিপোজিট সাময়িকভাবে বন্ধ',
        message: 'এডমিন কর্তৃক ডিপোজিট সার্ভিস সাময়িকভাবে বন্ধ রাখা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
        type: 'warning',
      });
      return;
    }
    setWalletTab('deposit');
    setIsDepositOpen(true);
  }, [currentUser, suspensionInfo, handleRequireAuth]);

  const handleOpenWithdraw = useCallback(() => {
    if (!currentUser) {
      handleRequireAuth('টাকা উইথড্র করতে হলে প্রথমে আপনার একটি একাউন্ট তৈরি বা লগইন করতে হবে!');
      return;
    }
    if (suspensionInfo.isDeactivated) {
      soundManager.playCrash();
      setUserAlertToast({
        title: suspensionInfo.isBanned ? 'একাউন্ট ব্যান করা হয়েছে' : 'একাউন্ট সাময়িকভাবে স্থগিত',
        message: suspensionInfo.reason || 'আপনার একাউন্টটির কার্যক্রম স্থগিত রাখা হয়েছে।',
        type: 'error',
      });
      return;
    }
    if (!appControlsRef.current.withdrawalsEnabled) {
      soundManager.playCrash();
      setUserAlertToast({
        title: 'উইথড্র সাময়িকভাবে বন্ধ',
        message: 'এডমিন কর্তৃক উত্তোলন সার্ভিস সাময়িকভাবে বন্ধ রাখা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
        type: 'warning',
      });
      return;
    }
    setWalletTab('withdraw');
    setIsDepositOpen(true);
  }, [currentUser, suspensionInfo, handleRequireAuth]);

  // Place Bet actions (Strict: No bets allowed without an account or if deactivated!)
  const handlePlaceBetPanel1 = (amount: number) => {
    if (!currentUser) {
      handleRequireAuth('বেট ধরার জন্য আপনাকে অবশ্যই একাউন্ট তৈরি বা লগইন করতে হবে!');
      return;
    }
    if (suspensionInfo.isDeactivated) {
      soundManager.playCrash();
      setUserAlertToast({
        title: suspensionInfo.isBanned ? 'একাউন্ট ব্যান' : 'একাউন্ট স্থগিত',
        message: suspensionInfo.reason || 'স্থগিত থাকা অবস্থায় বাজি ধরা যাবে না।',
        type: 'error',
      });
      return;
    }
    if (roundStatus !== 'WAITING') return; // Strict: No bets allowed during flight or crash!
    if (balance < amount) return;
    soundManager.playClick();
    bet1CashedOutRef.current = false;
    const hasDeposited1 = Boolean(
      userProfile?.hasDeposited || (userProfile?.totalDeposited && userProfile.totalDeposited > 0)
    );
    const inviteUsed1 = computeInviteBonusStake({
      totalBalance: balanceRef.current,
      inviteBonusBalance: inviteBonusBalanceRef.current,
      stake: amount,
      hasDeposited: hasDeposited1,
    });
    updateBalanceAndSync((prev) => prev - amount);
    if (inviteUsed1 > 0) {
      adjustInviteBonusBalance(-inviteUsed1, -inviteUsed1);
    }
    setBet1((prev) => ({
      ...prev,
      amount,
      isPlaced: true,
      cashedOut: false,
      winAmount: null,
      inviteBonusStake: inviteUsed1,
    }));
  };

  const handleCancelBetPanel1 = () => {
    if (!bet1.isPlaced || roundStatus !== 'WAITING') return;
    soundManager.playClick();
    bet1CashedOutRef.current = false;
    updateBalanceAndSync((prev) => prev + bet1.amount);
    if (bet1.inviteBonusStake && bet1.inviteBonusStake > 0) {
      adjustInviteBonusBalance(bet1.inviteBonusStake, bet1.inviteBonusStake);
    }
    setBet1((prev) => ({ ...prev, isPlaced: false, inviteBonusStake: 0 }));
  };

  const handlePlaceBetPanel2 = (amount: number) => {
    if (!currentUser) {
      handleRequireAuth('বেট ধরার জন্য আপনাকে অবশ্যই একাউন্ট তৈরি বা লগইন করতে হবে!');
      return;
    }
    if (suspensionInfo.isDeactivated) {
      soundManager.playCrash();
      setUserAlertToast({
        title: suspensionInfo.isBanned ? 'একাউন্ট ব্যান' : 'একাউন্ট স্থগিত',
        message: suspensionInfo.reason || 'স্থগিত থাকা অবস্থায় বাজি ধরা যাবে না।',
        type: 'error',
      });
      return;
    }
    if (roundStatus !== 'WAITING') return; // Strict: No bets allowed during flight or crash!
    if (balance < amount) return;
    soundManager.playClick();
    bet2CashedOutRef.current = false;
    const hasDeposited2 = Boolean(
      userProfile?.hasDeposited || (userProfile?.totalDeposited && userProfile.totalDeposited > 0)
    );
    const inviteUsed2 = computeInviteBonusStake({
      totalBalance: balanceRef.current,
      inviteBonusBalance: inviteBonusBalanceRef.current,
      stake: amount,
      hasDeposited: hasDeposited2,
    });
    updateBalanceAndSync((prev) => prev - amount);
    if (inviteUsed2 > 0) {
      adjustInviteBonusBalance(-inviteUsed2, -inviteUsed2);
    }
    setBet2((prev) => ({
      ...prev,
      amount,
      isPlaced: true,
      cashedOut: false,
      winAmount: null,
      inviteBonusStake: inviteUsed2,
    }));
  };

  const handleCancelBetPanel2 = () => {
    if (!bet2.isPlaced || roundStatus !== 'WAITING') return;
    soundManager.playClick();
    bet2CashedOutRef.current = false;
    updateBalanceAndSync((prev) => prev + bet2.amount);
    if (bet2.inviteBonusStake && bet2.inviteBonusStake > 0) {
      adjustInviteBonusBalance(bet2.inviteBonusStake, bet2.inviteBonusStake);
    }
    setBet2((prev) => ({ ...prev, isPlaced: false, inviteBonusStake: 0 }));
  };

  const handleOpenBonusHub = useCallback(() => {
    if (!appControlsRef.current.dailyBonusEnabled && !appControlsRef.current.inviteBonusEnabled) {
      setUserAlertToast({
        title: 'বোনাস সাময়িকভাবে বন্ধ',
        message: 'বোনাস হাব বর্তমানে এডমিন কর্তৃক সাময়িকভাবে বন্ধ রাখা হয়েছে।',
        type: 'info',
      });
      return;
    }
    setIsBonusHubOpen(true);
  }, []);

  const handleOpenSpinner = useCallback(() => {
    if (!appControlsRef.current.luckySpinnerEnabled) {
      setUserAlertToast({
        title: 'লাকি স্পিনার বন্ধ আছে',
        message: 'লাকি স্পিনার বর্তমানে এডমিন কর্তৃক সাময়িকভাবে বন্ধ রাখা হয়েছে।',
        type: 'info',
      });
      return;
    }
    setIsSpinnerOpen(true);
  }, []);

  const handleTogglePredictor = useCallback(() => {
    if (!appControlsRef.current.aiPredictorEnabled) {
      setIsPredictorOpen(false);
      setUserAlertToast({
        title: 'AI সিগন্যাল বন্ধ আছে',
        message: 'AI সিগন্যাল প্রেডিক্টর বর্তমানে এডমিন কর্তৃক বন্ধ রাখা হয়েছে।',
        type: 'info',
      });
      return;
    }
    setIsPredictorOpen((prev) => !prev);
  }, []);

  // Complete Direct Exit: Closes app and returns straight to mobile's default home screen without looping
  const handleExitApp = useCallback(() => {
    isExitingRef.current = true;
    soundManager.stopEngineSound();
    setIsExitModalOpen(false);
    setBackPressToast(null);

    // 1. Android APK native JavaScript interfaces (from Android Studio / WebView wrappers)
    try {
      const win = window as any;
      if (win.Android?.exitApp) { win.Android.exitApp(); return; }
      if (win.Android?.finish) { win.Android.finish(); return; }
      if (win.Android?.closeApp) { win.Android.closeApp(); return; }
      if (win.android?.exitApp) { win.android.exitApp(); return; }
      if (win.android?.finish) { win.android.finish(); return; }
      if (win.navigator?.app?.exitApp) { win.navigator.app.exitApp(); return; }
      if (win.JSBridge?.closeWindow) { win.JSBridge.closeWindow(); return; }
    } catch {}

    // 2. Standard window.close()
    try {
      window.close();
    } catch {}

    // 3. Set clean App Closed State (Clean native-like closed state, zero loops)
    setIsAppClosed(true);
  }, []);

  const handleOpenAdminPanelWithTab = (tab?: 'requests' | 'withdrawals') => {
    if (!isUserAdminAccount(currentUser?.phoneNumber)) return;
    if (tab) setAdminPanelInitialTab(tab);
    setIsAdminOpen(true);
  };

  useEffect(() => {
    if (!isUserAdminAccount(currentUser?.phoneNumber) && isAdminOpen) {
      setIsAdminOpen(false);
    }
  }, [currentUser?.phoneNumber, isAdminOpen]);

  // Clean Native-like App Closed Screen (like Facebook, YouTube exit on phone)
  if (isAppClosed) {
    return (
      <div className="min-h-screen bg-[#070a12] text-white flex flex-col items-center justify-center p-6 text-center select-none font-sans">
        <div className="w-16 h-16 rounded-full bg-red-600/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-4 shadow-xl">
          <LogOut className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">অ্যাপটি বন্ধ হয়েছে</h2>
        <p className="text-xs text-slate-400 max-w-xs mb-6">
          ধন্যবাদ! আপনি নিরাপদে অ্যাপ থেকে প্রস্থান করেছেন। আপনি চাইলে ব্রাউজার ট্যাব বন্ধ করতে পারেন অথবা নিচে চাপ দিয়ে পুনরায় অ্যাপ চালু করতে পারেন।
        </p>
        <button
          onClick={() => {
            isExitingRef.current = false;
            setIsAppClosed(false);
          }}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white font-bold text-xs shadow-lg shadow-red-700/40 cursor-pointer active:scale-95 transition-transform"
        >
          অ্যাপ পুনরায় চালু করুন
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#070a12] text-white flex justify-center font-sans select-none relative touch-manipulation p-[0.1rem] sm:p-2 box-border overflow-x-hidden">
      {/* Phone Default Back Button 1st Press Toast (Classic Android / YouTube / Facebook Style) */}
      {backPressToast && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[120] bg-black/90 border border-[#2a364f] text-slate-100 px-4 py-2 rounded-full text-xs font-semibold shadow-2xl backdrop-blur-md flex items-center gap-2 pointer-events-none animate-fadeIn">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>{backPressToast}</span>
        </div>
      )}

      {/* Real-time Admin Notification Banner for Add Money & Cashout requests */}
      <AdminNotificationBanner
        currentUserPhone={currentUser?.phoneNumber}
        onOpenAdminPanel={handleOpenAdminPanelWithTab}
      />

      {/* Real-time User Notification for Deposit / Withdrawal approvals, rejections, completions & balance credits */}
      <UserBalanceAlertToast
        message={userAlertToast || (balanceUpdateNotice ? { title: 'ব্যালেন্স আপডেট', message: balanceUpdateNotice, type: 'success' } : null)}
        onClose={() => {
          setUserAlertToast(null);
          setBalanceUpdateNotice(null);
        }}
      />

      {/* 100% Mobile Phone Container (With 4-side .1 padding, rounded frame, zero overflow) */}
      <div className="w-full max-w-md min-h-[calc(100dvh-0.2rem)] bg-[#0c0f17] flex flex-col shadow-2xl relative rounded-xl border border-[#1e2a3f] overflow-x-hidden box-border">
        {/* Top Header with 3-Line Menu Button */}
        <Header
          balance={balance}
          currentUser={currentUser}
          userProfile={userProfile}
          onOpenMenu={() => setIsSideDrawerOpen(true)}
          onOpenAuth={() => {
            setAuthNoticeMessage(null);
            setIsAuthOpen(true);
          }}
          onOpenDeposit={handleOpenDeposit}
          onOpenWithdraw={handleOpenWithdraw}
          onOpenRules={() => setIsRulesOpen(true)}
          onOpenAdmin={() => {
            if (isUserAdminAccount(currentUser?.phoneNumber)) {
              setIsAdminOpen(true);
            }
          }}
          onOpenBonusHub={handleOpenBonusHub}
          hasUnclaimedBonus={hasUnclaimedBonus}
          pendingDepositCount={pendingDepositCount}
          isMuted={isMuted}
          onToggleSound={() => {
            const next = !isMuted;
            setIsMuted(next);
            soundManager.setMuted(next);
          }}
          lang={lang}
          onToggleLang={() => setLang((prev) => (prev === 'bn' ? 'en' : 'bn'))}
          isPredictorOpen={isPredictorOpen}
          onTogglePredictor={handleTogglePredictor}
          onOpenInstallModal={() => setIsInstallModalOpen(true)}
          isAppInstalled={isAppInstalled}
        />

        {/* Right-to-Left Scrolling Announcement Banner ("শিরোনাম") */}
        <MarqueeTicker />

        {/* Admin Maintenance Active Indicator (Only visible to Admin when Maintenance Mode is ON) */}
        {appControls.maintenanceMode && isUserAdminAccount(currentUser?.phoneNumber) && (
          <div className="bg-rose-950/80 border-b border-rose-500/50 px-3 py-1.5 flex items-center justify-between text-[11px] text-rose-200 font-bold">
            <span className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              <span>মেইনটেন্যান্স মোড চালু আছে (শুধু এডমিন অ্যাক্সেস)</span>
            </span>
            <button
              onClick={() => setIsAdminOpen(true)}
              className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black cursor-pointer"
            >
              Admin
            </button>
          </div>
        )}

        {/* Main Container */}
        <main className="flex-1 w-full max-w-full p-1.5 sm:p-2 flex flex-col gap-2 relative pb-24 overflow-x-hidden box-border">
        {/* Aviator Mode */}
        {activeGameTab === 'AVIATOR' && !appControls.aviatorEnabled && (
          <div className="bg-[#111827] border border-amber-500/40 rounded-2xl p-8 text-center space-y-3 my-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-400 mx-auto flex items-center justify-center">
              <Plane className="w-7 h-7" />
            </div>
            <h3 className="text-base font-black text-white">Aviator গেম সাময়িকভাবে বন্ধ আছে</h3>
            <p className="text-xs text-slate-400">
              সার্ভার আপডেটের জন্য Aviator গেমটি সাময়িকভাবে বিরতিতে রাখা হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর চেষ্টা করুন।
            </p>
          </div>
        )}
        {activeGameTab === 'AVIATOR' && appControls.aviatorEnabled && (
          <>
            {/* Multiplier History Ribbon */}
            <HistoryRibbon history={history} />

            {/* Canvas Stage */}
            <div className="relative">
              <FlightCanvas
                status={roundStatus}
                currentMultiplier={currentMultiplier}
                finalCrashMultiplier={finalCrashMultiplier}
                waitingCountdown={waitingCountdown}
                lang={lang}
              />

              {/* Floating Win Banner */}
              {winNotification && (
                <WinNotification
                  amount={winNotification.amount}
                  multiplier={winNotification.multiplier}
                  onClose={() => setWinNotification(null)}
                />
              )}

              {/* AI Signal Predictor widget */}
              {appControls.aiPredictorEnabled && (
                <AIPredictorModal
                  isOpen={isPredictorOpen}
                  onClose={() => setIsPredictorOpen(false)}
                  recentMultipliers={history.map((h) => h.crashMultiplier)}
                  roundStatus={roundStatus}
                />
              )}
            </div>

            {/* Dual Betting Controls: Panel 1 & Panel 2 (Both visible simultaneously in same view - no tab switching) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <BetPanel
                  panelIndex={1}
                  bet={bet1}
                  roundStatus={roundStatus}
                  currentMultiplier={currentMultiplier}
                  balance={balance}
                  currentUser={currentUser}
                  onRequireAuth={handleRequireAuth}
                  onPlaceBet={handlePlaceBetPanel1}
                  onCancelBet={handleCancelBetPanel1}
                  onCashOut={() => handleCashOutPanel1()}
                  onUpdateAutoSettings={(autoBet, autoCash, autoMult) =>
                    setBet1((prev) => ({
                      ...prev,
                      isAutoBet: autoBet,
                      isAutoCashOut: autoCash,
                      autoCashOutMultiplier: autoMult,
                    }))
                  }
                  lang={lang}
                />
              </div>

              <div>
                <BetPanel
                  panelIndex={2}
                  bet={bet2}
                  roundStatus={roundStatus}
                  currentMultiplier={currentMultiplier}
                  balance={balance}
                  currentUser={currentUser}
                  onRequireAuth={handleRequireAuth}
                  onPlaceBet={handlePlaceBetPanel2}
                  onCancelBet={handleCancelBetPanel2}
                  onCashOut={() => handleCashOutPanel2()}
                  onUpdateAutoSettings={(autoBet, autoCash, autoMult) =>
                    setBet2((prev) => ({
                      ...prev,
                      isAutoBet: autoBet,
                      isAutoCashOut: autoCash,
                      autoCashOutMultiplier: autoMult,
                    }))
                  }
                  lang={lang}
                />
              </div>
            </div>

            {/* Multiplayer Live Bets & History */}
            <LiveBetsTable
              livePlayers={livePlayers}
              myBetHistory={myBetHistory}
              lang={lang}
            />
          </>
        )}

        {/* Wingo Mode */}
        {activeGameTab === 'WINGO' && !appControls.wingoEnabled && (
          <div className="bg-[#111827] border border-cyan-500/40 rounded-2xl p-8 text-center space-y-3 my-4">
            <div className="w-14 h-14 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-400 mx-auto flex items-center justify-center">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <h3 className="text-base font-black text-white">Wingo গেম সাময়িকভাবে বন্ধ আছে</h3>
            <p className="text-xs text-slate-400">
              রক্ষণাবেক্ষণের জন্য Wingo গেমটি সাময়িকভাবে বন্ধ রাখা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।
            </p>
          </div>
        )}
        {activeGameTab === 'WINGO' && appControls.wingoEnabled && (
          <WingoGame
            balance={balance}
            currentUser={currentUser}
            onRequireAuth={handleRequireAuth}
            onUpdateBalance={(delta) => updateBalanceAndSync((prev) => prev + delta)}
            inviteBonusBalance={userProfile?.inviteBonusBalance ?? 0}
            hasDeposited={Boolean(
              userProfile?.hasDeposited || (userProfile?.totalDeposited && userProfile.totalDeposited > 0)
            )}
            onAdjustInviteBonus={adjustInviteBonusBalance}
            lang={lang}
          />
        )}
      </main>

      {/* Mobile Native App Bottom Navigation Bar (Uniform on all viewports) */}
      <MobileBottomNav
        activeTab={activeGameTab}
        onSelectTab={(tab) => setActiveGameTab(tab)}
        onOpenDeposit={handleOpenDeposit}
        onOpenWithdraw={handleOpenWithdraw}
        onOpenAuth={() => {
          setAuthNoticeMessage(null);
          setIsAuthOpen(true);
        }}
        onTogglePredictor={() => setIsPredictorOpen((prev) => !prev)}
        isPredictorOpen={isPredictorOpen}
        onOpenInstallModal={() => setIsInstallModalOpen(true)}
        isAppInstalled={isAppInstalled}
        currentUser={currentUser}
      />

      {/* Modals */}
      <DepositModal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        currentBalance={balance}
        initialTab={walletTab}
        onAddFunds={(amt) => {
          updateBalanceAndSync((prev) => prev + amt);
          if (currentUser && currentUser.provider === 'google') {
            recordWalletTransaction(currentUser.uid, {
              type: 'deposit',
              amount: amt,
              method: 'bkash',
              accountNumber: userProfile?.phoneNumber || '01712-345678',
              status: 'completed',
              trxId: 'DEP' + Math.random().toString(36).substring(2, 9).toUpperCase(),
            });
          }
        }}
        onWithdrawFunds={(amt) => {
          updateBalanceAndSync((prev) => Math.max(0, Math.round((prev - amt) * 100) / 100));
          if (currentUser && currentUser.provider === 'google') {
            recordWalletTransaction(currentUser.uid, {
              type: 'withdraw',
              amount: amt,
              method: 'bkash',
              accountNumber: userProfile?.phoneNumber || '01712-345678',
              status: 'completed',
              trxId: 'WTH' + Math.random().toString(36).substring(2, 9).toUpperCase(),
            });
          }
        }}
        onResetBalance={() => {
          updateBalanceAndSync(() => INITIAL_BALANCE);
        }}
        lang={lang}
        userPhone={userProfile?.phoneNumber}
        currentUser={currentUser}
        userProfile={userProfile}
        onOpenAdminPanel={() => setIsAdminOpen(true)}
        onOpenAuth={(notice) => handleRequireAuth(notice || 'এড মানি করতে প্রথমে একাউন্ট তৈরি করুন!')}
      />

      <RulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
        lang={lang}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => {
          setIsAuthOpen(false);
          setAuthNoticeMessage(null);
        }}
        currentUser={currentUser}
        userProfile={userProfile}
        noticeMessage={authNoticeMessage}
        onLoginSuccess={(user, profile) => {
          setCurrentUser(user);
          setUserProfile(profile);
          setBalance(profile.balance);
          setAuthNoticeMessage(null);
        }}
        onLogoutSuccess={() => {
          setCurrentUser(null);
          setUserProfile(null);
          setBalance(INITIAL_BALANCE);
          setAuthNoticeMessage(null);
        }}
        onResetBalance={() => {
          updateBalanceAndSync(() => 0);
        }}
        onUpdatePhone={(phone) => {
          setUserProfile((p) => (p ? { ...p, phoneNumber: phone } : null));
        }}
        onOpenInstallModal={() => setIsInstallModalOpen(true)}
      />

      <AdminPanel
        isOpen={isAdminOpen && isUserAdminAccount(currentUser?.phoneNumber)}
        currentUserPhone={currentUser?.phoneNumber}
        onClose={() => setIsAdminOpen(false)}
        initialTab={adminPanelInitialTab}
        onBalanceAdjusted={() => {
          // If phone session exists, refresh state
          const currentPhoneSession = getActivePhoneSession();
          if (currentPhoneSession && currentUser?.uid === currentPhoneSession.user.uid) {
            setBalance(currentPhoneSession.profile.balance);
            setUserProfile(currentPhoneSession.profile);
          }
        }}
      />

      {/* PWA Mobile App Install Modal */}
      <PWAInstallModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        onOpenAndroidStudio={() => setIsAndroidStudioOpen(true)}
      />

      {/* Android Studio Export & APK Generation Guide Modal */}
      <AndroidStudioExportModal
        isOpen={isAndroidStudioOpen}
        onClose={() => setIsAndroidStudioOpen(false)}
      />

      {/* 3-Line Top Left Mobile Side Drawer Menu */}
      <MobileSideDrawer
        isOpen={isSideDrawerOpen}
        onClose={() => setIsSideDrawerOpen(false)}
        currentUser={currentUser}
        userProfile={userProfile}
        balance={balance}
        activeGameTab={activeGameTab}
        onChangeGameTab={(tab) => setActiveGameTab(tab)}
        onOpenAuth={() => {
          setAuthNoticeMessage(null);
          setIsAuthOpen(true);
        }}
        onOpenDeposit={handleOpenDeposit}
        onOpenWithdraw={handleOpenWithdraw}
        onOpenRules={() => setIsRulesOpen(true)}
        onOpenAdmin={() => {
          if (isUserAdminAccount(currentUser?.phoneNumber)) {
            setIsAdminOpen(true);
          }
        }}
        isPredictorOpen={isPredictorOpen}
        onTogglePredictor={handleTogglePredictor}
        isMuted={isMuted}
        onToggleSound={() => {
          const next = !isMuted;
          setIsMuted(next);
          soundManager.setMuted(next);
        }}
        lang={lang}
        onToggleLang={() => setLang((prev) => (prev === 'bn' ? 'en' : 'bn'))}
        onOpenInstallModal={() => setIsInstallModalOpen(true)}
        onRequireAuth={handleRequireAuth}
        onExitApp={() => setIsExitModalOpen(true)}
        telegramChannel={systemSettings.telegramChannel}
        telegramSupport={systemSettings.telegramSupport}
        onOpenBonusHub={handleOpenBonusHub}
        onOpenSpinner={handleOpenSpinner}
      />

      {/* Admin Broadcast Notification Dialog Modal */}
      <BroadcastNoticeModal
        notification={activeBroadcastNotice}
        onClose={() => setActiveBroadcastNotice(null)}
        onOpenBonus={handleOpenBonusHub}
      />

      {/* Daily Bonus & 7-Day Streak Hub Modal */}
      <DailyBonusModal
        isOpen={isBonusHubOpen}
        onClose={() => setIsBonusHubOpen(false)}
        currentUser={currentUser}
        userProfile={userProfile}
        onOpenAuth={(notice) => handleRequireAuth(notice || 'ইনভাইট বোনাস ১০০% পেতে প্রথমে একাউন্ট তৈরি বা লগইন করুন!')}
        onRewardWon={handleRewardWon}
        onOpenSpinner={handleOpenSpinner}
        activeSecondsToday={activeSecondsToday}
      />

      {/* Daily Lucky Spinner Modal */}
      <LuckySpinnerModal
        isOpen={isSpinnerOpen}
        onClose={() => setIsSpinnerOpen(false)}
        currentUser={currentUser}
        onRewardWon={handleRewardWon}
        onOpenStreakHub={handleOpenBonusHub}
      />

      {/* Phone Default Back Button & Double Back / Double Click Exit Confirmation Modal */}
      <ExitModal
        isOpen={isExitModalOpen}
        onClose={() => setIsExitModalOpen(false)}
        onConfirmExit={handleExitApp}
      />

      {/* Account Deactivation / Suspension Live Overlay Modal (Requirement 3) */}
      {Boolean(currentUser && suspensionInfo.isDeactivated) && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/92 backdrop-blur-md p-4 animate-fadeIn">
          <div className="bg-[#120a0d] border-2 border-rose-500/70 rounded-3xl p-6 sm:p-7 max-w-sm w-full shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-rose-500/20 border-2 border-rose-500/50 text-rose-400 mx-auto flex items-center justify-center shadow-lg">
              <Ban className="w-8 h-8 stroke-[2.5]" />
            </div>

            <div>
              <h3 className="text-lg font-black text-white">
                {suspensionInfo.isBanned ? '🚫 একাউন্ট স্থায়ীভাবে ব্যান করা হয়েছে' : '⏳ একাউন্ট সাময়িকভাবে স্থগিত'}
              </h3>
              <p className="text-xs text-rose-200/90 mt-2 leading-relaxed">
                {suspensionInfo.reason || 'নিয়ম লঙ্ঘনের কারণে আপনার অ্যাকাউন্টটির কার্যক্রম স্থগিত রাখা হয়েছে।'}
              </p>
            </div>

            {suspensionInfo.isSuspended && suspensionInfo.suspendedUntil && (
              <div className="bg-[#1d0e14] border border-rose-500/30 rounded-xl p-3 text-xs text-amber-300 font-mono">
                স্থগিতাদেশের মেয়াদ শেষ হবে:
                <span className="font-bold text-white block mt-0.5">
                  {new Date(suspensionInfo.suspendedUntil).toLocaleString('bn-BD', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                {suspensionInfo.remainingMinutes !== undefined && (
                  <span className="text-[11px] text-amber-400 block mt-1">
                    (বাকি আনুমানিক {Math.ceil(suspensionInfo.remainingMinutes / 60)} ঘণ্টা বা {suspensionInfo.remainingMinutes} মিনিট)
                  </span>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleLogoutAccount}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-rose-900/40 flex items-center justify-center gap-2 active:scale-95"
            >
              <LogOut className="w-4 h-4 font-bold" />
              <span>লগআউট করুন</span>
            </button>
          </div>
        </div>
      )}

      {/* System Maintenance Mode Overlay (Admin account bypasses this screen) */}
      {Boolean(appControls.maintenanceMode && !isUserAdminAccount(currentUser?.phoneNumber)) && (
        <div className="fixed inset-0 z-[145] flex items-center justify-center bg-[#070a12]/96 backdrop-blur-md p-4 animate-fadeIn">
          <div className="bg-[#101726] border-2 border-amber-500/50 rounded-3xl p-6 sm:p-7 max-w-sm w-full shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-amber-500/15 border-2 border-amber-500/50 text-amber-400 mx-auto flex items-center justify-center shadow-lg">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white">অ্যাপ রক্ষণাবেক্ষণ চলছে</h3>
              <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                {appControls.maintenanceMessage || 'সিস্টেম আপগ্রেডের কাজ চলছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAuthNoticeMessage(null);
                setIsAuthOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-[#1a2436] hover:bg-[#24324a] text-slate-300 text-xs font-bold cursor-pointer"
            >
              একাউন্ট লগইন
            </button>
          </div>
        </div>
      )}

      {/* 1-Second Initial Mobile Splash Screen */}
      {showSplash && (
        <SplashScreen onFinish={handleFinishSplash} />
      )}
      </div>
    </div>
  );
}
