/**
 * Voice pipeline utilities for Live API: resample to 16 kHz and batch PCM.
 * Ensures we always send 16-bit PCM at 16 kHz regardless of device sample rate.
 */

const TARGET_SAMPLE_RATE = 16000;

/**
 * Downsample Float32 mono to 16 kHz using linear interpolation.
 * Handles any input rate (e.g. 48000, 44100).
 */
export function resampleTo16k(
  input: Float32Array,
  inputSampleRate: number
): Float32Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const idx0 = Math.floor(srcIndex);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcIndex - idx0;
    output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
  }
  return output;
}

/**
 * Convert Float32 [-1, 1] to Int16 PCM (little-endian).
 */
export function float32ToInt16Pcm(float32: Float32Array): Uint8Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(int16.buffer);
}

/** ~20 ms at 16 kHz = 320 samples. Balanced latency vs message rate. */
export const BATCH_SAMPLES_16K = 320;
