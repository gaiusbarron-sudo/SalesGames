// Speech-to-text providers. Each one exports { name, createSession(opts) } where
// createSession resolves to { sendAudio(buffer), close() }. Audio arrives as
// 16-bit little-endian mono PCM at opts.sampleRate. Providers report text through
// opts.onCaption({ text, isFinal }), problems through opts.onError(message), and
// an unexpected disconnect through opts.onClose().

const PROVIDERS = {
  mock: () => require('./mock'),
  deepgram: () => require('./deepgram'),
  aws: () => require('./aws'),
};

function loadProvider(name) {
  const factory = PROVIDERS[name.toLowerCase()];
  if (!factory) {
    throw new Error(`Unknown CAPTION_PROVIDER "${name}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return factory();
}

module.exports = { loadProvider };
