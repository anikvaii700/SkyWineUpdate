# Security Backend Integration

This branch ports the backend foundation from the separate SkyWinBD-Security repository into the original SkyWineUpdate codebase. It preserves the existing frontend components and does not change the production `main` branch.

## What is now in this repository

- Express server exposing same-origin `/api` endpoints
- PostgreSQL schema and transaction-safe wallet ledger
- Firebase ID-token verification
- Protected wallet, deposit, withdrawal and admin routes
- Zod request validation, rate limits, Helmet security headers, no-store API responses
- Backend security tests and a typed frontend API client
- PWA service-worker settings that do not cache API responses

## Important: frontend money flows are not switched yet

The existing phone account flow in `src/services/phoneAuth.ts` keeps account credentials and session data in browser localStorage. It does not issue a Firebase Auth ID token, so the new backend cannot authenticate those existing phone sessions.

The current frontend still uses legacy Firestore/localStorage functions for wallet balances, deposits, withdrawals, referrals, bonuses and admin actions. Existing user balances and pending requests have not been migrated into PostgreSQL. For those reasons:

- Do not deploy this branch over production until the hosting configuration and data migration are planned.
- Do not replace the current Firestore Rules with deny-all rules yet; that would break legacy app functionality.
- Do not connect the new endpoints to deposit/withdraw controls until old balances, locked bonuses and pending requests are reconciled.

## Hosting configuration

The included `server.ts` serves the built frontend and API from one Node web service. To use it, the Render service must be a **Web Service** (not a Static Site):

- Build: `npm install && npm run build`
- Start: `npm start`
- Runtime: Node.js 24 or newer

Set these server-side environment variables in Render:

- `NODE_ENV=production`
- `DATABASE_URL`: the existing Neon connection string (secret)
- `FIREBASE_PROJECT_ID=ai-studio-applet-webapp-98aca`
- `ADMIN_EMAILS`: comma-separated list of verified Firebase email addresses that should receive initial admin role
- `ALLOWED_ORIGINS`: may be empty for same-origin hosting

Never put `DATABASE_URL` or any secret in a `VITE_*` variable or commit a real credential.

## Before enabling money operations

1. Implement server-verifiable authentication for phone accounts.
2. Migrate and reconcile users, current balances, locked bonuses, referrals and pending requests.
3. Switch the UI to the backend API in a controlled, account-type-aware rollout.
4. Test registration/login, wallet, deposits, withdrawals, admin approvals, referral rewards and recovery flows end-to-end.
5. Only after the legacy client writes are removed, tighten Firestore Rules and verify there are no hidden dependencies.
