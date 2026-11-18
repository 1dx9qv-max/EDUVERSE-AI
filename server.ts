import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './server/api.ts';
import { attachVoiceLiveWebSocket } from './server/voiceLive.ts';
import { attachStudyRoomWebSocket } from './server/studyRooms.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use((err: { type?: string } | null, _req: express.Request, res: express.Response, next: express.NextFunction) => {
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

// Mount API routes
app.use('/api', apiRouter);

// In production, serve the built Vite SPA
const distPath = path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.resolve(distPath, 'index.html'));
});

const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`EDUVERSE AI server listening on http://0.0.0.0:${PORT}`);
});
attachVoiceLiveWebSocket(httpServer);
attachStudyRoomWebSocket(httpServer);
