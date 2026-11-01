// src/services/adminAuth.ts
// Secure Admin Access & Authorization System
// STRICT REQUIREMENT: Only the account holder with phone number 01743224700 can see or access the Admin section.
// No other player will receive any clue, notification, or hint of the admin section.

export const ADMIN_PHONE_NUMBER = '01743224700';

/**
 * Normalizes phone number to digits only
 */
export function cleanDigits(phone?: string | null): string {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, '');
}

/**
 * Check if a logged in user is the strictly designated admin/owner (01743224700)
 */
export function isUserAdminAccount(userPhone?: string | null): boolean {
  if (!userPhone) return false;
  const digits = cleanDigits(userPhone);
  if (!digits) return false;
  return digits === ADMIN_PHONE_NUMBER || digits.endsWith(ADMIN_PHONE_NUMBER);
}

/**
 * Checks if admin mode is visible for the current user phone.
 * STRICT: Only returns true if the user phone is 01743224700.
 */
export function isPublicAdminVisible(userPhone?: string | null): boolean {
  return isUserAdminAccount(userPhone);
}

/**
 * Get registered owner phone number (Fixed to 01743224700)
 */
export function getRegisteredAdminPhone(): string {
  return ADMIN_PHONE_NUMBER;
}

/**
 * Save registered owner phone number
 */
export function saveRegisteredAdminPhone(phone: string): void {
  // Maintained for backward compatibility, keeps 01743224700 as primary
  try {
    const clean = cleanDigits(phone);
    if (clean) {
      localStorage.setItem('aviator_admin_registered_phone_v1', clean);
    }
  } catch {}
}

/**
 * Toggle Admin mode (Only permitted for 01743224700)
 */
export function setAdminVisible(visible: boolean, userPhone?: string | null): void {
  if (!isUserAdminAccount(userPhone)) {
    // Non-admin users are strictly blocked from setting admin mode
    try {
      localStorage.removeItem('aviator_admin_stealth_mode_v1');
    } catch {}
    return;
  }

  try {
    if (visible) {
      localStorage.setItem('aviator_admin_stealth_mode_v1', 'true');
    } else {
      localStorage.removeItem('aviator_admin_stealth_mode_v1');
    }
    window.dispatchEvent(new CustomEvent('admin_mode_changed', { detail: { visible } }));
  } catch (e) {
    console.error('Failed to set admin visibility:', e);
  }
}
