// Amazon Transcribe streaming. Transcribe is HIPAA-eligible under the AWS BAA.
// Credentials come from the standard AWS chain (env vars, profile, or role).

module.exports = {
  name: 'aws',
  async createSession({ sampleRate, onCaption, onError, onClose }) {
    let sdk;
    try {
      sdk = require('@aws-sdk/client-transcribe-streaming');
    } catch {
      throw new Error('Install @aws-sdk/client-transcribe-streaming to use the AWS provider');
    }
    const { TranscribeStreamingClient, StartStreamTranscriptionCommand } = sdk;

    const client = new TranscribeStreamingClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const queue = [];
    let wake = null;
    let ended = false;

    async function* audioStream() {
      while (true) {
        if (queue.length > 0) {
          yield { AudioEvent: { AudioChunk: queue.shift() } };
        } else if (ended) {
          return;
        } else {
          await new Promise((resolve) => (wake = resolve));
          wake = null;
        }
      }
    }
    const notify = () => wake && wake();

    const response = await client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: process.env.CAPTION_LANGUAGE || 'en-US',
        MediaEncoding: 'pcm',
        MediaSampleRateHertz: sampleRate,
        EnablePartialResultsStabilization: true,
        PartialResultsStability: 'high',
        AudioStream: audioStream(),
      })
    );

    (async () => {
      try {
        for await (const event of response.TranscriptResultStream) {
          for (const result of event.TranscriptEvent?.Transcript?.Results || []) {
            const text = result.Alternatives?.[0]?.Transcript || '';
            if (text) onCaption({ text, isFinal: !result.IsPartial });
          }
        }
        if (!ended) onClose();
      } catch (err) {
        if (!ended) onError(`Speech service error: ${err.message}`);
      } finally {
        client.destroy();
      }
    })();

    return {
      sendAudio(buf) {
        if (ended) return;
        queue.push(new Uint8Array(buf));
        notify();
      },
      close() {
        ended = true;
        notify();
      },
    };
  },
};
