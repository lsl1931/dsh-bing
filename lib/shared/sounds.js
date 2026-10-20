// Sound library plumbing: the catalog that ships with the plugin, the user's
// imported files, the wav cache for transcodes, and the one id-to-effect table
// the renderer is allowed to address.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Plugin root, from both src/shared and the built lib/shared copy. */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The shipped sound folder. */
export function builtinSoundDir() {
  return join(pluginRoot, 'sounds')
}

/** Formats a custom sound may use; everything but wav is transcoded on play. */
export const CUSTOM_EXTENSIONS = Object.freeze(['.wav', '.mp3', '.m4a', '.aac', '.wma', '.flac', '.ogg', '.opus'])

/** A solid name has no separators, no drive colon, and is never a dot segment. */
export function safeSoundName(name) {
  return typeof name === 'string'
    && name !== ''
    && name !== '.'
    && name !== '..'
    && !/[\\/:*?"<>|]/.test(name)
}

/** Read the shipped catalog; an unreadable file means an empty builtin list. */
export function readCatalog() {
  try {
    const parsed = JSON.parse(readFileSync(join(builtinSoundDir(), 'catalog.json'), 'utf8'))
    return Array.isArray(parsed.sounds) ? parsed.sounds : []
  } catch {
    return []
  }
}

/** The built-in sounds, with their on-disk size when the wav exists. */
export function builtinSounds() {
  const out = []
  for (const entry of readCatalog()) {
    if (!safeSoundName(entry.file)) continue
    const path = join(builtinSoundDir(), entry.file)
    if (!existsSync(path)) continue
    let bytes = 0
    try {
      bytes = statSync(path).size
    } catch {
      continue
    }
    out.push({
      id: entry.id,
      file: entry.file,
      name: entry.name,
      description: entry.description,
      seconds: entry.seconds,
      scene: entry.scene,
      bytes,
    })
  }
  return out
}

/** The folder holding files the user imported. */
export function customSoundDir() {
  const rootPath = process.env['LOCALAPPDATA'] || process.env['TEMP'] || '.'
  return join(rootPath, 'dsh-bing', 'custom')
}

/** The folder holding transcode output. */
export function soundCacheDir() {
  const rootPath = process.env['LOCALAPPDATA'] || process.env['TEMP'] || '.'
  return join(rootPath, 'dsh-bing', 'cache')
}

/** One custom sound file inside the user folder. */
function customEntries() {
  const dir = customSoundDir()
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out = []
  for (const file of names) {
    if (!safeSoundName(file)) continue
    if (!CUSTOM_EXTENSIONS.some(extension => file.toLowerCase().endsWith(extension))) continue
    try {
      out.push({
        id: 'custom:' + file,
        file,
        name: file.replace(/\.[^.]+$/, ''),
        bytes: statSync(join(dir, file)).size,
      })
    } catch {
      // Vanished between listing and measuring.
    }
  }
  return out.sort((left, right) => left.name.localeCompare(right.name))
}

/** The two lists the settings UI renders. */
export function soundLibrary() {
  return { builtin: builtinSounds(), custom: customEntries() }
}

/** The default Windows notification event, used when an id is unknown. */
export const DEFAULT_EVENT = 'ms-winsoundevent:Notification.Default'

/**
 * Resolve one stored sound id into what the host should do.
 * @param {unknown} id - a builtin:/custom:/silent id.
 * @returns {{event?: string, wav?: string, silent?: boolean}}
 */
export function resolveSound(id) {
  if (id === 'silent' || id === false) return { silent: true }
  if (typeof id !== 'string') return { event: DEFAULT_EVENT }
  if (id.startsWith('builtin:')) {
    const entry = readCatalog().find(sound => sound.id === id)
    if (entry === undefined || !safeSoundName(entry.file)) return { event: DEFAULT_EVENT }
    const path = join(builtinSoundDir(), entry.file)
    if (!existsSync(path)) return { event: DEFAULT_EVENT }
    return { event: '', wav: path }
  }
  if (id.startsWith('custom:')) {
    const file = id.slice('custom:'.length)
    if (!safeSoundName(file)) return { event: DEFAULT_EVENT }
    if (!CUSTOM_EXTENSIONS.some(extension => file.toLowerCase().endsWith(extension))) return { event: DEFAULT_EVENT }
    const path = join(customSoundDir(), file)
    if (!existsSync(path)) return { event: DEFAULT_EVENT }
    return { event: '', wav: path }
  }
  return { event: DEFAULT_EVENT }
}

/**
 * Copy one picked file into the custom folder.
 * @param {string} source - absolute path from the file picker.
 * @returns {{name: string} | {error: string}}
 */
export function importSound(source) {
  if (typeof source !== 'string' || !isAbsolute(source) || !existsSync(source)) return { error: 'file not found' }
  const lower = source.toLowerCase()
  if (!CUSTOM_EXTENSIONS.some(extension => lower.endsWith(extension))) return { error: 'unsupported format' }
  const extension = extname(source).toLowerCase()
  const base = basename(source, extname(source)).replace(/[^\p{L}\p{N} ._-]/gu, '_').trim() || 'sound'
  const dir = customSoundDir()
  mkdirSync(dir, { recursive: true })
  let name = base + extension
  for (let index = 2; existsSync(join(dir, name)); index += 1) name = base + ' ' + String(index) + extension
  copyFileSync(source, join(dir, name))
  return { name }
}

/**
 * Delete one imported sound; built-in files can never be reached through this.
 * @param {unknown} id - a custom:<file> id.
 */
export function deleteSound(id) {
  if (typeof id !== 'string' || !id.startsWith('custom:')) return false
  const file = id.slice('custom:'.length)
  if (!safeSoundName(file)) return false
  try {
    rmSync(join(customSoundDir(), file), { force: true })
    return true
  } catch {
    return false
  }
}

/** Find ffmpeg on PATH once; '' when this machine has none. */
let ffmpegPath
export function findFfmpeg() {
  if (ffmpegPath !== undefined) return ffmpegPath
  ffmpegPath = ''
  for (const entry of (process.env['PATH'] || '').split(';')) {
    const directory = entry.trim()
    if (directory === '') continue
    const candidate = join(directory, 'ffmpeg.exe')
    if (existsSync(candidate)) {
      ffmpegPath = candidate
      break
    }
  }
  return ffmpegPath
}

/** The cached wav for one non-wav source path. */
export function wavCachePath(source) {
  const key = createHash('sha1').update(source).digest('hex').slice(0, 16)
  return join(soundCacheDir(), key + '.wav')
}

/** What the transcode cache currently costs. */
export function cacheInfo() {
  const dir = soundCacheDir()
  let names = []
  try {
    names = readdirSync(dir).filter(name => name.endsWith('.wav'))
  } catch {
    return { files: 0, bytes: 0 }
  }
  let bytes = 0
  for (const name of names) {
    try {
      bytes += statSync(join(dir, name)).size
    } catch {
      // Gone between listing and measuring.
    }
  }
  return { files: names.length, bytes }
}

/** Empty the transcode cache. */
export function clearCache() {
  const info = cacheInfo()
  let removed = 0
  try {
    for (const name of readdirSync(soundCacheDir())) {
      if (!name.endsWith('.wav')) continue
      try {
        rmSync(join(soundCacheDir(), name), { force: true })
        removed += 1
      } catch {
        // A file held by another process stays for the next clear.
      }
    }
  } catch {
    // No cache folder yet.
  }
  return { removed, bytes: info.bytes }
}