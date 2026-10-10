// Call Captions server.
//
// Serves the agent caption window and relays caller audio to a speech-to-text
// provider. Audio and transcripts are passed through in memory only: nothing is
// written to disk, and transcript text is never logged.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { loadProvider } = require('./providers');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // No .env file; rely on the real environment.
}

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_SESSION_MS = 4 * 60 * 60 * 1000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('ok');
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, SECURITY_HEADERS).end('Not found');
      return;
    }
    const type = CONTENT_TYPES[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, ...SECURITY_HEADERS });
    res.end(data);
  });
}

function createServer({ provider }) {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/captions') {
      socket.destroy();
      return;
    }
    if (ACCESS_TOKEN && url.searchParams.get('token') !== ACCESS_TOKEN) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleClient(ws, provider));
  });

  return server;
}

function handleClient(ws, provider) {
  let session = null;
  let starting = false;
  let closed = false;
  const send = (msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const timeLimit = setTimeout(() => ws.close(1000, 'Session time limit reached'), MAX_SESSION_MS);

  const endSession = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timeLimit);
    if (session) session.close();
    session = null;
  };

  ws.on('message', async (data, isBinary) => {
    if (isBinary) {
      if (session) session.sendAudio(data);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === 'start' && !starting && !closed) {
      starting = true;
      const sampleRate = Number(msg.sampleRate) || 16000;
      try {
        session = await provider.createSession({
          sampleRate,
          onCaption: ({ text, isFinal }) => send({ type: 'caption', text, final: isFinal }),
          onError: (message) => send({ type: 'error', message }),
          onClose: () => send({ type: 'status', state: 'provider-closed' }),
        });
        if (closed) {
          session.close();
          return;
        }
        send({ type: 'status', state: 'listening', provider: provider.name });
      } catch (err) {
        console.error(`[${provider.name}] failed to start session: ${err.message}`);
        send({ type: 'error', message: `Could not start the speech service: ${err.message}` });
      }
    } else if (msg.type === 'stop') {
      endSession();
      send({ type: 'status', state: 'stopped' });
    }
  });

  ws.on('close', endSession);
  ws.on('error', endSession);
}

if (require.main === module) {
  const provider = loadProvider(process.env.CAPTION_PROVIDER || 'mock');
  const server = createServer({ provider });
  server.listen(PORT, HOST, () => {
    console.log(`Call Captions running at http://${HOST}:${PORT} (provider: ${provider.name})`);
    if (provider.name === 'mock') {
      console.log('Using the demo provider: captions are scripted, not real speech recognition.');
    }
  });
}

module.exports = { createServer };
