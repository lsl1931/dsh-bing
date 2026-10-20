import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const settings = require('../src/client/settings.cjs')

function memory() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  }
}

test('defaults are complete', () => {
  assert.equal(settings.DEFAULT_SETTINGS.sounds.finished, 'builtin:pulse')
  assert.equal(settings.DEFAULT_SETTINGS.notifyAborted, false)
})

test('bad JSON and unknown sounds fall back', () => {
  const storage = memory()
  storage.setItem(settings.PERSIST_KEY, '{')
  assert.equal(settings.readSettings(storage), settings.DEFAULT_SETTINGS)
  const store = memory()
  store.setItem(settings.PERSIST_KEY, JSON.stringify({ sounds: { finished: 'bogus', error: 'custom:ok.wav' } }))
  const read = settings.readSettings(store)
  assert.equal(read.sounds.finished, 'builtin:pulse')
  assert.equal(read.sounds.error, 'custom:ok.wav')
})

test('update clamps minutes and persists', () => {
  const storage = memory()
  const store = settings.createSettingsStore(storage)
  store.update({ remindAfterMinutes: 999, soundEnabled: false })
  assert.equal(store.getSnapshot().remindAfterMinutes, 240)
  assert.equal(store.getSnapshot().soundEnabled, false)
  assert.equal(settings.readSettings(storage).soundEnabled, false)
})

test('subscribers observe updates', () => {
  const store = settings.createSettingsStore(memory())
  let calls = 0
  const off = store.subscribe(() => { calls += 1 })
  store.update({ enabled: false })
  off()
  store.update({ enabled: true })
  assert.equal(calls, 1)
})
