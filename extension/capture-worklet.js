// Runs on the audio thread: collects microphone samples and posts them in ~100 ms blocks.
class WakeCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(Math.round(sampleRate / 10));
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let offset = 0;
    while (offset < input.length) {
      const n = Math.min(input.length - offset, this.block.length - this.filled);
      this.block.set(input.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === this.block.length) {
        this.port.postMessage(this.block.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('wake-capture', WakeCapture);
