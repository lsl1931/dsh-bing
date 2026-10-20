// Thin fetch wrappers around the host routes. Every failure is swallowed:
// notifications are a convenience, never a correctness requirement.
const HEADER = 'x-dsh-bing'

const ROUTES = Object.freeze({
  toast: '/dsh-bing/toast',
  preview: '/dsh-bing/preview',
  silence: '/dsh-bing/silence',
  focus: '/dsh-bing/focus',
  foreground: '/dsh-bing/foreground',
  library: '/dsh-bing/sound-library',
  importSound: '/dsh-bing/import-sound',
  deleteSound: '/dsh-bing/delete-sound',
  cache: '/dsh-bing/sound-cache',
  pickFile: '/dsh-bing/pick-file',
  questions: '/dsh-bing/questions',
  report: '/dsh-bing/report',
})

function available() {
  return typeof fetch === 'function'
}

function headers() {
  return { [HEADER]: '1' }
}

function post(route, body) {
  if (!available()) return Promise.resolve(undefined)
  return fetch(route, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify(body === undefined ? {} : body),
  }).then(response => (response.ok ? response : undefined)).catch(() => undefined)
}

function get(route) {
  if (!available()) return Promise.resolve(undefined)
  return fetch(route, { headers: headers() })
    .then(response => (response.ok ? response.json() : undefined))
    .catch(() => undefined)
}

function showToast(payload) {
  return post(ROUTES.toast, payload)
}

function previewSound(sound) {
  return post(ROUTES.preview, { sound })
}

function silence() {
  return post(ROUTES.silence)
}

function focusWindow() {
  return post(ROUTES.focus)
}

function appWindowFocused() {
  return get(ROUTES.foreground).then(value => value !== undefined && value.focused === true)
}

function soundLibrary() {
  return get(ROUTES.library).then(value => {
    if (value === undefined) return null
    return {
      builtin: Array.isArray(value.builtin) ? value.builtin : [],
      custom: Array.isArray(value.custom) ? value.custom : [],
    }
  })
}

function pickFile() {
  return post(ROUTES.pickFile).then(response => {
    if (response === undefined) return ''
    return response.json().then(value => (value !== null && typeof value.path === 'string' ? value.path : '')).catch(() => '')
  })
}

function importSound(file) {
  return post(ROUTES.importSound, { file }).then(response => {
    if (response === undefined) return null
    return response.json().then(value => (value !== null && typeof value.name === 'string' ? value.name : null)).catch(() => null)
  })
}

function deleteSound(id) {
  return post(ROUTES.deleteSound, { id }).then(response => {
    if (response === undefined) return false
    return response.json().then(value => value !== null && value.ok === true).catch(() => false)
  })
}

function cacheInfo() {
  return get(ROUTES.cache)
}

function clearCache() {
  return post(ROUTES.cache).then(response => {
    if (response === undefined) return null
    return response.json().catch(() => null)
  })
}

function pollQuestions() {
  return get(ROUTES.questions)
}

function report(line) {
  if (!available()) return
  try {
    void fetch(ROUTES.report, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'text/plain' },
      body: String(line).slice(0, 300),
    }).catch(() => undefined)
  } catch {
    // Diagnostics must never break the caller.
  }
}

module.exports = {
  ROUTES,
  showToast,
  previewSound,
  silence,
  focusWindow,
  appWindowFocused,
  soundLibrary,
  pickFile,
  importSound,
  deleteSound,
  cacheInfo,
  clearCache,
  pollQuestions,
  report,
}
