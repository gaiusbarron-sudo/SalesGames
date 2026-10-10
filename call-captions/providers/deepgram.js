// Deepgram live streaming (https://developers.deepgram.com/docs/live-streaming-audio).
// Deepgram signs a BAA for HIPAA workloads; confirm yours is in place before
// sending real member calls.

const WebSocket = require('ws');

const DEFAULT_URL = 'wss://api.deepgram.com/v1/listen';
const KEEPALIVE_MS = 8000;

module.exports = {
  name: 'deepgram',
  createSession({ sampleRate, onCaption, onError, onClose }) {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) return Promise.reject(new Error('DEEPGRAM_API_KEY is not set'));

    const url = new URL(process.env.DEEPGRAM_URL || DEFAULT_URL);
    url.searchParams.set('model', process.env.DEEPGRAM_MODEL || 'nova-3');
    url.searchParams.set('language', process.env.CAPTION_LANGUAGE || 'en-US');
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', String(sampleRate));
    url.searchParams.set('channels', '1');
    url.searchParams.set('interim_results', 'true');
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('mip_opt_out', 'true');

    const dg = new WebSocket(url, { headers: { Authorization: `Token ${apiKey}` } });
    let closing = false;
    let keepAlive = null;

    return new Promise((resolve, reject) => {
      dg.once('open', () => {
        keepAlive = setInterval(() => {
          if (dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify({ type: 'KeepAlive' }));
        }, KEEPALIVE_MS);
        resolve({
          sendAudio(buf) {
            if (dg.readyState === WebSocket.OPEN) dg.send(buf);
          },
          close() {
            closing = true;
            clearInterval(keepAlive);
            if (dg.readyState === WebSocket.OPEN) {
              dg.send(JSON.stringify({ type: 'CloseStream' }));
              setTimeout(() => dg.terminate(), 2000).unref();
            } else {
              dg.terminate();
            }
          },
        });
      });

      dg.on('unexpected-response', (_req, res) => {
        reject(new Error(`Deepgram refused the connection (HTTP ${res.statusCode})`));
        dg.terminate();
      });

      dg.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (msg.type !== 'Results') return;
        const text = msg.channel?.alternatives?.[0]?.transcript || '';
        if (!text) return;
        onCaption({ text, isFinal: Boolean(msg.is_final) });
      });

      dg.on('error', (err) => {
        if (dg.readyState === WebSocket.CONNECTING) {
          reject(err);
        } else if (!closing) {
          onError(`Speech service error: ${err.message}`);
        }
      });

      dg.on('close', () => {
        clearInterval(keepAlive);
        if (!closing) onClose();
      });
    });
  },
};
