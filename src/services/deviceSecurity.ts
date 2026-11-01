import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const DEVICE_ID_KEY = 'aviator_device_uuid_v2';
const DEVICE_REGISTERED_PHONES_KEY = 'aviator_device_registered_accounts_v2';
export const MAX_ACCOUNTS_PER_DEVICE = 2;

// Get or generate persistent unique device ID
export function getOrCreateDeviceId(): string {
  try {
    let devId = localStorage.getItem(DEVICE_ID_KEY);
    if (!devId) {
      devId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem(DEVICE_ID_KEY, devId);
    }
    return devId;
  } catch {
    return 'dev_fallback_guest';
  }
}

// Get phone numbers registered on this device from local storage
export function getLocallyRegisteredPhonesOnDevice(): string[] {
  try {
    const raw = localStorage.getItem(DEVICE_REGISTERED_PHONES_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
    // Seed from any existing stored accounts on this browser
    const rawAccounts = localStorage.getItem('aviator_phone_accounts_v1');
    if (rawAccounts) {
      const parsed = JSON.parse(rawAccounts);
      const phones = Object.keys(parsed).slice(0, MAX_ACCOUNTS_PER_DEVICE);
      if (phones.length > 0) {
        localStorage.setItem(DEVICE_REGISTERED_PHONES_KEY, JSON.stringify(phones));
        return phones;
      }
    }
  } catch {
    // Ignore error
  }
  return [];
}

// Check if a new account can be registered on this device (Strict limit: Max 2 accounts per device)
export async function canRegisterNewAccountOnDevice(cleanPhone: string): Promise<{
  allowed: boolean;
  reason?: string;
  registeredCount: number;
  maxAllowed: number;
  existingAccounts: string[];
}> {
  const deviceId = getOrCreateDeviceId();
  const localPhones = getLocallyRegisteredPhonesOnDevice();

  // If this phone is already one of the registered accounts on this device, it's allowed
  if (localPhones.includes(cleanPhone)) {
    return {
      allowed: true,
      registeredCount: localPhones.length,
      maxAllowed: MAX_ACCOUNTS_PER_DEVICE,
      existingAccounts: localPhones,
    };
  }

  // Check remote Firestore device registration record
  let remotePhones: string[] = [];
  try {
    const devDocRef = doc(db, 'device_registrations', deviceId);
    const snap = await getDoc(devDocRef);
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data?.registeredPhones)) {
        remotePhones = data.registeredPhones;
      }
    }
  } catch (err) {
    console.warn('Could not check remote device registration in Firestore:', err);
  }

  // Combine unique accounts registered from this device
  const combinedSet = new Set<string>([...localPhones, ...remotePhones]);

  // If this phone is already in the list, allow it
  if (combinedSet.has(cleanPhone)) {
    return {
      allowed: true,
      registeredCount: combinedSet.size,
      maxAllowed: MAX_ACCOUNTS_PER_DEVICE,
      existingAccounts: Array.from(combinedSet),
    };
  }

  // Strict check: No more than 2 accounts per device
  if (combinedSet.size >= MAX_ACCOUNTS_PER_DEVICE) {
    return {
      allowed: false,
      reason: `একই ডিভাইসে ২ টির বেশি একাউন্ট খোলা যাবে না। এই ডিভাইস থেকে ইতিমধ্যে ${combinedSet.size} টি একাউন্ট তৈরি করা হয়েছে। অনুগ্রহ করে আপনার পূর্বের একাউন্টে লগইন করুন।`,
      registeredCount: combinedSet.size,
      maxAllowed: MAX_ACCOUNTS_PER_DEVICE,
      existingAccounts: Array.from(combinedSet),
    };
  }

  return {
    allowed: true,
    registeredCount: combinedSet.size,
    maxAllowed: MAX_ACCOUNTS_PER_DEVICE,
    existingAccounts: Array.from(combinedSet),
  };
}

// Record an account registration on this device
export async function recordAccountRegistrationOnDevice(cleanPhone: string): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  const localPhones = getLocallyRegisteredPhonesOnDevice();
  const updatedSet = new Set<string>([...localPhones, cleanPhone]);
  const updatedList = Array.from(updatedSet);

  // 1. Save to local storage
  try {
    localStorage.setItem(DEVICE_REGISTERED_PHONES_KEY, JSON.stringify(updatedList));
  } catch {}

  // 2. Sync to Firestore
  try {
    const devDocRef = doc(db, 'device_registrations', deviceId);
    await setDoc(
      devDocRef,
      {
        deviceId,
        registeredPhones: updatedList,
        accountCount: updatedList.length,
        maxAllowed: MAX_ACCOUNTS_PER_DEVICE,
        lastRegisteredPhone: cleanPhone,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (fsErr) {
    console.warn('Could not sync device registration to Firestore:', fsErr);
  }
}
