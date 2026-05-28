// ── audio-codec.ts ────────────────────────────────────────────────────────────
// G.711 mu-law (PCMU) encode/decode and PCM resampling utilities for SIP RTP.
//
// Reference: Sun Microsystems G.711 implementation (public domain).
// All functions are pure and allocation-friendly for real-time audio paths.

// Exponent lookup table for mu-law encoding (maps bits[14:7] → exponent 0-7)
const EXP_LUT = new Uint8Array([
  0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,
  4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
  5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
  5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
])

const PCMU_BIAS = 0x84   // 132 — G.711 encoding bias
const PCMU_CLIP = 32635  // max input magnitude before clipping

// Decode table for mu-law exponent → base magnitude
const DECODE_BASE = [0, 132, 396, 924, 1980, 4092, 8316, 16764]

// Silence byte in G.711 mu-law (encodes PCM 0)
export const PCMU_SILENCE = 0x7F

// ── Single-sample encode/decode ──────────────────────────────────────────────

export function pcmuEncode(sample: number): number {
  const sign = (sample >> 8) & 0x80
  if (sign) sample = -sample
  if (sample > PCMU_CLIP) sample = PCMU_CLIP
  sample += PCMU_BIAS
  const exponent = EXP_LUT[(sample >> 7) & 0xFF]
  const mantissa = (sample >> (exponent + 3)) & 0x0F
  return (~(sign | (exponent << 4) | mantissa)) & 0xFF
}

export function pcmuDecode(byte: number): number {
  const b        = (~byte) & 0xFF
  const sign     = b & 0x80
  const exponent = (b >> 4) & 0x07
  const mantissa = b & 0x0F
  let   sample   = DECODE_BASE[exponent] + (mantissa << (exponent + 3))
  return sign ? -sample : sample
}

// ── Buffer-level encode/decode ───────────────────────────────────────────────

/** Decode a PCMU RTP payload (8kHz, 1-byte/sample) → Int16Array of 16-bit PCM */
export function decodePCMUBuffer(pcmu: Buffer): Int16Array {
  const out = new Int16Array(pcmu.length)
  for (let i = 0; i < pcmu.length; i++) out[i] = pcmuDecode(pcmu[i])
  return out
}

/** Encode Int16Array of 16-bit PCM → PCMU Buffer (8kHz, 1-byte/sample) */
export function encodePCMUBuffer(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcmuEncode(pcm[i])
  return out
}

/** Generate a silence PCMU buffer of `samples` bytes */
export function silencePCMU(samples: number): Buffer {
  return Buffer.alloc(samples, PCMU_SILENCE)
}

// ── G.711 A-law (PCMA) encode/decode ────────────────────────────────────────
// Reference: ITU-T G.711 / Sun Microsystems implementation (public domain).

const PCMA_SEG_END = new Int16Array([0x1F, 0x3F, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF])

export const PCMA_SILENCE = 0xD5  // pcmaEncode(0) — fills silent RTP packets

export function pcmaEncode(sample: number): number {
  let val = sample >> 3
  let mask: number
  if (val >= 0) {
    mask = 0xD5
  } else {
    mask = 0x55
    val  = -val - 1
  }
  if (val > 0xFFF) val = 0xFFF
  let seg = 8
  for (let i = 0; i < 8; i++) {
    if (val <= PCMA_SEG_END[i]) { seg = i; break }
  }
  if (seg >= 8) return (0x7F ^ mask) & 0xFF
  const mantissa = seg < 2 ? (val >> 1) & 0x0F : (val >> seg) & 0x0F
  return (((seg << 4) | mantissa) ^ mask) & 0xFF
}

export function pcmaDecode(byte: number): number {
  const a    = byte ^ 0x55
  const sign = a & 0x80
  const seg  = (a & 0x70) >> 4
  let   t    = (a & 0x0F) << 4
  if (seg === 0) {
    t += 8
  } else if (seg === 1) {
    t += 0x108
  } else {
    t = (t + 0x108) << (seg - 1)
  }
  return sign ? t : -t
}

/** Decode a PCMA RTP payload (8kHz, 1-byte/sample) → Int16Array of 16-bit PCM */
export function decodePCMABuffer(pcma: Buffer): Int16Array {
  const out = new Int16Array(pcma.length)
  for (let i = 0; i < pcma.length; i++) out[i] = pcmaDecode(pcma[i])
  return out
}

/** Encode Int16Array of 16-bit PCM → PCMA Buffer (8kHz, 1-byte/sample) */
export function encodePCMABuffer(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcmaEncode(pcm[i])
  return out
}

/** Generate a silence PCMA buffer of `samples` bytes */
export function silencePCMA(samples: number): Buffer {
  return Buffer.alloc(samples, PCMA_SILENCE)
}

// ── Resampling ───────────────────────────────────────────────────────────────

/**
 * Upsample Int16Array from 8 kHz → 16 kHz via linear interpolation (2×).
 * ElevenLabs ConvAI expects 16 kHz PCM input.
 */
export function upsample8to16k(samples: Int16Array): Int16Array {
  const out = new Int16Array(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    out[i * 2]     = samples[i]
    out[i * 2 + 1] = i + 1 < samples.length
      ? (samples[i] + samples[i + 1]) >> 1
      : samples[i]
  }
  return out
}

/**
 * Downsample Int16Array from 16 kHz → 8 kHz via averaging (2:1).
 * Used after receiving TTS audio from ElevenLabs before encoding to PCMU.
 */
export function downsample16to8k(samples: Int16Array): Int16Array {
  const len = samples.length >> 1
  const out = new Int16Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = (samples[i * 2] + samples[i * 2 + 1]) >> 1
  }
  return out
}

// ── PCM ↔ raw Buffer (little-endian int16) ───────────────────────────────────

/** Int16Array → little-endian Buffer (raw PCM bytes, 2 bytes per sample) */
export function int16ToLE(samples: Int16Array): Buffer {
  const buf = Buffer.allocUnsafe(samples.length * 2)
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], i * 2)
  return buf
}

/** Little-endian Buffer → Int16Array (raw PCM, 2 bytes per sample) */
export function leToInt16(buf: Buffer): Int16Array {
  const len = buf.length >> 1
  const out = new Int16Array(len)
  for (let i = 0; i < len; i++) out[i] = buf.readInt16LE(i * 2)
  return out
}
