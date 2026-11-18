import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import express from 'express';
import dotenv from 'dotenv';
import type http from 'node:http';
import { apiRouter } from './server/api';
import { attachVoiceLiveWebSocket } from './server/voiceLive';
import { attachStudyRoomWebSocket } from './server/studyRooms';

dotenv.config();

function apiConnectPlugin(): Plugin {
  return {
    name: 'api-connect-plugin',
    configureServer(server) {
      const apiApp = express();
      apiApp.use(express.json({ limit: '10mb' }));
      apiApp.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (err && err.type === 'entity.too.large') {
          res.status(413).json({
            error: 'Uploaded payload exceeds server limit. Please keep attachments under 4 MB.',
            code: 'PAYLOAD_TOO_LARGE',
            retryable: false,
          });
          return;
        }
        next(err);
      });
      apiApp.use('/api', apiRouter);
      server.middlewares.use(apiApp);
      if (server.httpServer) {
        attachVoiceLiveWebSocket(server.httpServer as http.Server);
        attachStudyRoomWebSocket(server.httpServer as http.Server);
      }
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
