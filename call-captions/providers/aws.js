// Amazon Transcribe streaming. Transcribe is HIPAA-eligible under the AWS BAA.
// Credentials come from the standard AWS chain (env vars, profile, or role).
//
// Transcribe bills for audio streamed and ends a stream that goes 15 seconds
// without audio. The caption window stops sending audio during silence, so this
// provider opens a stream when audio arrives and closes it after a quiet spell.
// Agents can leave captions on all shift and only talk time is billed.

const IDLE_CLOSE_MS = 8000;

function defaultClient() {
  let sdk;
  try {
    sdk = require('@aws-sdk/client-transcribe-streaming');
  } catch {
    throw new Error('Install @aws-sdk/client-transcribe-streaming to use the AWS provider');
  }
  const client = new sdk.TranscribeStreamingClient({ region: process.env.AWS_REGION || 'us-east-1' });
  return {
    client,
    startStream: (input) => client.send(new sdk.StartStreamTranscriptionCommand(input)),
  };
}

const provider = {
  name: 'aws',
  createClient: defaultClient,
  idleCloseMs: IDLE_CLOSE_MS,

  async createSession({ sampleRate, onCaption, onError }) {
    const { client, startStream } = provider.createClient();

    // Fail on Start, not on the first word, if credentials are missing.
    try {
      await client.config.credentials();
    } catch (err) {
      client.destroy();
      throw new Error(`AWS credentials not found (${err.message})`);
    }

    let stream = null;
    let closed = false;

    function openStream() {
      const s = { queue: [], ended: false, wake: null, idleTimer: null };
      const notify = () => s.wake && s.wake();
      s.push = (chunk) => {
        s.queue.push(chunk);
        notify();
      };
      s.end = () => {
        s.ended = true;
        clearTimeout(s.idleTimer);
        notify();
      };

      async function* audioStream() {
        while (true) {
          if (s.queue.length > 0) {
            yield { AudioEvent: { AudioChunk: s.queue.shift() } };
          } else if (s.ended) {
            return;
          } else {
            await new Promise((resolve) => (s.wake = resolve));
            s.wake = null;
          }
        }
      }

      (async () => {
        try {
          const response = await startStream({
            LanguageCode: process.env.CAPTION_LANGUAGE || 'en-US',
            MediaEncoding: 'pcm',
            MediaSampleRateHertz: sampleRate,
            EnablePartialResultsStabilization: true,
            PartialResultsStability: 'high',
            AudioStream: audioStream(),
          });
          for await (const event of response.TranscriptResultStream) {
            for (const result of event.TranscriptEvent?.Transcript?.Results || []) {
              const text = result.Alternatives?.[0]?.Transcript || '';
              if (text) onCaption({ text, isFinal: !result.IsPartial });
            }
          }
        } catch (err) {
          if (!closed) onError(`Speech service error: ${err.message}`);
        } finally {
          s.end();
          if (stream === s) stream = null;
        }
      })();

      return s;
    }

    return {
      sendAudio(buf) {
        if (closed) return;
        if (!stream) stream = openStream();
        stream.push(new Uint8Array(buf));
        clearTimeout(stream.idleTimer);
        const s = stream;
        s.idleTimer = setTimeout(() => {
          if (stream === s) stream = null;
          s.end();
        }, provider.idleCloseMs);
      },
      close() {
        closed = true;
        if (stream) stream.end();
        stream = null;
        setTimeout(() => client.destroy(), 3000).unref();
      },
    };
  },
};

module.exports = provider;
