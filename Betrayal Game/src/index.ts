import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import type { GameState } from './game/types.js';
import { handleConnection } from './ws/router.js';
import { cleanupExpiredDisconnections } from './ws/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 5000;
const CLIENT_DIST = join(__dirname, '..', 'client', 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const httpServer = createServer((req, res) => {
  let filePath = req.url ?? '/';

  if (filePath === '/') {
    filePath = '/index.html';
  }

  const fullPath = join(CLIENT_DIST, filePath);

  if (existsSync(fullPath) && statSync(fullPath).isFile()) {
    try {
      const content = readFileSync(fullPath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('Error loading file');
    }
  } else {
    try {
      const indexPath = join(CLIENT_DIST, 'index.html');
      const content = readFileSync(indexPath);
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

const wss = new WebSocketServer({ server: httpServer });

const games = new Map<string, GameState>();
const playerConnections = new Map<string, WebSocket>();
const sessionTokens = new Map<string, { playerId: string; sessionId: string }>();
const disconnectedPlayers = new Map<string, { playerId: string; sessionId: string; disconnectedAt: number }>();

const GRACE_PERIOD_MS = 60000;

setInterval(
  () => cleanupExpiredDisconnections(disconnectedPlayers, sessionTokens, GRACE_PERIOD_MS),
  15000
);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Betrayal Game Server running on http://0.0.0.0:${PORT}`);
  console.log(`🔌 WebSocket available at ws://0.0.0.0:${PORT}`);
});

wss.on('connection', (ws: WebSocket) => {
  handleConnection(ws, { games, playerConnections, sessionTokens, disconnectedPlayers });
});
