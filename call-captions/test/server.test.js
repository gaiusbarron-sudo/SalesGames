const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createServer } = require('../server');
const { loadProvider } = require('../providers');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function collect(ws, until) {
  const msgs = [];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out; got ${JSON.stringify(msgs)}`)), 5000);
    ws.on('message', (data) => {
      msgs.push(JSON.parse(data.toString()));
      if (until(msgs)) {
        clearTimeout(timeout);
        resolve(msgs);
      }
    });
  });
}

test('serves the caption window', async (t) => {
  const server = createServer({ provider: loadProvider('mock') });
  const port = await listen(server);
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /Call Captions/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);
});

test('mock provider streams interim and final captions while audio arrives', async (t) => {
  const server = createServer({ provider: loadProvider('mock') });
  const port = await listen(server);
  t.after(() => server.close());

  const ws = new WebSocket(`ws://127.0.0.1:${port}/captions`);
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'start', sampleRate: 16000 }));
  const audio = setInterval(() => ws.send(Buffer.alloc(3200)), 100);
  t.after(() => {
    clearInterval(audio);
    ws.close();
  });

  const msgs = await collect(ws, (m) => m.some((x) => x.type === 'caption' && x.final));
  assert.deepStrictEqual(msgs[0], { type: 'status', state: 'listening', provider: 'mock' });
  const captions = msgs.filter((x) => x.type === 'caption');
  assert.ok(captions.some((c) => !c.final), 'expected interim captions');
  assert.match(captions.at(-1).text, /denied/);
});

test('deepgram provider relays audio and maps results', async (t) => {
  const fake = new WebSocket.Server({ port: 0 });
  const received = { audioBytes: 0, url: null, auth: null, closeStream: false };
  fake.on('connection', (sock, req) => {
    received.url = new URL(req.url, 'http://x');
    received.auth = req.headers.authorization;
    sock.on('message', (data, isBinary) => {
      if (isBinary) {
        received.audioBytes += data.length;
        if (received.audioBytes === 3200) {
          sock.send(JSON.stringify({ type: 'Metadata' }));
          sock.send(JSON.stringify({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'my claim' }] } }));
          sock.send(JSON.stringify({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'My claim was denied.' }] } }));
          sock.send(JSON.stringify({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: '' }] } }));
        }
      } else if (JSON.parse(data.toString()).type === 'CloseStream') {
        received.closeStream = true;
      }
    });
  });
  await new Promise((r) => fake.once('listening', r));
  process.env.DEEPGRAM_API_KEY = 'test-key';
  process.env.DEEPGRAM_URL = `ws://127.0.0.1:${fake.address().port}/v1/listen`;

  const server = createServer({ provider: loadProvider('deepgram') });
  const port = await listen(server);
  t.after(() => {
    server.close();
    fake.close();
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}/captions`);
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'start', sampleRate: 16000 }));
  const msgs = collect(ws, (m) => m.some((x) => x.type === 'caption' && x.final));
  await new Promise((r) => setTimeout(r, 100));
  ws.send(Buffer.alloc(3200));

  const got = (await msgs).filter((x) => x.type === 'caption');
  assert.deepStrictEqual(got, [
    { type: 'caption', text: 'my claim', final: false },
    { type: 'caption', text: 'My claim was denied.', final: true },
  ]);
  assert.strictEqual(received.auth, 'Token test-key');
  assert.strictEqual(received.url.searchParams.get('encoding'), 'linear16');
  assert.strictEqual(received.url.searchParams.get('sample_rate'), '16000');
  assert.strictEqual(received.url.searchParams.get('interim_results'), 'true');

  ws.send(JSON.stringify({ type: 'stop' }));
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(received.closeStream, 'expected CloseStream on stop');
  ws.close();
});
