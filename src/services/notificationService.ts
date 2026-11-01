import { db } from './firebase';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { soundManager } from './audio';

export interface BroadcastNotification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'alert' | 'update' | 'bonus';
  sentAt: number;
  sentBy: string;
  pinned?: boolean;
}

const LOCAL_STORAGE_BROADCAST_KEY = 'skywin_broadcast_notifications';
const LAST_SEEN_BROADCAST_ID_KEY = 'skywin_last_seen_broadcast_id';
const DAILY_REMINDER_SETTINGS_KEY = 'skywin_daily_reminder_settings';

export interface DailyReminderSettings {
  lastOpenTimestamp: number;
  openHour: number;
  openMinute: number;
  formattedTime: string;
  nextScheduledTimestamp: number;
  hasPermission: boolean;
  lastNotifiedDateStr?: string;
}

// -------------------------------------------------------------
// 1. DAILY NEXT-DAY APP OPEN NOTIFICATION SYSTEM
// -------------------------------------------------------------

/**
 * Format a Date to 12-hour Bengali/English friendly time string (e.g. "03:45 PM")
 */
export function formatTime12Hour(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  const minutesStr = minutes < 10 ? '0' + minutes : minutes.toString();
  const hoursStr = hours < 10 ? '0' + hours : hours.toString();
  return `${hoursStr}:${minutesStr} ${ampm}`;
}

/**
 * Record today's app open timestamp and schedule the reminder for the exact same time tomorrow
 */
export function recordAppOpenAndScheduleReminder(): DailyReminderSettings {
  const now = new Date();
  const lastOpenTimestamp = now.getTime();
  const openHour = now.getHours();
  const openMinute = now.getMinutes();
  const formattedTime = formatTime12Hour(now);

  // Exactly 24 hours later (same time next day)
  const nextScheduledTimestamp = lastOpenTimestamp + 24 * 60 * 60 * 1000;

  const hasPermission =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted';

  const settings: DailyReminderSettings = {
    lastOpenTimestamp,
    openHour,
    openMinute,
    formattedTime,
    nextScheduledTimestamp,
    hasPermission,
  };

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DAILY_REMINDER_SETTINGS_KEY, JSON.stringify(settings));
    }
  } catch {
    // Storage quota or private mode
  }

  // Request browser notification permission if not yet decided
  requestBrowserNotificationPermission().catch(() => {});

  return settings;
}

/**
 * Request native browser notification permission
 */
export async function requestBrowserNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  try {
    if (Notification.permission === 'granted') {
      return true;
    }
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
  } catch {
    // Ignore error
  }
  return false;
}

/**
 * Check if the daily reminder is due and trigger it if applicable
 */
export function checkAndTriggerDailyReminder(
  onTriggerInApp?: (title: string, message: string) => void
): boolean {
  if (typeof localStorage === 'undefined') return false;

  try {
    const raw = localStorage.getItem(DAILY_REMINDER_SETTINGS_KEY);
    if (!raw) return false;

    const settings: DailyReminderSettings = JSON.parse(raw);
    const now = Date.now();
    const todayDateStr = new Date().toDateString();

    // Check if scheduled time has passed and has not been notified today
    if (
      settings.nextScheduledTimestamp &&
      now >= settings.nextScheduledTimestamp &&
      settings.lastNotifiedDateStr !== todayDateStr
    ) {
      settings.lastNotifiedDateStr = todayDateStr;
      // Reschedule for next day at same time
      settings.nextScheduledTimestamp = now + 24 * 60 * 60 * 1000;
      localStorage.setItem(DAILY_REMINDER_SETTINGS_KEY, JSON.stringify(settings));

      const title = '🎁 SkyWin BD: আপনার আজকের ৫০৳ ডেইলি বোনাস প্রস্তুত!';
      const message = `গতকাল ঠিক ${settings.formattedTime} এ আপনি অ্যাপ অপেন করেছিলেন। আপনার দৈনিক বোনাস ও লাকি স্পিন ক্লেইম করুন!`;

      // Trigger Web Notification
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(title, {
            body: message,
            icon: '/skywin-logo.svg',
            badge: '/icon.svg',
            tag: 'daily-bonus-reminder',
          });
        } catch {
          // ignore
        }
      }

      // Audio chime
      soundManager.playNotificationChime();

      if (onTriggerInApp) {
        onTriggerInApp(title, message);
      }
      return true;
    }
  } catch {
    // parse error
  }

  return false;
}

/**
 * Get current daily reminder status for UI display
 */
