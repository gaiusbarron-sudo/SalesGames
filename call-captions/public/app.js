// Call Captions agent window: captures the caller's audio from the softphone,
// streams it to the server, and shows the captions that come back.

(() => {
  const TARGET_RATE = 16000;
  const FONT_MIN = 16;
  const FONT_MAX = 56;

  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const timerEl = $('timer');
  const toggleBtn = $('toggle');
  const sourceSel = $('source');
  const captionsEl = $('captions');
  const linesEl = $('lines');
  const interimEl = $('interim');
  const emptyEl = $('empty');
  const toastEl = $('toast');

  let running = false;
  let stream = null;
  let audioCtx = null;
  let ws = null;
  let timer = null;
  let startedAt = 0;
  let toastTimer = null;

  const prefs = {
    get(key, fallback) {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage unavailable; preference just won't persist.
      }
    },
  };

  let fontSize = Number(prefs.get('captionSize', 28)) || 28;
  applyFontSize();
  sourceSel.value = prefs.get('captionSource', 'display') === 'mic' ? 'mic' : 'display';

  function applyFontSize() {
    fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, fontSize));
    document.documentElement.style.setProperty('--caption-size', `${fontSize}px`);
  }

  function setStatus(state, label) {
    statusEl.dataset.state = state;
    statusEl.textContent = label;
  }

  function toast(message, ms = 4000) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
  }

  function nearBottom() {
    return captionsEl.scrollHeight - captionsEl.scrollTop - captionsEl.clientHeight < 80;
  }

  function showCaption(text, isFinal) {
    const stick = nearBottom();
    emptyEl.hidden = true;
    if (isFinal) {
      const p = document.createElement('p');
      p.className = 'line';
      p.textContent = text;
      linesEl.appendChild(p);
      interimEl.textContent = '';
    } else {
      interimEl.textContent = text;
    }
    if (stick) captionsEl.scrollTop = captionsEl.scrollHeight;
  }

  function tick() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    timerEl.textContent = s >= 3600 ? `${Math.floor(s / 3600)}:${mm.slice(-2)}:${ss}` : `${mm}:${ss}`;
  }

  async function getAudio(source) {
    if (source === 'mic') {
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    }
    // Chrome and Edge require video to be requested; we drop it right away.
    const media = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, suppressLocalAudioPlayback: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
    });
    media.getVideoTracks().forEach((t) => t.stop());
    if (media.getAudioTracks().length === 0) {
      media.getTracks().forEach((t) => t.stop());
      throw new Error(
        'No audio was shared. Start again, choose the softphone tab or Entire screen, and turn on "Share audio".'
      );
    }
    return media;
  }

  // Passes audio through while there is sound, plus a short tail, and holds it
  // back during silence (between calls, hold music aside) so the speech service
  // only bills for audio worth captioning. A little audio from just before the
  // sound starts is sent too, so first words aren't clipped.
  function silenceGate(send) {
    const THRESHOLD = 100; // RMS of 16-bit samples, about -50 dBFS
    const TAIL_MS = 2000;
    const PREROLL_CHUNKS = 3;
    const preroll = [];
    let lastSound = 0;
    return (buffer) => {
      const samples = new Int16Array(buffer);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();
      if (rms > THRESHOLD) {
        if (now - lastSound > TAIL_MS) preroll.splice(0).forEach(send);
        lastSound = now;
      }
      if (now - lastSound <= TAIL_MS) {
        send(buffer);
      } else {
        preroll.push(buffer);
        if (preroll.length > PREROLL_CHUNKS) preroll.shift();
      }
    };
  }

  function socketUrl() {
    const url = new URL('captions', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = new URLSearchParams(location.search).get('token');
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  async function start() {
    running = true;
    toggleBtn.disabled = true;
    setStatus('connecting', 'Connecting…');
    const source = sourceSel.value;
    prefs.set('captionSource', source);

    try {
      stream = await getAudio(source);
    } catch (err) {
      running = false;
      toggleBtn.disabled = false;
      setStatus('idle', 'Not listening');
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') toast(err.message, 7000);
      else toast('Audio sharing was cancelled.');
      return;
    }
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      if (running) {
        toast('Audio sharing stopped.');
        stop();
      }
    });

    let capture;
    try {
      audioCtx = new AudioContext();
      await audioCtx.audioWorklet.addModule('pcm-worklet.js');
      capture = new AudioWorkletNode(audioCtx, 'pcm-capture', {
        processorOptions: { targetRate: TARGET_RATE },
      });
    } catch (err) {
      toast(`Could not start audio processing: ${err.message}`, 7000);
      stop();
      return;
    }
    const input = audioCtx.createMediaStreamSource(stream);
    // Keep the graph pulling audio without playing it back a second time.
    const mute = audioCtx.createGain();
    mute.gain.value = 0;
    input.connect(capture).connect(mute).connect(audioCtx.destination);

    ws = new WebSocket(socketUrl());
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws.send(JSON.stringify({ type: 'start', sampleRate: TARGET_RATE }));
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'caption') {
        showCaption(msg.text, msg.final);
      } else if (msg.type === 'status' && msg.state === 'listening') {
        setStatus('live', msg.provider === 'mock' ? 'Listening (demo captions)' : 'Listening');
      } else if (msg.type === 'status' && msg.state === 'provider-closed') {
        setStatus('error', 'Disconnected');
        toast('The speech service disconnected. Press Start captions to reconnect.', 7000);
        stop(true);
      } else if (msg.type === 'error') {
        setStatus('error', 'Error');
        toast(msg.message, 8000);
        stop(true);
      }
    };
    ws.onclose = (event) => {
      if (!running) return;
      setStatus('error', 'Disconnected');
      toast(event.code === 1006 ? 'Lost connection to the caption server.' : event.reason || 'Connection closed.', 7000);
      stop(true);
    };
    const gate = silenceGate((chunk) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(chunk);
    });
    capture.port.onmessage = (event) => gate(event.data);

    startedAt = Date.now();
    tick();
    timer = setInterval(tick, 1000);
    timerEl.hidden = false;
    toggleBtn.textContent = 'Stop captions';
    toggleBtn.classList.add('stop');
    toggleBtn.disabled = false;
    sourceSel.disabled = true;
  }

  function stop(keepStatus = false) {
    running = false;
    if (interimEl.textContent) showCaption(interimEl.textContent, true);
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
      ws.close();
      ws = null;
    }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (audioCtx) audioCtx.close();
    audioCtx = null;
    clearInterval(timer);
    toggleBtn.textContent = 'Start captions';
    toggleBtn.classList.remove('stop');
    toggleBtn.disabled = false;
    sourceSel.disabled = false;
    if (!keepStatus) setStatus('idle', 'Not listening');
  }

  toggleBtn.addEventListener('click', () => (running ? stop() : start()));

  $('smaller').addEventListener('click', () => {
    fontSize -= 4;
    applyFontSize();
    prefs.set('captionSize', fontSize);
  });
  $('larger').addEventListener('click', () => {
    fontSize += 4;
    applyFontSize();
    prefs.set('captionSize', fontSize);
  });

  $('copy').addEventListener('click', async () => {
    const lines = [...linesEl.children].map((p) => p.textContent);
    if (interimEl.textContent) lines.push(interimEl.textContent);
    if (lines.length === 0) return toast('Nothing to copy yet.');
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('Transcript copied.');
    } catch {
      toast('Copy failed. Select the text and copy it manually.');
    }
  });

  $('clear').addEventListener('click', () => {
    linesEl.replaceChildren();
    interimEl.textContent = '';
    emptyEl.hidden = false;
    timerEl.hidden = !running;
  });

  window.addEventListener('beforeunload', () => running && stop());

  if (!navigator.mediaDevices?.getDisplayMedia) {
    sourceSel.value = 'mic';
    sourceSel.querySelector('option[value="display"]').disabled = true;
    toast('This browser cannot capture softphone audio. Use the latest Chrome or Edge.', 8000);
  }
})();
