// Guards the committed sound pack: catalog shape, file headers, levels.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavStats } from '../scripts/lib/wav.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const catalog = JSON.parse(readFileSync(join(root, 'sounds', 'catalog.json'), 'utf8'))

test('catalog ids and files are unique', () => {
  const ids = new Set()
  const files = new Set()
  for (const entry of catalog.sounds) {
    assert.match(entry.id, /^builtin:[a-z0-9-]+$/)
    assert.match(entry.file, /^[0-9]{2}-[a-z0-9-]+\.wav$/)
    assert.equal(ids.has(entry.id), false, 'duplicate id ' + entry.id)
    assert.equal(files.has(entry.file), false, 'duplicate file ' + entry.file)
    ids.add(entry.id)
    files.add(entry.file)
  }
})

test('every catalog sound exists and is a playable wav', () => {
  for (const entry of catalog.sounds) {
    const path = join(root, 'sounds', entry.file)
    assert.equal(existsSync(path), true, 'missing ' + entry.file)
    const stats = readWavStats(path)
    assert.equal(stats.channels, 1, entry.file + ' is not mono')
    assert.equal(stats.sampleRate, 44100, entry.file + ' is not 44.1k')
    assert.equal(stats.bits, 16, entry.file + ' is not 16-bit')
    assert.ok(Math.abs(stats.seconds - entry.seconds) < 0.05, entry.file + ' duration drifted')
    const targetPeak = entry.peak ?? 0.8
    assert.ok(Math.abs(stats.peak - targetPeak) <= 0.05, entry.file + ' peak ' + stats.peak + ' != target ' + targetPeak)
    assert.ok(stats.rms > 0.02, entry.file + ' is effectively silent')
  }
})