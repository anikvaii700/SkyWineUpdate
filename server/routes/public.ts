import { Router } from 'express';
import { env } from '../config/env.ts';
import { checkDatabaseHealth } from '../db/pool.ts';
import { getPublicPaymentSettings } from '../services/walletLedger.ts';

export function createPublicRouter(): Router {
  const router = Router();

  router.get('/health', async (_req, res, next) => {
    try {
      const database = await checkDatabaseHealth();
      res.status(database === 'error' ? 503 : 200).json({
        ok: database !== 'error',
        service: 'skywinbd-api',
        database,
        authVerifier: env.firebaseProjectId ? 'ready' : 'unconfigured',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/public/config', async (_req, res, next) => {
    try {
      const paymentSettings = await getPublicPaymentSettings();
      res.json({ paymentSettings });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
