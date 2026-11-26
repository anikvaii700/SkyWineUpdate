import { auth, type UserWalletProfile } from './firebase';
import type { User as FirebaseUser } from 'firebase/auth';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function getAuthHeaders(requireAuth = true): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (requireAuth) {
    const user = auth.currentUser;
    if (!user) {
      throw new ApiClientError(401, 'NOT_SIGNED_IN', 'Please sign in with Firebase first.');
    }
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

function resolveApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    requireAuth?: boolean;
  } = {}
): Promise<T> {
  const headers = await getAuthHeaders(options.requireAuth ?? true);
  const response = await fetch(resolveApiUrl(path), {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      typeof data.code === 'string' ? data.code : 'API_ERROR',
      typeof data.error === 'string' ? data.error : 'Request failed.',
      data.details
    );
  }

  return data as T;
}

export interface BackendMeResponse {
  user: {
    uid: string;
    userCode: string;
    email: string | null;
    displayName: string;
    phoneNumber: string | null;
    role: 'user' | 'admin';
    isAdmin: boolean;
    status: string;
    referralCode: string;
    firstDepositRewarded: boolean;
    createdAt?: string;
  };
  wallet: {
    userId: string;
    balance: number;
    inviteBonusLocked: number;
    withdrawableBalance: number;
    totalDeposited: number;
    totalWithdrawn: number;
    version: number;
    updatedAt?: string;
  };
}

export function mapBackendMeToProfile(
  data: BackendMeResponse,
  firebaseUser?: FirebaseUser | null
): UserWalletProfile {
  const now = new Date().toISOString();
  return {
    id: data.user.uid,
    userCode: data.user.userCode,
    email: data.user.email || firebaseUser?.email || '',
    displayName: data.user.displayName || firebaseUser?.displayName || 'Player',
    photoURL: firebaseUser?.photoURL || '',
    phoneNumber: data.user.phoneNumber || firebaseUser?.phoneNumber || '',
    balance: data.wallet.balance,
    initialBonus: 0,
    lockedPrincipal: data.wallet.inviteBonusLocked,
    totalDeposited: data.wallet.totalDeposited,
    firstDepositBonusEarned: 0,
    hasDeposited: data.wallet.totalDeposited > 0,
    referralCode: data.user.referralCode,
    referralCount: 0,
    referralBonusEarned: 0,
    inviteBonusBalance: data.wallet.inviteBonusLocked,
    firstDepositReferralRewarded: data.user.firstDepositRewarded,
    status: data.user.status as UserWalletProfile['status'],
    createdAt: data.user.createdAt || now,
    updatedAt: data.wallet.updatedAt || now,
  };
}

export interface BackendReferralSummary {
  referralCode: string;
  referrals: Array<{
    id: string;
    status: 'pending' | 'rewarded';
    bonus_amount: number;
    created_at: string;
    rewarded_at: string | null;
    referred_uid: string;
    referred_user_code: string;
    referred_name: string;
    referred_phone: string;
    first_deposit_amount: number;
  }>;
}

