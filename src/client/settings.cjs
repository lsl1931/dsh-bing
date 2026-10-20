// Client-persisted notification preferences, tolerant of a missing or
// unwritable storage. The host never sees these values; it receives sound ids.
const PERSIST_KEY = 'dsh-bing.v1'
const SOUND_GROUPS = Object.freeze(['finished', 'error', 'attention', 'reminder'])

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  soundEnabled: true,
  sounds: Object.freeze({
    finished: 'builtin:pulse',
    error: 'builtin:low',
    attention: 'builtin:tick',
    reminder: 'builtin:arc',
  }),
  notifyCompleted: true,
  notifyError: true,
  notifyAborted: false,
  notifyBlocked: true,
  notifyMaxTokens: true,
  notifyApproval: true,
  notifyQuestion: true,
  notifyPlanReview: true,
  remindAfterMinutes: 10,
})

const LIBRARY_ID = /^(?:builtin|custom):[^\\/:*?"<>|]+$/

function clampSound(group, value) {
  if (value === 'silent') return value
  if (typeof value === 'string' && LIBRARY_ID.test(value)) return value
  return DEFAULT_SETTINGS.sounds[group]
}

function clampSounds(value) {
  const saved = value !== null && typeof value === 'object' ? value : {}
  const out = {}
  for (const group of SOUND_GROUPS) out[group] = clampSound(group, saved[group])
  return out
}

function clampMinutes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS.remindAfterMinutes
  return Math.min(240, Math.max(1, Math.round(value)))
}

function ambientStorage() {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function readSettings(storage) {
  const store = storage === undefined ? ambientStorage() : storage
  if (store === undefined) return DEFAULT_SETTINGS
  try {
    const raw = store.getItem(PERSIST_KEY)
    if (raw === null) return DEFAULT_SETTINGS
    const saved = JSON.parse(raw)
    const merged = { ...DEFAULT_SETTINGS, ...(saved !== null && typeof saved === 'object' ? saved : {}) }
    return {
      ...merged,
      remindAfterMinutes: clampMinutes(merged.remindAfterMinutes),
      sounds: clampSounds(merged.sounds),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function writeSettings(settings, storage) {
  const store = storage === undefined ? ambientStorage() : storage
  if (store === undefined) return
  try {
    store.setItem(PERSIST_KEY, JSON.stringify(settings))
  } catch {
    // Quota or read-only storage: the current session keeps its in-memory copy.
  }
}

function createSettingsStore(storage) {
  const store = storage === undefined ? ambientStorage() : storage
  let snapshot = readSettings(store)
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(patch) {
      const next = {
        ...snapshot,
        ...patch,
        remindAfterMinutes: clampMinutes(patch.remindAfterMinutes === undefined ? snapshot.remindAfterMinutes : patch.remindAfterMinutes),
        sounds: clampSounds(patch.sounds === undefined ? snapshot.sounds : patch.sounds),
      }
      snapshot = next
      writeSettings(next, store)
      for (const listener of [...listeners]) listener()
    },
  }
}

module.exports = {
  PERSIST_KEY,
  SOUND_GROUPS,
  DEFAULT_SETTINGS,
  clampSounds,
  readSettings,
  writeSettings,
  createSettingsStore,
}
