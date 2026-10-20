// Generate the built-in notification sounds.
//
// Direction: warm, phone-system-like bells, marimba and kalimba — soft attack,
// musical intervals, a small room tail. No square-wave alarm, no harsh click.
// The Apple/Huawei originals are copyrighted, so these are original
// approximations; the plugin imports the user's own files if they have them.
//
// Output is deterministic: fixed sample rate, fixed reverb taps, byte-identical
// on regeneration. --check compares the committed files to a fresh render.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeWav, readWavStats } from './lib/wav.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const catalog = JSON.parse(readFileSync(join(root, 'sounds', 'catalog.json'), 'utf8'))
const TAU = Math.PI * 2
const SAMPLE_RATE = catalog.sampleRate
const TARGET_RMS = 0.13
const PEAK_CAP = 0.95

function addTone(out, options) {
  const {
    start = 0,
    duration,
    from,
    to = from,
    gain = 1,
    tau,
    attack = 0.005,
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

function addBell(out, options) {
  const {
    start = 0,
    duration,
    frequency,
    gain = 1,
    tau,
    attack = 0.006,
    partials = [[1, 1], [2.01, 0.32], [3.0, 0.1], [4.2, 0.04]],
    lowpass = 0.45,
  } = options
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  const decay = tau === undefined ? duration / 4 : tau
  let lp = 0
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    let sample = 0
    for (const [ratio, amplitude] of partials) {
      sample += amplitude * Math.sin(TAU * frequency * ratio * time)
    }
    const envelope = Math.min(1, time / attack) * Math.exp(-time / decay)
    lp += (sample * envelope * gain - lp) * lowpass
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += lp
  }
}

function addMarimba(out, options) {
  const { start = 0, duration, frequency, gain = 1, tau, attack = 0.002 } = options
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  const decay = tau === undefined ? duration / 4 : tau
  let lp = 0
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    const sample =
      Math.sin(TAU * frequency * time) +
      0.32 * Math.sin(TAU * frequency * 3.93 * time) +
      0.06 * Math.sin(TAU * frequency * 9.24 * time)
    const envelope = Math.min(1, time / attack) * Math.exp(-time / decay)
    lp += (sample * envelope * gain - lp) * 0.45
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += lp
  }
}

function addKalimba(out, options) {
  const { start = 0, duration, frequency, gain = 1, tau } = options
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  const decay = tau === undefined ? duration / 3 : tau
  let lp = 0
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    const sample =
      Math.sin(TAU * frequency * time) +
      0.16 * Math.sin(TAU * frequency * 2.0 * time) +
      0.04 * Math.sin(TAU * frequency * 3.0 * time)
    const envelope = Math.min(1, time / 0.003) * Math.exp(-time / decay)
    lp += (sample * envelope * gain - lp) * 0.5
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += lp
  }
}

function addPad(out, options) {
  const { start = 0, duration, frequency, gain = 1, attack = 0.16, release = 0.35 } = options
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  let lp = 0
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    const left = duration - time
    const envelope = Math.min(1, time / attack) * Math.min(1, Math.max(0, left / release))
    const sample =
      Math.sin(TAU * frequency * 0.997 * time) +
      Math.sin(TAU * frequency * time) +
      Math.sin(TAU * frequency * 1.003 * time)
    lp += (sample * envelope * gain - lp) * 0.18
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += lp
  }
}

function addDrop(out, options) {
  const { start = 0, base = 700, gain = 1 } = options
  const duration = 0.16
  const first = Math.round(start * SAMPLE_RATE)
  const frames = Math.round(duration * SAMPLE_RATE)
  let phase = 0
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE
    const shape = Math.sin(Math.PI * (time / duration))
    const frequency = base * (0.7 + 0.9 * shape)
    phase += (TAU * frequency) / SAMPLE_RATE
    const envelope = Math.min(1, time / 0.002) * Math.exp(-time / 0.045)
    const at = first + index
    if (at >= 0 && at < out.length) out[at] += Math.sin(phase) * envelope * gain
  }
}

function addReverb(out, mix) {
  const dry = Float64Array.from(out)
  const taps = [
    [0.037, 0.28],
    [0.053, 0.2],
    [0.079, 0.13],
    [0.113, 0.08],
  ]
  let lp = 0
  for (let index = 0; index < out.length; index += 1) {
    let wet = 0
    for (const [delay, gain] of taps) {
      const at = index - Math.round(delay * SAMPLE_RATE)
      if (at >= 0) wet += out[at] * gain
    }
    lp += (wet - lp) * 0.35
    out[index] = dry[index] * (1 - mix) + lp * mix
  }
}

function finish(out, targetRms) {
  const fadeIn = Math.round(0.003 * SAMPLE_RATE)
  const fadeOut = Math.round(0.08 * SAMPLE_RATE)
  let sum = 0
  let peak = 0
  for (let index = 0; index < out.length; index += 1) {
    if (index < fadeIn) out[index] *= index / fadeIn
    const fromEnd = out.length - 1 - index
    if (fromEnd < fadeOut) out[index] *= fromEnd / fadeOut
    sum += out[index] * out[index]
    const magnitude = Math.abs(out[index])
    if (magnitude > peak) peak = magnitude
  }
  if (peak === 0) throw new Error('sound is silent')
  const rms = Math.sqrt(sum / out.length)
  let scale = targetRms / rms
  if (peak * scale > PEAK_CAP) scale = PEAK_CAP / peak
  for (let index = 0; index < out.length; index += 1) out[index] *= scale
  return out
}