export const backendApi = {
  getHealth: () =>
    apiRequest<{
      ok: boolean;
      service: string;
      database: 'connected' | 'unconfigured' | 'error';
      authVerifier: 'ready' | 'unconfigured';
      timestamp: string;
    }>('/api/health', { requireAuth: false }),

  getPublicConfig: () =>
    apiRequest<{ paymentSettings: Record<string, unknown> }>('/api/public/config', {
      requireAuth: false,
    }),

  phoneLogin: (phone: string, password: string) => apiRequest<{ ok: boolean; customToken: string }>('/api/auth/phone-login', { method: 'POST', body: { phone, password }, requireAuth: false }),
  sendEmailOtp: (email: string) => apiRequest<{ ok: boolean; message: string }>('/api/auth/email-otp/send', { method: 'POST', body: { email }, requireAuth: false }),
  verifyEmailOtp: (email: string, code: string) => apiRequest<{ ok: boolean; verified: boolean }>('/api/auth/email-otp/verify', { method: 'POST', body: { email, code }, requireAuth: false }),

  getMe: () => apiRequest<BackendMeResponse>('/api/me'),

  updateProfile: (payload: { displayName?: string; phoneNumber?: string; referralCode?: string }) =>
    apiRequest('/api/me/profile', { method: 'PATCH', body: payload }),

  getWallet: (limit = 30, offset = 0) =>
    apiRequest(`/api/wallet?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`),

  listMyDeposits: (limit = 30, offset = 0) =>
    apiRequest(`/api/deposits?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`),

  submitDeposit: (payload: {
    method: 'bkash' | 'nagad' | 'rocket';
    senderNumber: string;
    trxId: string;
    amount: number;
  }) => apiRequest('/api/deposits', { method: 'POST', body: payload }),

  listMyWithdrawals: (limit = 30, offset = 0) =>
    apiRequest(`/api/withdrawals?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`),

  submitWithdrawal: (payload: {
    method: 'bkash' | 'nagad' | 'rocket';
    personalNumber: string;
    amount: number;
    idempotencyKey?: string;
  }) => apiRequest('/api/withdrawals', { method: 'POST', body: payload }),

  getMyReferrals: () => apiRequest<BackendReferralSummary>('/api/referrals'),

  admin: {
    getOverview: () => apiRequest('/api/admin/overview'),
    listUsers: (search = '', limit = 50, offset = 0) =>
      apiRequest(
        `/api/admin/users?search=${encodeURIComponent(search)}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`
      ),
    getUserDetails: (uid: string) => apiRequest(`/api/admin/users/${encodeURIComponent(uid)}`),
    updateUserStatus: (uid: string, status: 'active' | 'suspended' | 'banned', reason: string) =>
      apiRequest(`/api/admin/users/${encodeURIComponent(uid)}/status`, {
        method: 'PATCH',
        body: { status, reason },
      }),
    updateUserRole: (uid: string, role: 'user' | 'admin') =>
      apiRequest(`/api/admin/users/${encodeURIComponent(uid)}/role`, {
        method: 'PATCH',
        body: { role },
      }),
    adjustBalance: (
      uid: string,
      payload: { direction: 'credit' | 'debit'; amount: number; reason: string; idempotencyKey?: string }
    ) =>
      apiRequest(`/api/admin/users/${encodeURIComponent(uid)}/adjust-balance`, {
        method: 'POST',
        body: payload,
      }),
    listDeposits: (status = 'all', limit = 50, offset = 0) =>
      apiRequest(
        `/api/admin/deposits?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`
      ),
    approveDeposit: (id: string, adminNote?: string) =>
      apiRequest(`/api/admin/deposits/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        body: adminNote ? { adminNote } : {},
      }),
    rejectDeposit: (id: string, rejectionReason: string) =>
      apiRequest(`/api/admin/deposits/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: { rejectionReason },
      }),
    listWithdrawals: (status = 'all', limit = 50, offset = 0) =>
      apiRequest(
        `/api/admin/withdrawals?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`
      ),
    completeWithdrawal: (id: string, adminNote?: string) =>
      apiRequest(`/api/admin/withdrawals/${encodeURIComponent(id)}/complete`, {
        method: 'POST',
        body: adminNote ? { adminNote } : {},
      }),
    rejectWithdrawal: (id: string, rejectionReason: string) =>
      apiRequest(`/api/admin/withdrawals/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: { rejectionReason },
      }),
    getPaymentSettings: () => apiRequest('/api/admin/settings/payment'),
    updatePaymentSettings: (payload: Record<string, unknown>) =>
      apiRequest('/api/admin/settings/payment', { method: 'PUT', body: payload }),
    listAuditLogs: (limit = 50, offset = 0) =>
      apiRequest(
        `/api/admin/audit-logs?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`
      ),
  },
};
