// Minimal PCM WAV helpers shared by the sound generator and the tests.
// No dependencies: a sound pack that needs a package manager is a sound pack
// that breaks on the next machine.
import { readFileSync, writeFileSync } from 'node:fs'

/** Bytes per sample for the only sample format this project writes. */
const BYTES_PER_SAMPLE = 2

/**
 * Encode mono float samples as a 44.1k 16-bit PCM WAV.
 * @param {ArrayLike<number>} samples - values in [-1, 1].
 * @param {number} [sampleRate] - frames per second.
 * @returns {Buffer} the complete WAV file.
 */
export function encodeWav(samples, sampleRate = 44100) {
  const frames = samples.length
  const dataBytes = frames * BYTES_PER_SAMPLE
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // PCM chunk size
  buffer.writeUInt16LE(1, 20) // format: PCM
  buffer.writeUInt16LE(1, 22) // channels: mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28) // byte rate
  buffer.writeUInt16LE(BYTES_PER_SAMPLE, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < frames; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2)
  }
  return buffer
}

/**
 * Write mono float samples to a WAV file.
 * @param {string} path - destination path.
 * @param {ArrayLike<number>} samples - values in [-1, 1].
 * @param {number} [sampleRate] - frames per second.
 */
export function writeWav(path, samples, sampleRate = 44100) {
  writeFileSync(path, encodeWav(samples, sampleRate))
}

/**
 * Read a RIFF/WAVE header from a buffer.
 * @param {Buffer} buffer - the file bytes.
 * @returns {{channels:number, sampleRate:number, bits:number, format:number, dataOffset:number, dataBytes:number, frames:number, seconds:number}}
 */
export function parseWav(buffer) {
  if (buffer.length < 44) throw new Error('wav: file is shorter than a header')
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('wav: missing RIFF')
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('wav: missing WAVE')
  let offset = 12
  let format = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let dataOffset = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      format = buffer.readUInt16LE(body)
      channels = buffer.readUInt16LE(body + 2)
      sampleRate = buffer.readUInt32LE(body + 4)
      bits = buffer.readUInt16LE(body + 14)
    } else if (id === 'data') {
      dataOffset = body
      dataBytes = Math.min(size, buffer.length - body)
      break
    }
    offset = body + size + (size % 2)
  }
  if (dataOffset === 0) throw new Error('wav: missing data chunk')
  const blockAlign = Math.max(1, channels * (bits / 8))
  const frames = Math.floor(dataBytes / blockAlign)
  return {
    channels,
    sampleRate,
    bits,
    format,
    dataOffset,
    dataBytes,
    frames,
    seconds: frames / sampleRate,
  }
}

/**
 * Read level statistics from a WAV file.
 * @param {string} path - the file to read.
 * @returns {{seconds:number, peak:number, rms:number, channels:number, sampleRate:number, bits:number, frames:number}}
 */
export function readWavStats(path) {
  const buffer = readFileSync(path)
  const header = parseWav(buffer)
  let peak = 0
  let sum = 0
  let count = 0
  for (let offset = header.dataOffset; offset + 1 < header.dataOffset + header.dataBytes; offset += 2) {
    const value = buffer.readInt16LE(offset) / 32768
    const magnitude = Math.abs(value)
    if (magnitude > peak) peak = magnitude
    sum += value * value
    count += 1
  }
  return {
    seconds: header.seconds,
    peak,
    rms: count === 0 ? 0 : Math.sqrt(sum / count),
    channels: header.channels,
    sampleRate: header.sampleRate,
    bits: header.bits,
    frames: header.frames,
  }
}