const RECIPES = {
  'builtin:aurora': (out) => {
    addBell(out, { start: 0, duration: 1.3, frequency: 523.25, gain: 0.55, tau: 0.55 })
    addBell(out, { start: 0.16, duration: 1.3, frequency: 659.25, gain: 0.5, tau: 0.55 })
    addBell(out, { start: 0.32, duration: 1.3, frequency: 783.99, gain: 0.45, tau: 0.55 })
    addReverb(out, 0.2)
  },
  'builtin:marimba': (out) => {
    addMarimba(out, { start: 0, duration: 0.9, frequency: 523.25, gain: 0.8, tau: 0.32 })
    addMarimba(out, { start: 0.12, duration: 0.9, frequency: 659.25, gain: 0.75, tau: 0.32 })
    addMarimba(out, { start: 0.24, duration: 0.9, frequency: 783.99, gain: 0.7, tau: 0.32 })
    addReverb(out, 0.12)
  },
  'builtin:kalimba': (out) => {
    addKalimba(out, { start: 0, duration: 0.8, frequency: 783.99, gain: 0.8, tau: 0.32 })
    addKalimba(out, { start: 0.14, duration: 0.8, frequency: 1046.5, gain: 0.7, tau: 0.32 })
    addKalimba(out, { start: 0.28, duration: 0.8, frequency: 1318.5, gain: 0.6, tau: 0.32 })
    addReverb(out, 0.15)
  },
  'builtin:glass': (out) => {
    addBell(out, { start: 0, duration: 1.2, frequency: 1318.5, gain: 0.5, tau: 0.5, partials: [[1, 1], [2.7, 0.18], [5.4, 0.05]], lowpass: 0.55 })
    addBell(out, { start: 0.12, duration: 1.2, frequency: 1568, gain: 0.45, tau: 0.5, partials: [[1, 1], [2.7, 0.16], [5.4, 0.04]], lowpass: 0.55 })
    addBell(out, { start: 0.24, duration: 1.2, frequency: 1975.5, gain: 0.35, tau: 0.5, partials: [[1, 1], [2.7, 0.14]], lowpass: 0.5 })
    addReverb(out, 0.22)
  },
  'builtin:bubble': (out) => {
    addDrop(out, { start: 0, base: 700, gain: 0.9 })
    addDrop(out, { start: 0.22, base: 920, gain: 0.7 })
    addReverb(out, 0.12)
  },
  'builtin:low': (out) => {
    addMarimba(out, { start: 0, duration: 0.7, frequency: 220, gain: 0.9, tau: 0.4 })
    addMarimba(out, { start: 0.16, duration: 0.7, frequency: 261.63, gain: 0.8, tau: 0.4 })
    addReverb(out, 0.1)
  },
  'builtin:descend': (out) => {
    addBell(out, { start: 0, duration: 0.7, frequency: 659.25, gain: 0.6, tau: 0.45 })
    addBell(out, { start: 0.25, duration: 0.9, frequency: 523.25, gain: 0.55, tau: 0.5 })
    addReverb(out, 0.18)
  },
  'builtin:bloom': (out) => {
    addPad(out, { start: 0, duration: 1.7, frequency: 261.63, gain: 0.12 })
    addPad(out, { start: 0, duration: 1.7, frequency: 329.63, gain: 0.1 })
    addPad(out, { start: 0, duration: 1.7, frequency: 392.0, gain: 0.09 })
    addBell(out, { start: 0.2, duration: 0.9, frequency: 1046.5, gain: 0.4, tau: 0.4 })
    addBell(out, { start: 0.34, duration: 0.9, frequency: 1318.5, gain: 0.34, tau: 0.4 })
    addBell(out, { start: 0.48, duration: 0.9, frequency: 1568, gain: 0.3, tau: 0.4 })
    addReverb(out, 0.25)
  },
}

function render(entry) {
  const recipe = RECIPES[entry.id]
  if (recipe === undefined) throw new Error('no recipe for ' + entry.id)
  const out = new Float64Array(Math.round(entry.seconds * SAMPLE_RATE))
  recipe(out)
  finish(out, entry.rms ?? TARGET_RMS)
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
    const target = entry.rms ?? TARGET_RMS
    if (Math.abs(stats.rms - target) > 0.025) problems.push('rms=' + stats.rms.toFixed(3) + ' target=' + target)
    if (stats.peak > PEAK_CAP + 0.01) problems.push('peak=' + stats.peak.toFixed(3))
    if (!render(entry).equals(readFileSync(path))) problems.push('bytes differ from regenerated output')
    if (problems.length > 0) failed += 1
    rows.push({ id: entry.id, file: entry.file, seconds: stats.seconds, peak: stats.peak, rms: stats.rms, problems })
  }
  for (const row of rows) {
    const status = row.problems.length === 0 ? 'ok' : 'FAIL ' + row.problems.join(', ')
    console.log(row.id.padEnd(24) + row.file.padEnd(18) + row.seconds.toFixed(2) + 's  rms=' + row.rms.toFixed(3) + ' peak=' + row.peak.toFixed(2) + '  ' + status)
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
    console.log(row.id.padEnd(24) + row.file.padEnd(18) + row.seconds.toFixed(2) + 's  rms=' + row.rms.toFixed(3) + ' peak=' + row.peak.toFixed(2))
  }
  console.log('wrote ' + rows.length + ' sound(s)')
}
