// Generate the built-in notification sounds.
//
// Why generated instead of downloaded or recorded:
//   - the repository stays license-clean (the output is ours, released MIT);
//   - the character is tunable in code, so a sound the user dislikes can be
//     changed without hunting for a replacement file;
//   - it is reproducible: same script, same bytes, auditable in review.
//
// The script is deterministic: noise uses a seeded PRNG, all offsets are
// sample counts, and each sound is normalized to its own catalog peak.
//
// Usage:
//   node scripts/generate-sounds.mjs            write sounds/*.wav
//   node scripts/generate-sounds.mjs --check    validate the committed files
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeWav, readWavStats } from './lib/wav.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const catalogPath = join(root, 'sounds', 'catalog.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const TAU = Math.PI * 2
const SAMPLE_RATE = catalog.sampleRate

/** Default peak: about -1.9 dBFS. Sustained tones override it in catalog.json. */
const TARGET_PEAK = 0.8

/** A small deterministic PRNG for percussive noise. */
function mulberry32(seed) {
  let state = seed >>> 0
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Add one exponentially decaying partial stack ("bell", "marimba", "harp").
 * @param {Float64Array} out - destination buffer.
 * @param {object} options - tone description.
 */
function addTone(out, options) {
  const {
    start = 0,
    duration,
    frequency,
    partials = [[1, 1]],
    tau,
    gain = 1,
    attack = 0.004,
    lowpass = 0,
    detune = 0,
  } = options
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  const decay = tau === undefined ? duration / 3 : tau
  let lp = 0
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    let sample = 0
    for (const [ratio, amplitude] of partials) {
      sample += amplitude * Math.sin(TAU * frequency * ratio * (1 + detune) * time)
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
 * Add a soft two-partial note with an attack/release envelope (for "error").
 * @param {Float64Array} out - destination buffer.
 * @param {object} options - note description.
 */
function addSoftNote(out, options) {
  const { start, duration, frequency, gain = 1, attack = 0.02, release = 0.2 } = options
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    const inAttack = Math.min(1, time / attack)
    const left = duration - time
    const inRelease = Math.min(1, Math.max(0, left / release))
    const envelope = inAttack * inRelease
    const sample =
      Math.sin(TAU * frequency * time) +
      0.18 * Math.sin(TAU * frequency * 3 * time) +
      0.06 * Math.sin(TAU * frequency * 5 * time)
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += sample * envelope * gain
  }
}

/**
 * Add a filtered noise + resonant click (woodblock).
 * @param {Float64Array} out - destination buffer.
 * @param {object} options - hit description.
 */
function addWoodblock(out, options) {
  const { start, frequency, gain = 1, random } = options
  const duration = 0.16
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  let lp = 0
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    const noise = random() * 2 - 1
    const click = 0.55 * Math.sin(TAU * frequency * time) + 0.2 * Math.sin(TAU * frequency * 2.7 * time)
    const body = 0.35 * noise
    lp += (body - lp) * 0.25
    const envelope = Math.min(1, time / 0.002) * Math.exp(-time / 0.028)
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += (click + lp) * envelope * gain
  }
}

/**
 * Add a downward pitch-swept droplet plus two echoes.
 * @param {Float64Array} out - destination buffer.
 * @param {object} options - droplet description.
 */
function addDroplet(out, options) {
  const { start, base = 1250, gain = 1 } = options
  const duration = 0.12
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  let phase = 0
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    const frequency = base * (1 - 0.62 * (time / duration))
    phase += (TAU * frequency) / SAMPLE_RATE
    const envelope = Math.min(1, time / 0.002) * Math.exp(-time / 0.035)
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += Math.sin(phase) * envelope * gain
  }
  const echoGains = [0.32, 0.14]
  const echoDelays = [0.15, 0.32]
  for (let echo = 0; echo < echoGains.length; echo += 1) {
    const shift = Math.round(echoDelays[echo] * SAMPLE_RATE)
    for (let index = 0; index < frames; index += 1) {
      const at = first + shift + index
      if (at < out.length) out[at] += out[first + index] * echoGains[echo]
    }
  }
}

/**
 * Add a short diffuse tail so a sound does not end against a hard wall.
 * @param {Float64Array} out - buffer to treat in place.
 */
function addReverb(out) {
  const taps = [
    [0.071, 0.18],
    [0.113, 0.11],
    [0.179, 0.06],
  ]
  const dry = Float64Array.from(out)
  for (const [delay, gain] of taps) {
    const shift = Math.round(delay * SAMPLE_RATE)
    for (let index = shift; index < out.length; index += 1) {
      out[index] += dry[index - shift] * gain
    }
  }
}

