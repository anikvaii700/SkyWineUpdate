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
