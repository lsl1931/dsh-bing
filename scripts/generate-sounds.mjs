// Generate the built-in notification sounds.
//
// The pack is deliberately electronic and minimal: short sine/square/FM
// gestures, no reverb, no orchestral samples. Generator output stays
// license-clean and reproducible: the output is ours, released MIT.
//
// Usage:
//   node scripts/generate-sounds.mjs            write sounds/*.wav
//   node scripts/generate-sounds.mjs --check    validate the committed files
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeWav, readWavStats } from './lib/wav.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const catalog = JSON.parse(readFileSync(join(root, 'sounds', 'catalog.json'), 'utf8'))
const TAU = Math.PI * 2
const SAMPLE_RATE = catalog.sampleRate

/** Default peak; individual catalog entries override it for loudness. */
const TARGET_PEAK = 0.7

/**
 * Add one gliding sine tone with an optional harmonic.
 * @param {Float64Array} out - destination buffer.
 * @param {object} options - tone description.
 */
function addTone(out, options) {
  const {
    start = 0,
    duration,
    from,
    to = from,
    gain = 1,
    tau,
    attack = 0.002,
    harmonic = 0,
    harmonicGain = 0,
    lowpass = 0,
  } = options
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  const decay = tau === undefined ? duration / 3 : tau
  let phase = 0
  let harmonicPhase = 0
  let lp = 0
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    const frequency = from + (to - from) * (time / duration)
    phase += (TAU * frequency) / SAMPLE_RATE
    let sample = Math.sin(phase)
    if (harmonicGain !== 0) {
      harmonicPhase += (TAU * frequency * harmonic) / SAMPLE_RATE
      sample += harmonicGain * Math.sin(harmonicPhase)
    }
    const envelope = Math.min(1, time / attack) * Math.exp(-time / decay)
    let value = sample * envelope * gain
    if (lowpass > 0) {
      lp += (value - lp) * lowpass
      value = lp
    }
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += value
  }
}

/**
 * Add a soft odd-harmonic tone (square-ish, low-passed) for the error pair.
 * @param {Float64Array} out - destination buffer.
 * @param {object} options - tone description.
 */
function addSquare(out, options) {
  const { start = 0, duration, from, to = from, gain = 1, tau, lowpass = 0.2 } = options
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  const decay = tau === undefined ? duration / 3 : tau
  let phase = 0
  let lp = 0
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    const frequency = from + (to - from) * (time / duration)
    phase += (TAU * frequency) / SAMPLE_RATE
    const sample =
      Math.sin(phase) +
      Math.sin(phase * 3) / 3 +
      Math.sin(phase * 5) / 5 +
      Math.sin(phase * 7) / 7
    const envelope = Math.min(1, time / 0.003) * Math.exp(-time / decay)
    lp += (sample * envelope * gain - lp) * lowpass
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += lp
  }
}

/**
 * Add a small additive bell (the one metallic sound).
 * @param {Float64Array} out - destination buffer.
 * @param {object} options - bell description.
 */
function addBell(out, options) {
  const { start = 0, duration, frequency, gain = 1, tau } = options
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  const decay = tau === undefined ? duration / 4 : tau
  const partials = [
    [1, 1],
    [2.01, 0.3],
    [3.0, 0.1],
    [4.2, 0.04],
  ]
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    let sample = 0
    for (const [ratio, amplitude] of partials) {
      sample += amplitude * Math.sin(TAU * frequency * ratio * time)
    }
    const envelope = Math.min(1, time / 0.002) * Math.exp(-time / decay)
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += sample * envelope * gain
  }
}

/**
 * Fade the edges and normalize to the entry's peak target.
 * @param {Float64Array} out - buffer to finish.
 * @param {number} targetPeak - peak amplitude in [0, 1].
 */
function finish(out, targetPeak) {
  const fadeIn = Math.round(0.002 * SAMPLE_RATE)
  const fadeOut = Math.round(0.03 * SAMPLE_RATE)
  let peak = 0
  for (let index = 0; index < out.length; index += 1) {
    if (index < fadeIn) out[index] *= index / fadeIn
    const fromEnd = out.length - 1 - index
    if (fromEnd < fadeOut) out[index] *= fromEnd / fadeOut
    const magnitude = Math.abs(out[index])
    if (magnitude > peak) peak = magnitude
  }
  if (peak === 0) throw new Error('sound is silent')
  const scale = targetPeak / peak
  for (let index = 0; index < out.length; index += 1) out[index] *= scale
  return out
}

