/**
 * AudioWorklet for mic capture. Runs on audio thread; posts Float32 copies to main thread.
 * Main thread resamples to 16k, batches, and sends to Live API.
 */
class MicWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._sampleRate = options.processorOptions?.sampleRate ?? 48000;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel = input[0];
      if (channel && channel.length > 0) {
        const copy = new Float32Array(channel.length);
        copy.set(channel);
        this.port.postMessage({ samples: copy, sampleRate: this._sampleRate });
      }
    }
    return true;
  }
}

registerProcessor('mic-worklet-processor', MicWorkletProcessor);
