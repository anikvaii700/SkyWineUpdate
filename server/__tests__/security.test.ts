import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../app.ts';
import { HttpError } from '../middleware/errorHandler.ts';
import type { VerifiedFirebaseIdentity } from '../services/firebaseAuth.ts';
import {
  fromPaisa,
  normalizePhone,
  normalizeTrxId,
  toPaisa,
  type DbUser,
} from '../services/walletLedger.ts';

const MOCK_USERS: Record<string, { identity: VerifiedFirebaseIdentity; user: DbUser }> = {
  'valid-user-token': {
    identity: {
      uid: 'uid_regular_user',
      email: 'player@example.com',
      emailVerified: true,
      name: 'Regular Player',
      picture: null,
    },
    user: {
      firebaseUid: 'uid_regular_user',
      userCode: 'USER-100001',
      email: 'player@example.com',
      displayName: 'Regular Player',
      phoneNumber: '01700000001',
      role: 'user',
      status: 'active',
      referralCode: 'USER-100001',
      referredByUid: null,
      firstDepositRewarded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  },
  'valid-banned-token': {
    identity: {
      uid: 'uid_banned_user',
      email: 'banned@example.com',
      emailVerified: true,
      name: 'Banned Player',
      picture: null,
    },
    user: {
      firebaseUid: 'uid_banned_user',
      userCode: 'USER-100002',
      email: 'banned@example.com',
      displayName: 'Banned Player',
      phoneNumber: '01700000002',
      role: 'user',
      status: 'banned',
      referralCode: 'USER-100002',
      referredByUid: null,
      firstDepositRewarded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  },
  'valid-admin-token': {
    identity: {
      uid: 'uid_admin_user',
      email: 'admin@example.com',
      emailVerified: true,
      name: 'Verified Admin',
      picture: null,
    },
    user: {
      firebaseUid: 'uid_admin_user',
      userCode: 'USER-900001',
      email: 'admin@example.com',
      displayName: 'Verified Admin',
      phoneNumber: null,
      role: 'admin',
      status: 'active',
      referralCode: 'USER-900001',
      referredByUid: null,
      firstDepositRewarded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  },
};

describe('SkyWinBD Backend Security, Auth, RBAC & Validation', () => {
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    const app = createApp({
      allowedOrigins: ['https://skywineupdate.onrender.com'],
      disableRateLimit: true,
      authDeps: {
        verifyToken: async (token: string) => {
          const entry = MOCK_USERS[token];
          if (!entry) {
            throw new HttpError(401, 'UNAUTHORIZED', 'Invalid token.');
          }
          return entry.identity;
        },
        resolveUser: async (identity: VerifiedFirebaseIdentity) => {
          const match = Object.values(MOCK_USERS).find((m) => m.identity.uid === identity.uid);
          if (!match) {
            throw new HttpError(404, 'USER_NOT_FOUND', 'Not found');
          }
          return match.user;
        },
      },
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('exposes /api/health without leaking secrets or database credentials', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.service, 'skywinbd-api');
    assert.equal('databaseUrl' in body, false);
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
  });

  it('rejects unauthenticated requests to protected wallet and admin endpoints with 401', async () => {
    const endpoints: Array<{ method: string; path: string }> = [
      { method: 'GET', path: '/api/me' },
      { method: 'GET', path: '/api/wallet' },
      { method: 'POST', path: '/api/deposits' },
      { method: 'POST', path: '/api/withdrawals' },
      { method: 'GET', path: '/api/admin/overview' },
      { method: 'GET', path: '/api/admin/users' },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, { method: ep.method });
      assert.equal(res.status, 401, `Expected 401 on ${ep.method} ${ep.path}`);
    }
  });

  it('rejects forged Bearer tokens with 401', async () => {
    const res = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: 'Bearer forged.jwt.payload' },
    });
    assert.equal(res.status, 401);
  });

  it('blocks banned users from accessing protected endpoints with 403', async () => {
    const res = await fetch(`${baseUrl}/api/wallet`, {
      headers: { Authorization: 'Bearer valid-banned-token' },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, 'ACCOUNT_RESTRICTED');
  });

  it('blocks non-admin authenticated users from all /api/admin/* endpoints with 403', async () => {
    const adminEndpoints: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: '/api/admin/overview' },
      { method: 'GET', path: '/api/admin/users' },
      { method: 'GET', path: '/api/admin/deposits' },
      {
        method: 'POST',
        path: '/api/admin/deposits/11111111-1111-4111-8111-111111111111/approve',
        body: {},
      },
      {
        method: 'POST',
        path: '/api/admin/users/uid_regular_user/adjust-balance',
        body: { direction: 'credit', amount: 500, reason: 'exploit attempt' },
      },
      {
        method: 'PATCH',
        path: '/api/admin/users/uid_regular_user/role',
        body: { role: 'admin' },
      },
    ];

    for (const ep of adminEndpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: {
          Authorization: 'Bearer valid-user-token',
          'Content-Type': 'application/json',
        },
        body: ep.body !== undefined ? JSON.stringify(ep.body) : undefined,
      });
      assert.equal(res.status, 403, `Expected 403 for regular user on ${ep.method} ${ep.path}`);
    }
  });

  it('rejects mass-assignment fields (role, balance, userId) via strict Zod validation', async () => {
    const profileRes = await fetch(`${baseUrl}/api/me/profile`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'Hacker', role: 'admin', balance: 999999 }),
    });
    assert.equal(profileRes.status, 400);
    const profileBody = (await profileRes.json()) as { code: string };
    assert.equal(profileBody.code, 'VALIDATION_ERROR');

    const depositRes = await fetch(`${baseUrl}/api/deposits`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'bkash',
        senderNumber: '01712345678',
        trxId: 'TRX123456',
        amount: -500,
        status: 'approved',
      }),
    });
    assert.equal(depositRes.status, 400);
  });

  it('rejects malformed UUIDs on admin deposit approval before touching DB', async () => {
    const res = await fetch(`${baseUrl}/api/admin/deposits/not-a-valid-uuid/approve`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, 'VALIDATION_ERROR');
  });

  it('blocks disallowed cross-origin CORS requests with 403 and allows configured origin', async () => {
    const blocked = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://evil-attacker.example' },
    });
    assert.equal(blocked.status, 403);

    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://skywineupdate.onrender.com' },
    });
    assert.equal(allowed.status, 200);
    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      'https://skywineupdate.onrender.com'
    );
  });

  it('returns JSON 404 for unknown API paths', async () => {
    const res = await fetch(`${baseUrl}/api/non-existent-route`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, 'NOT_FOUND');
  });

  it('performs exact integer paisa arithmetic and phone/TrxID normalization', () => {
    assert.equal(toPaisa(19.99), 1999);
    assert.equal(fromPaisa(toPaisa(0.1) + toPaisa(0.2)), 0.3);
    assert.equal(normalizePhone('+880 1712-345678'), '01712345678');
    assert.equal(normalizeTrxId('  bkash 9a8b7c  '), 'BKASH9A8B7C');
  });
});