export function getDailyReminderStatus(): DailyReminderSettings | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DAILY_REMINDER_SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// -------------------------------------------------------------
// 2. ADMIN BROADCAST NOTIFICATION SYSTEM
// -------------------------------------------------------------

/**
 * Get cached broadcast notifications from localStorage
 */
export function getStoredBroadcastNotifications(): BroadcastNotification[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const data = localStorage.getItem(LOCAL_STORAGE_BROADCAST_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveBroadcastNotificationsLocally(notifications: BroadcastNotification[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_BROADCAST_KEY, JSON.stringify(notifications));
  } catch {
    // quota
  }
}

/**
 * Admin: Send a new notification to all users
 */
export async function sendBroadcastNotification(params: {
  title: string;
  message: string;
  type?: BroadcastNotification['type'];
  sentBy?: string;
  pinned?: boolean;
}): Promise<BroadcastNotification> {
  const newNotif: BroadcastNotification = {
    id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    title: params.title.trim(),
    message: params.message.trim(),
    type: params.type || 'info',
    sentAt: Date.now(),
    sentBy: params.sentBy || 'Admin',
    pinned: !!params.pinned,
  };

  // 1. Save in Firestore for multi-device sync
  try {
    const notifRef = doc(db, 'broadcast_notifications', newNotif.id);
    await setDoc(notifRef, newNotif);
  } catch (err) {
    console.warn('Firestore broadcast save failed, falling back to local storage:', err);
  }

  // 2. Update local storage cache
  const current = getStoredBroadcastNotifications();
  const updated = [newNotif, ...current.filter((n) => n.id !== newNotif.id)].slice(0, 30);
  saveBroadcastNotificationsLocally(updated);

  // Dispatch custom storage event for instant local tab sync
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('skywin_new_broadcast', { detail: newNotif }));
  }

  return newNotif;
}

/**
 * Admin: Delete a broadcast notification
 */
export async function deleteBroadcastNotification(id: string): Promise<void> {
  try {
    const notifRef = doc(db, 'broadcast_notifications', id);
    await deleteDoc(notifRef);
  } catch (err) {
    console.warn('Firestore delete failed:', err);
  }

  const current = getStoredBroadcastNotifications();
  const updated = current.filter((n) => n.id !== id);
  saveBroadcastNotificationsLocally(updated);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('skywin_broadcast_deleted', { detail: { id } }));
  }
}

/**
 * Listen to real-time broadcast notifications for users and admin
 */
export function listenToBroadcastNotifications(
  callback: (notifications: BroadcastNotification[]) => void
): () => void {
  // Initial callback from local cache
  callback(getStoredBroadcastNotifications());

  let unsubscribeFirestore = () => {};

  try {
    const q = query(collection(db, 'broadcast_notifications'), orderBy('sentAt', 'desc'), limit(20));
    unsubscribeFirestore = onSnapshot(
      q,
      (snapshot) => {
        const notifs: BroadcastNotification[] = [];
        snapshot.forEach((docSnap) => {
          notifs.push(docSnap.data() as BroadcastNotification);
        });

        // Merge with local storage
        if (notifs.length > 0) {
          saveBroadcastNotificationsLocally(notifs);
          callback(notifs);
        } else {
          // If Firestore is empty, use stored fallback
          callback(getStoredBroadcastNotifications());
        }
      },
      (err) => {
        console.warn('Firestore broadcast listen warning:', err);
        callback(getStoredBroadcastNotifications());
      }
    );
  } catch (err) {
    console.warn('Error setting up broadcast snapshot listener:', err);
  }

  // Also listen for local custom events
  const handleLocalNew = (e: any) => {
    callback(getStoredBroadcastNotifications());
  };
  const handleStorage = (e: StorageEvent) => {
    if (e.key === LOCAL_STORAGE_BROADCAST_KEY) {
      callback(getStoredBroadcastNotifications());
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('skywin_new_broadcast', handleLocalNew);
    window.addEventListener('skywin_broadcast_deleted', handleLocalNew);
    window.addEventListener('storage', handleStorage);
  }

  return () => {
    unsubscribeFirestore();
    if (typeof window !== 'undefined') {
      window.removeEventListener('skywin_new_broadcast', handleLocalNew);
      window.removeEventListener('skywin_broadcast_deleted', handleLocalNew);
      window.removeEventListener('storage', handleStorage);
    }
  };
}

/**
 * Track last seen broadcast ID to avoid repeat popup on every render
 */
export function getLastSeenBroadcastId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(LAST_SEEN_BROADCAST_ID_KEY);
}

export function setLastSeenBroadcastId(id: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_SEEN_BROADCAST_ID_KEY, id);
}
