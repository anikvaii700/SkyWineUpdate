import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.ts';
import { createAuthMiddleware, type AuthMiddlewareDeps } from './middleware/auth.ts';
import { errorHandler, HttpError } from './middleware/errorHandler.ts';
import { generalApiLimiter } from './middleware/rateLimit.ts';
import { createAdminRouter } from './routes/admin.ts';
import { createPublicRouter } from './routes/public.ts';
import { createWalletRouter } from './routes/wallet.ts';
import { createEmailOtpRouter } from './routes/emailOtp.ts';
import { createPhoneAuthRouter } from './routes/phoneAuth.ts';

export interface CreateAppOptions {
  authDeps?: AuthMiddlewareDeps;
  allowedOrigins?: string[];
  disableRateLimit?: boolean;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // Render and AI Studio run behind a reverse proxy; trust the first proxy hop for accurate req.ip.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Preserve Firebase signInWithPopup and embedded preview compatibility while keeping security headers.
      frameguard: false,
      contentSecurityPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    })
  );

  const configuredOrigins = new Set(
    (options.allowedOrigins ?? env.allowedOrigins).map((origin) => origin.replace(/\/+$/, ''))
  );

  app.use(
    '/api',
    (req, res, next) => {
      const requestOrigin = req.headers.origin;
      if (!requestOrigin) {
        next();
        return;
      }

      const normalizedOrigin = requestOrigin.replace(/\/+$/, '');
      const hostHeader = req.headers.host;
      const forwardedHostRaw = req.headers['x-forwarded-host'];
      const forwardedHost = Array.isArray(forwardedHostRaw)
        ? forwardedHostRaw[0]?.split(',')[0]?.trim()
        : forwardedHostRaw?.split(',')[0]?.trim();
      const ngAllowedHosts = (process.env.NG_ALLOWED_HOSTS || '')
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean);

      const allowedSameOriginHosts = new Set<string>(
        [hostHeader, forwardedHost, ...ngAllowedHosts].filter((h): h is string => Boolean(h))
      );

      const isSameOrigin = Array.from(allowedSameOriginHosts).some(
        (h) => normalizedOrigin === `https://${h}` || normalizedOrigin === `http://${h}`
      );

      const isLocalDevOrigin =
        !env.isProduction &&
        (normalizedOrigin === 'http://localhost:3000' ||
          normalizedOrigin === 'http://127.0.0.1:3000');

      const isAllowed =
        configuredOrigins.has(normalizedOrigin) ||
        isSameOrigin ||
        isLocalDevOrigin;

      if (!isAllowed) {
        next(new HttpError(403, 'CORS_FORBIDDEN', 'Origin is not allowed by CORS policy.'));
        return;
      }

      cors({
        origin: normalizedOrigin,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        credentials: true,
        maxAge: 600,
      })(req, res, next);
    }
  );

  app.use('/api', express.json({ limit: '64kb' }));

  // Ensure API responses are never cached by browsers, proxies, or service workers.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  if (!options.disableRateLimit) {
    app.use('/api', generalApiLimiter);
  }

  const { requireAuth, requireAdmin } = createAuthMiddleware(options.authDeps);

  app.use('/api', createPublicRouter());
  app.use('/api', createEmailOtpRouter());
  app.use('/api', createPhoneAuthRouter());
  app.use('/api', createWalletRouter(requireAuth));
  app.use('/api/admin', requireAuth, requireAdmin, createAdminRouter());

  app.use('/api', (_req, _res, next) => {
    next(new HttpError(404, 'NOT_FOUND', 'API endpoint not found.'));
  });

  app.use(errorHandler);

  return app;
}
