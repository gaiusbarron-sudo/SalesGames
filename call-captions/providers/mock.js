// Demo provider: plays back a scripted caller while audio is arriving, so the
// caption window can be tried without a speech service account. It does not
// recognize speech.

const SCRIPT = [
  "Hi, I'm calling about a claim that was denied last month.",
  'The claim number is on the letter, let me find it.',
  'It was for an MRI my doctor ordered for my knee.',
  'The letter says it needed prior authorization, but the office told me they sent it.',
  'Can you check whether the authorization is on file?',
  "Also, I'd like to know what my out-of-pocket maximum is this year.",
  "Okay, thank you. What's the best way to file an appeal?",
];

const WORD_MS = 280;
const AUDIO_IDLE_MS = 1500;

module.exports = {
  name: 'mock',
  async createSession({ onCaption }) {
    let lastAudio = 0;
    let line = 0;
    let word = 0;

    const timer = setInterval(() => {
      if (Date.now() - lastAudio > AUDIO_IDLE_MS) return;
      const words = SCRIPT[line % SCRIPT.length].split(' ');
      word += 1;
      const text = words.slice(0, word).join(' ');
      if (word >= words.length) {
        onCaption({ text, isFinal: true });
        line += 1;
        word = 0;
      } else {
        onCaption({ text, isFinal: false });
      }
    }, WORD_MS);

    return {
      sendAudio(buf) {
        if (buf.length > 0) lastAudio = Date.now();
      },
      close() {
        clearInterval(timer);
      },
    };
  },
};