/**
 * Trim, fade, and normalize a buffer to one target peak.
 * @param {Float64Array} out - buffer to finish.
 */
function finish(out, targetPeak) {
  const fadeIn = Math.round(0.004 * SAMPLE_RATE)
  const fadeOut = Math.round(0.05 * SAMPLE_RATE)
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
  'builtin:crystal': (out) => {
    addTone(out, { start: 0, duration: 1.15, frequency: 1046.5, tau: 0.42, partials: [[1, 1], [2.01, 0.42], [3.01, 0.16], [4.2, 0.07]] })
    addTone(out, { start: 0.13, duration: 1.25, frequency: 1568.0, tau: 0.5, gain: 0.8, partials: [[1, 1], [2.01, 0.38], [3.01, 0.13]] })
  },
  'builtin:marimba': (out) => {
    addTone(out, { start: 0, duration: 0.9, frequency: 523.25, tau: 0.28, partials: [[1, 1], [3.93, 0.34], [9.24, 0.1]] })
    addTone(out, { start: 0.11, duration: 0.9, frequency: 659.25, tau: 0.28, gain: 0.85, partials: [[1, 1], [3.93, 0.3], [9.24, 0.08]] })
    addTone(out, { start: 0.22, duration: 0.95, frequency: 783.99, tau: 0.3, gain: 0.7, partials: [[1, 1], [3.93, 0.26], [9.24, 0.07]] })
  },
  'builtin:harp': (out) => {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((frequency, index) => {
      const partials = []
      for (let harmonic = 1; harmonic <= 7; harmonic += 1) {
        partials.push([harmonic, 1 / Math.pow(harmonic, 1.35)])
      }
      addTone(out, {
        start: index * 0.085,
        duration: 1.25,
        frequency,
        tau: 0.45,
        gain: 0.75,
        partials,
        lowpass: 0.35,
      })
    })
  },
  'builtin:woodblock': (out) => {
    const random = mulberry32(0x51f15eed)
    addWoodblock(out, { start: 0, frequency: 760, gain: 0.9, random })
    addWoodblock(out, { start: 0.19, frequency: 620, gain: 0.65, random })
  },
  'builtin:droplet': (out) => {
    addDroplet(out, { start: 0, base: 1250, gain: 0.9 })
  },
  'builtin:low-bell': (out) => {
    addTone(out, { start: 0, duration: 1.7, frequency: 220, tau: 0.72, partials: [[1, 1], [2, 0.28], [2.99, 0.1]], lowpass: 0.22 })
  },
  'builtin:descend': (out) => {
    addSoftNote(out, { start: 0, duration: 0.5, frequency: 440, gain: 0.8 })
    addSoftNote(out, { start: 0.44, duration: 0.7, frequency: 349.23, gain: 0.72, release: 0.3 })
  },
  'builtin:glass': (out) => {
    const notes = [1046.5, 1318.5, 1568.0, 2093.0]
    notes.forEach((frequency, index) => {
      addTone(out, {
        start: index * 0.13,
        duration: 0.95,
        frequency,
        tau: 0.34,
        gain: 0.6,
        partials: [[1, 1], [2.01, 0.3], [3.01, 0.1]],
      })
    })
  },
}

function generate() {
  const outDir = join(root, 'sounds')
  mkdirSync(outDir, { recursive: true })
  const rows = []
  for (const entry of catalog.sounds) {
    const recipe = RECIPES[entry.id]
    if (recipe === undefined) throw new Error('no recipe for ' + entry.id)
    const out = new Float64Array(Math.round(entry.seconds * SAMPLE_RATE))
    recipe(out)
    addReverb(out)
    finish(out, entry.peak ?? TARGET_PEAK)
    const path = join(outDir, entry.file)
    writeWav(path, out, SAMPLE_RATE)
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
    if (stats.channels !== 1) problems.push('channels=' + stats.channels)
    if (stats.sampleRate !== SAMPLE_RATE) problems.push('sampleRate=' + stats.sampleRate)
    if (stats.bits !== 16) problems.push('bits=' + stats.bits)
    if (Math.abs(stats.seconds - entry.seconds) > 0.05) problems.push('seconds=' + stats.seconds.toFixed(3))
    const targetPeak = entry.peak ?? TARGET_PEAK
    if (stats.peak < targetPeak - 0.05 || stats.peak > targetPeak + 0.05) problems.push('peak=' + stats.peak.toFixed(3) + ' target=' + targetPeak)
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