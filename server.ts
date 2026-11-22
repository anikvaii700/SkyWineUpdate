import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createApp } from './server/app.ts';
import { env } from './server/config/env.ts';
import { initDatabase } from './server/db/init.ts';
import { closePool } from './server/db/pool.ts';

async function startServer() {
  try {
    await initDatabase();
  } catch (err) {
    console.error(
      '[Server] Database initialization failed on startup:',
      err instanceof Error ? err.message : err
    );
  }

  const app = createApp();
  const httpServer = http.createServer(app);

  if (!env.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: !hmrDisabled,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(env.rootDir, 'dist');
    const indexHtml = path.join(distDir, 'index.html');

    if (fs.existsSync(distDir)) {
      app.use(
        express.static(distDir, {
          index: false,
          maxAge: '1h',
        })
      );

      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) {
          next();
          return;
        }
        res.sendFile(indexHtml);
      });
    } else {
      console.warn('[Server] dist/ directory not found. Run "npm run build" before starting in production.');
    }
  }

  httpServer.listen(env.port, '0.0.0.0', () => {
    console.info(`[Server] SkyWinBD server listening on http://0.0.0.0:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal: string) => {
    console.info(`[Server] Received ${signal}; shutting down cleanly.`);
    httpServer.close(async () => {
      await closePool();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
