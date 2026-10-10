// Mixes captured audio to mono, resamples it to the target rate, and posts
// 16-bit PCM chunks of about 100 ms to the main thread.

class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetRate;
    this.ratio = sampleRate / this.targetRate;
    this.chunkSamples = Math.round(this.targetRate / 10);
    this.out = new Int16Array(this.chunkSamples);
    this.outIndex = 0;
    // Read position into [previous block's last sample, ...this block].
    this.pos = 1;
    this.mono = new Float32Array(129);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const frames = input[0].length;
    const channels = input.length;
    if (this.mono.length !== frames + 1) {
      const prev = this.mono[this.mono.length - 1];
      this.mono = new Float32Array(frames + 1);
      this.mono[0] = prev;
    }
    const mono = this.mono;
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += input[c][f];
      mono[f + 1] = sum / channels;
    }

    // Linear interpolation at the target rate; `pos` carries over between blocks.
    while (this.pos < frames) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const v = mono[i] + (mono[i + 1] - mono[i]) * frac;
      const s = Math.max(-1, Math.min(1, v));
      this.out[this.outIndex++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.outIndex === this.chunkSamples) {
        this.port.postMessage(this.out.buffer, [this.out.buffer]);
        this.out = new Int16Array(this.chunkSamples);
        this.outIndex = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= frames;
    mono[0] = mono[frames];
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
