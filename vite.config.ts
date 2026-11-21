import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import express from 'express';
import dotenv from 'dotenv';
import { apiRouter } from './server/api';

dotenv.config();

function apiConnectPlugin(): Plugin {
  return {
    name: 'api-connect-plugin',
    configureServer(server) {
      const apiApp = express();
      apiApp.use('/api', (req, res, next) => {
        const origin = req.headers.origin;
        const allowedEnv = (process.env.ALLOWED_ORIGINS || '')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);

        if (origin && (allowedEnv.length === 0 || allowedEnv.includes(origin))) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.status(204).end();
          return;
        }
        next();
      });
      apiApp.use(express.json({ limit: '12mb' }));
      apiApp.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (err && err.type === 'entity.too.large') {
          res.status(413).json({
            error: 'Uploaded payload exceeds server limit. Please keep total datesheet files under 6 MB.',
            code: 'PAYLOAD_TOO_LARGE',
            retryable: false,
          });
          return;
        }
        if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
          res.status(400).json({
            error: 'Malformed JSON request payload.',
            code: 'INVALID_JSON',
            retryable: false,
          });
          return;
        }
        next(err);
      });
      apiApp.use('/api', apiRouter);
      server.middlewares.use(apiApp);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiConnectPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