describe('SkyWinBD Mobile Number & Password Authentication', () => {
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    const app = createApp({
      allowedOrigins: ['https://skywineupdate.onrender.com'],
      disableRateLimit: true,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects invalid Bangladeshi phone numbers on signup', async () => {
    const res = await fetch(`${baseUrl}/api/auth/phone-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '01234567890',
        password: 'password123',
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, 'INVALID_PHONE_NUMBER');
  });

  it('signs up a mobile number + password with full contract, blocks duplicate registration, and authorizes /api/me & login', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/phone-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '+880 1711-223344',
        password: 'secretPass99',
        displayName: 'Rafiq Test',
      }),
    });
    assert.equal(signupRes.status, 201);
    const signupBody = (await signupRes.json()) as {
      ok: boolean;
      token: string;
      user: {
        uid: string;
        userCode: string;
        email: string | null;
        displayName: string;
        phoneNumber: string;
        role: string;
        isAdmin: boolean;
        status: string;
        referralCode: string;
        firstDepositRewarded: boolean;
      };
      wallet: {
        userId: string;
        balance: number;
        inviteBonusLocked: number;
        withdrawableBalance: number;
        totalDeposited: number;
        totalWithdrawn: number;
        version: number;
      };
    };
    assert.equal(signupBody.ok, true);
    assert.match(signupBody.token, /^skywin_phone_v1\./);
    assert.equal(signupBody.user.uid, 'phone_01711223344');
    assert.match(signupBody.user.userCode, /^USER-\d{6}$/);
    assert.equal(signupBody.user.email, null);
    assert.equal(signupBody.user.phoneNumber, '01711223344');
    assert.equal(signupBody.user.displayName, 'Rafiq Test');
    assert.equal(signupBody.user.role, 'user');
    assert.equal(signupBody.user.isAdmin, false);
    assert.equal(signupBody.user.status, 'active');
    assert.equal(signupBody.user.referralCode, signupBody.user.userCode);
    assert.equal(signupBody.user.firstDepositRewarded, false);

    assert.equal(signupBody.wallet.userId, 'phone_01711223344');
    assert.equal(signupBody.wallet.balance, 100);
    assert.equal(signupBody.wallet.inviteBonusLocked, 100);
    assert.equal(signupBody.wallet.withdrawableBalance, 0);
    assert.equal(signupBody.wallet.totalDeposited, 0);
    assert.equal(signupBody.wallet.totalWithdrawn, 0);
    assert.equal(signupBody.wallet.version, 1);

    // Signup token works immediately against /api/me & /api/wallet, and is blocked from /api/admin/*
    const signupMeRes = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${signupBody.token}` },
    });
    assert.equal(signupMeRes.status, 200);

    const adminAttemptRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${signupBody.token}` },
    });
    assert.equal(adminAttemptRes.status, 403);

    // Duplicate registration returns 409
    const dupRes = await fetch(`${baseUrl}/api/auth/phone-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '01711223344',
        password: 'anotherPassword',
      }),
    });
    assert.equal(dupRes.status, 409);
    const dupBody = (await dupRes.json()) as { code: string };
    assert.equal(dupBody.code, 'PHONE_ALREADY_REGISTERED');

    // Wrong password returns 401
    const badLoginRes = await fetch(`${baseUrl}/api/auth/phone-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '01711223344',
        password: 'wrongPassword',
      }),
    });
    assert.equal(badLoginRes.status, 401);

    // Valid login returns fresh signed Bearer token AND HttpOnly session cookie for refresh persistence
    const loginRes = await fetch(`${baseUrl}/api/auth/phone-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '01711223344',
        password: 'secretPass99',
      }),
    });
    assert.equal(loginRes.status, 200);
    const setCookieHeader = loginRes.headers.get('set-cookie') || '';
    assert.match(setCookieHeader, /^skywin_session=/);
    assert.match(setCookieHeader, /HttpOnly/i);
    const sessionCookiePair = setCookieHeader.split(';')[0];

    const loginBody = (await loginRes.json()) as {
      ok: boolean;
      token: string;
      user: { uid: string; role: string };
      wallet: { balance: number; inviteBonusLocked: number; withdrawableBalance: number };
    };
    assert.equal(loginBody.ok, true);
    assert.equal(loginBody.user.uid, 'phone_01711223344');
    assert.equal(loginBody.user.role, 'user');
    assert.equal(loginBody.wallet.balance, 100);
    assert.equal(loginBody.wallet.inviteBonusLocked, 100);
    assert.equal(loginBody.wallet.withdrawableBalance, 0);

    // Authorized /api/me succeeds with issued Bearer token
    const meRes = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    assert.equal(meRes.status, 200);
    const meBody = (await meRes.json()) as { user: { uid: string; phoneNumber: string } };
    assert.equal(meBody.user.uid, 'phone_01711223344');
    assert.equal(meBody.user.phoneNumber, '01711223344');

    // Authorized /api/me also succeeds using ONLY the HttpOnly cookie (survives page refresh)
    const cookieMeRes = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: sessionCookiePair },
    });
    assert.equal(cookieMeRes.status, 200);
    const cookieMeBody = (await cookieMeRes.json()) as { user: { uid: string }; wallet: { balance: number } };
    assert.equal(cookieMeBody.user.uid, 'phone_01711223344');
    assert.equal(cookieMeBody.wallet.balance, 100);

    // Cookie-authenticated mutation without CSRF header or trusted Origin is rejected with 403
    const csrfBlockedRes = await fetch(`${baseUrl}/api/me/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookiePair },
      body: JSON.stringify({ displayName: 'Blocked Update' }),
    });
    assert.equal(csrfBlockedRes.status, 403);

    // Cookie-authenticated mutation with X-Requested-With header succeeds
    const csrfAllowedRes = await fetch(`${baseUrl}/api/me/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookiePair,
        'X-Requested-With': 'SkyWinBD',
      },
      body: JSON.stringify({ displayName: 'Rafiq Updated' }),
    });
    assert.equal(csrfAllowedRes.status, 200);

    // Tampered token is rejected with 401
    const tamperedRes = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${loginBody.token}tampered` },
    });
    assert.equal(tamperedRes.status, 401);
  });

  it('rejects mass-assignment fields on phone-signup and supports optional referralCode safely', async () => {
    const massAssignRes = await fetch(`${baseUrl}/api/auth/phone-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '01722334455',
        password: 'secretPass99',
        role: 'admin',
        balance: 5000,
      }),
    });
    assert.equal(massAssignRes.status, 400);
    const massAssignBody = (await massAssignRes.json()) as { code: string };
    assert.equal(massAssignBody.code, 'VALIDATION_ERROR');

    // Signup with unknown referralCode succeeds cleanly with role='user' and ৳100 locked welcome bonus
    const refRes = await fetch(`${baseUrl}/api/auth/phone-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '01722334455',
        password: 'secretPass99',
        referralCode: 'NON-EXISTENT-CODE',
      }),
    });
    assert.equal(refRes.status, 201);
    const refBody = (await refRes.json()) as {
      ok: boolean;
      user: { role: string };
      wallet: { balance: number; inviteBonusLocked: number; withdrawableBalance: number };
    };
    assert.equal(refBody.ok, true);
    assert.equal(refBody.user.role, 'user');
    assert.equal(refBody.wallet.balance, 100);
    assert.equal(refBody.wallet.inviteBonusLocked, 100);
    assert.equal(refBody.wallet.withdrawableBalance, 0);
  });

  it('never promotes unverified phone accounts to admin even if phone is in ADMIN_PHONES', async () => {
    const { env } = await import('../config/env.ts');
    const { ensureUserAndWallet } = await import('../services/walletLedger.ts');

    const mutableAdminPhones = env.adminPhones as unknown as string[];
    const targetAdminPhone = '01799887766';
    mutableAdminPhones.push(targetAdminPhone);

    try {
      const signupRes = await fetch(`${baseUrl}/api/auth/phone-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: targetAdminPhone,
          password: 'secretPass99',
        }),
      });
      assert.equal(signupRes.status, 201);
      const signupBody = (await signupRes.json()) as {
        token: string;
        user: { role: string; isAdmin: boolean };
      };
      assert.equal(signupBody.user.role, 'user');
      assert.equal(signupBody.user.isAdmin, false);

      // Subsequent /api/me with unverified phone token must also NOT promote to admin
      const meRes = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: `Bearer ${signupBody.token}` },
      });
      assert.equal(meRes.status, 200);
      const meBody = (await meRes.json()) as { user: { role: string; isAdmin: boolean } };
      assert.equal(meBody.user.role, 'user');
      assert.equal(meBody.user.isAdmin, false);

      // Direct ensureUserAndWallet with phoneVerified: false also stays 'user'
      const unverifiedDirect = await ensureUserAndWallet({
        uid: `phone_${targetAdminPhone}`,
        email: null,
        emailVerified: false,
        name: 'Unverified Phone',
        picture: null,
        phoneNumber: targetAdminPhone,
        phoneVerified: false,
      });
      assert.equal(unverifiedDirect.role, 'user');
    } finally {
      const idx = mutableAdminPhones.indexOf(targetAdminPhone);
      if (idx !== -1) mutableAdminPhones.splice(idx, 1);
    }
  });

  it('promotes only the first verified Google user when no explicit admin allowlist is configured', async () => {
    const { ensureUserAndWallet } = await import('../services/walletLedger.ts');

    const firstGoogle = await ensureUserAndWallet({
      uid: 'google_first_admin_test',
      email: 'owner.first@gmail.com',
      emailVerified: true,
      name: 'First Owner',
      picture: null,
      phoneNumber: null,
    });
    assert.equal(firstGoogle.role, 'admin');

    const secondGoogle = await ensureUserAndWallet({
      uid: 'google_second_player_test',
      email: 'player.second@gmail.com',
      emailVerified: true,
      name: 'Second Player',
      picture: null,
      phoneNumber: null,
    });
    assert.equal(secondGoogle.role, 'user');
  });
});