/** Recipe per catalog id. */
const RECIPES = {
  'builtin:pulse': (out) => {
    addTone(out, { duration: 0.28, from: 1046.5, to: 784.0, tau: 0.11, gain: 0.9, harmonic: 2, harmonicGain: 0.08 })
  },
  'builtin:blip': (out) => {
    addTone(out, { start: 0, duration: 0.1, from: 1318.5, tau: 0.045, gain: 0.8 })
    addTone(out, { start: 0.12, duration: 0.11, from: 1568.0, tau: 0.05, gain: 0.7 })
  },
  'builtin:tick': (out) => {
    // A clean high blip, not noise: the minimal "your input is needed" sound.
    addTone(out, { duration: 0.09, from: 1568, to: 1396.91, tau: 0.018, gain: 1.1, harmonic: 2, harmonicGain: 0.1 })
  },
  'builtin:scan': (out) => {
    addTone(out, { duration: 0.31, from: 523.25, to: 1046.5, tau: 0.2, gain: 0.8, harmonic: 2, harmonicGain: 0.1 })
  },
  'builtin:low': (out) => {
    addTone(out, { duration: 0.45, from: 110, to: 82.41, tau: 0.22, gain: 1, harmonic: 2, harmonicGain: 0.2, lowpass: 0.25 })
  },
  'builtin:error': (out) => {
    addSquare(out, { start: 0, duration: 0.18, from: 440, tau: 0.09, gain: 0.7, lowpass: 0.2 })
    addSquare(out, { start: 0.24, duration: 0.24, from: 329.63, tau: 0.12, gain: 0.65, lowpass: 0.2 })
  },
  'builtin:arc': (out) => {
    const notes = [1046.5, 1318.5, 1568.0]
    notes.forEach((frequency, index) => {
      addTone(out, {
        start: index * 0.09,
        duration: 0.22,
        from: frequency,
        tau: 0.07,
        gain: 0.65,
        harmonic: 2,
        harmonicGain: 0.1,
      })
    })
  },
  'builtin:chime': (out) => {
    addBell(out, { duration: 0.7, frequency: 1568.0, tau: 0.28, gain: 0.8 })
  },
}

/**
 * Render one catalog entry to the exact bytes the repository should hold.
 * @param {object} entry - one catalog row.
 * @returns {Buffer} the WAV bytes.
 */
function render(entry) {
  const recipe = RECIPES[entry.id]
  if (recipe === undefined) throw new Error('no recipe for ' + entry.id)
  const out = new Float64Array(Math.round(entry.seconds * SAMPLE_RATE))
  recipe(out)
  finish(out, entry.peak ?? TARGET_PEAK)
  return encodeWav(out, SAMPLE_RATE)
}

function generate() {
  const outDir = join(root, 'sounds')
  mkdirSync(outDir, { recursive: true })
  const rows = []
  for (const entry of catalog.sounds) {
    const path = join(outDir, entry.file)
    writeFileSync(path, render(entry))
    const stats = readWavStats(path)
    rows.push({ id: entry.id, file: entry.file, seconds: stats.seconds, peak: stats.peak, rms: stats.rms })
  }
  return rows
}

function check() {
  let failed = 0
  const rows = []
  for (const entry of catalog.sounds) {
    const path = join(root, 'sounds', entry.file)
    if (!existsSync(path)) {
      console.error('missing: ' + entry.file)
      failed += 1
      continue
    }
    const stats = readWavStats(path)
    const problems = []
    if (stats.format !== 1) problems.push('format=' + stats.format)
    if (stats.channels !== 1) problems.push('channels=' + stats.channels)
    if (stats.sampleRate !== SAMPLE_RATE) problems.push('sampleRate=' + stats.sampleRate)
    if (stats.bits !== 16) problems.push('bits=' + stats.bits)
    if (Math.abs(stats.seconds - entry.seconds) > 0.05) problems.push('seconds=' + stats.seconds.toFixed(3))
    const targetPeak = entry.peak ?? TARGET_PEAK
    if (stats.peak < targetPeak - 0.05 || stats.peak > targetPeak + 0.05) problems.push('peak=' + stats.peak.toFixed(3) + ' target=' + targetPeak)
    if (!render(entry).equals(readFileSync(path))) problems.push('bytes differ from regenerated output')
    if (problems.length > 0) failed += 1
    rows.push({ id: entry.id, file: entry.file, seconds: stats.seconds, peak: stats.peak, problems })
  }
  for (const row of rows) {
    const status = row.problems.length === 0 ? 'ok' : 'FAIL ' + row.problems.join(', ')
    console.log(row.id.padEnd(22) + row.file.padEnd(20) + row.seconds.toFixed(2) + 's  peak=' + row.peak.toFixed(2) + '  ' + status)
  }
  return failed
}

if (process.argv.includes('--check')) {
  const failed = check()
  if (failed > 0) {
    console.error(failed + ' sound(s) failed validation; run npm run sounds')
    process.exit(1)
  }
  console.log('all sounds valid')
} else {
  const rows = generate()
  for (const row of rows) {
    console.log(row.id.padEnd(22) + row.file.padEnd(20) + row.seconds.toFixed(2) + 's  peak=' + row.peak.toFixed(2) + '  rms=' + row.rms.toFixed(3))
  }
  console.log('wrote ' + rows.length + ' sound(s)')
}