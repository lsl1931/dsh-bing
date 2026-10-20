// dsh-bing host half.
//
// Effects are additive and need no harness change:
//   1. the "bing" session projection (last finished turn + approvals);
//   2. same-origin routes for the toast, the sound library and audio;
//   3. a global listener for service-level plan-review asks.
import { spawn } from 'node:child_process'
import {
  FOCUS_HEADER,
  FOREGROUND_TTL_MS,
  QUESTION_LIMIT,
  REPORT_LIMIT,
  ROUTES,
  SOUND_CAP_MS,
} from './shared/protocol.js'
import { bingProjection } from './shared/projection.js'
import {
  cacheInfo,
  clearCache,
  customSoundDir,
  deleteSound,
  findFfmpeg,
  importSound,
  resolveSound,
  soundLibrary,
  wavCachePath,
} from './shared/sounds.js'

/** Cordis plugin name (the Loader entry and the client bundle id). */
export const name = 'dsh-bing'

/** Services required before the projection can register. */
export const inject = ['sessionProjections']

/** The Windows PowerShell 5.1 host this machine has; pwsh may be absent. */
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

/** The AppUserModelID Windows shows as the toast source. */
const TOAST_AUMID = 'electron.app.DeepSeek Harness'

/** The route the client can use without the same-origin header: read-only diagnostics. */
const DEBUG_PATH = ROUTES.debug

/** Client diagnostics lines, oldest first. */
const clientReports = []

/** Questions the host saw on the user-questions waterfall. */
const questionRecords = []
let questionSeq = 0

/** Children currently playing a file sound. */
const soundPlayers = new Set()

/** The current preview child, if any. */
let previewChild

/** Cached foreground answer. */
let foregroundAnswer

/** Write one diagnostic line into the bounded ring. */
function note(line) {
  clientReports.push(new Date().toISOString().slice(11, 19) + ' ' + line)
  while (clientReports.length > REPORT_LIMIT) clientReports.shift()
}

/** Send a JSON response. */
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

/** Check method + same-origin header; a failed check writes the response. */
function guarded(req, res, method) {
  if (req.method !== method) {
    res.writeHead(405)
    res.end()
    return false
  }
  if (req.headers[FOCUS_HEADER] === undefined) {
    res.writeHead(403)
    res.end()
    return false
  }
  return true
}

/** Read a bounded UTF-8 body. */
function readBody(req, done) {
  let body = ''
  req.setEncoding('utf8')
  req.on('data', chunk => {
    if (body.length < 8192) body += String(chunk).slice(0, 8192 - body.length)
  })
  req.on('end', () => done(body))
  req.on('error', () => done(''))
}

/** Parse a body as JSON, returning an object or undefined. */
function parseJson(body) {
  try {
    const parsed = JSON.parse(body)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Escape one string for toast XML. */
function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Raise the DSH window through the app's own protocol handler. */
function focusDesktopWindow() {
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '', 'dsh://open'], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', () => {})
    child.unref()
  } catch {
    // A failing focus never breaks a notification.
  }
}

/** Whether this app's window is the OS foreground window. */
function appWindowFocused() {
  if (foregroundAnswer !== undefined && Date.now() - foregroundAnswer.at < FOREGROUND_TTL_MS) {
    return Promise.resolve(foregroundAnswer.focused)
  }
  const definition = '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); '
    + '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);'
  const script = [
    "Add-Type -Namespace DshBing -Name Win -MemberDefinition '" + definition + "' | Out-Null",
    '$handle = [DshBing.Win]::GetForegroundWindow()',
    '$owner = 0',
    '[DshBing.Win]::GetWindowThreadProcessId($handle, [ref]$owner) | Out-Null',
    '(Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName',
  ].join('; ')
  return new Promise(resolve => {
    let out = ''
    try {
      const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
      child.stdout.on('data', chunk => {
        out += String(chunk)
      })
      child.stderr.resume()
      child.on('error', () => resolve(false))
      child.on('close', () => {
        const processName = out.trim()
        const focused = processName !== '' && processName === process.execPath.replace(/\.exe$/i, '').split(/[\\/]/).pop()
        foregroundAnswer = { at: Date.now(), focused }
        resolve(focused)
      })
    } catch {
      resolve(false)
    }
  })
}

/** The media playback script shared by toast and preview children. */
function mediaScript() {
  return [
    'if ($env:DSH_BING_MEDIA) {',
    '  try {',
    '    $media = $env:DSH_BING_MEDIA',
    '    if (-not $media.ToLower().EndsWith(".wav")) {',
    '      $cached = $env:DSH_BING_WAVCACHE',
    '      if ($cached -and -not (Test-Path -LiteralPath $cached) -and $env:DSH_BING_FFMPEG) {',
    '        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cached) | Out-Null',
    '        & $env:DSH_BING_FFMPEG -y -loglevel error -i $media -ac 2 -ar 44100 -acodec pcm_s16le $cached | Out-Null',
    '      }',
    '      if ($cached -and (Test-Path -LiteralPath $cached)) { $media = $cached }',
    '    }',
    '    if ($media.ToLower().EndsWith(".wav") -and (Test-Path -LiteralPath $media)) {',
    '      (New-Object System.Media.SoundPlayer $media).PlaySync()',
    '    }',
    '  } catch { }',
    '}',
  ].join('; ')
}

/** Track one playing child and cap it. */
function trackPlayer(child) {
  soundPlayers.add(child)
  const cap = setTimeout(() => {
    try {
      child.kill()
    } catch {
      // Already gone.
    }
  }, SOUND_CAP_MS)
  const forget = () => {
    clearTimeout(cap)
    soundPlayers.delete(child)
  }
  child.on('close', forget)
  child.on('error', forget)
}

/** Show one Windows toast, optionally playing a file sound in the same child. */
function showHostToast(title, lines, sound) {
  const chosen = resolveSound(sound)
  const media = chosen.wav || ''
  const audio = chosen.silent
    ? '<audio silent="true"/>'
    : (chosen.event ? '<audio src="' + chosen.event + '"/>' : '<audio silent="true"/>')
  const text = [title].concat(lines).filter(value => typeof value === 'string' && value.trim() !== '')
  const xml = '<toast activationType="protocol" launch="dsh://open"><visual><binding template="ToastGeneric">'
    + text.map(value => '<text>' + xmlEscape(value.replace(/\s+/g, ' ').slice(0, 160)) + '</text>').join('')
    + '</binding></visual>' + audio + '</toast>'
  const wavCache = media !== '' && !media.toLowerCase().endsWith('.wav') ? wavCachePath(media) : ''
  const ffmpeg = media !== '' ? findFfmpeg() : ''
  const script = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$xml.LoadXml($env:DSH_BING_XML)',
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('" + TOAST_AUMID + "').Show($toast)",
    mediaScript(),
  ].join('; ')
  try {
    const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      env: {
        ...process.env,
        DSH_BING_XML: xml,
        DSH_BING_MEDIA: media,
        DSH_BING_WAVCACHE: wavCache,
        DSH_BING_FFMPEG: ffmpeg,
      },
    })
    child.stdout.resume()
    child.stderr.resume()
    child.on('error', error => note('host toast spawn failed: ' + String(error)))
    if (media !== '') trackPlayer(child)
    child.unref()
  } catch (error) {
    note('host toast threw: ' + String(error))
  }
}

/** Play one sound without raising a toast. */
function playPreview(sound) {
  const chosen = resolveSound(sound)
  if (chosen.wav === undefined) return
  if (previewChild !== undefined) {
    try {
      previewChild.kill()
    } catch {
      // Already gone.
    }
    previewChild = undefined
  }
  const media = chosen.wav
  const wavCache = media.toLowerCase().endsWith('.wav') ? '' : wavCachePath(media)
  const ffmpeg = findFfmpeg()
  const script = mediaScript()
  try {
    const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      env: {
        ...process.env,
        DSH_BING_MEDIA: media,
        DSH_BING_WAVCACHE: wavCache,
        DSH_BING_FFMPEG: ffmpeg,
      },
    })
    child.stdout.resume()
    child.stderr.resume()
    child.on('error', error => note('preview spawn failed: ' + String(error)))
    previewChild = child
    child.on('close', () => {
      if (previewChild === child) previewChild = undefined
    })
    trackPlayer(child)
  } catch (error) {
    note('preview threw: ' + String(error))
  }
}

/** Answer /toast. */
function handleToast(req, res) {
  if (!guarded(req, res, 'POST')) return
  readBody(req, body => {
    const parsed = parseJson(body)
    const title = parsed !== undefined && typeof parsed.title === 'string' ? parsed.title : 'DSH'
    const lines = parsed !== undefined && Array.isArray(parsed.lines)
      ? parsed.lines.filter(value => typeof value === 'string').slice(0, 2)
      : []
    const sound = parsed === undefined ? 'silent' : parsed.sound
    showHostToast(title, lines, sound)
    res.writeHead(204)
    res.end()
  })
}

/** Answer /preview: play only, never a toast. */
function handlePreview(req, res) {
  if (!guarded(req, res, 'POST')) return
  readBody(req, body => {
    const parsed = parseJson(body)
    playPreview(parsed === undefined ? 'silent' : parsed.sound)
    res.writeHead(204)
    res.end()
  })
}

/** Answer /silence. */
function handleSilence(req, res) {
  if (!guarded(req, res, 'POST')) return
  let stopped = 0
  for (const child of [...soundPlayers]) {
    try {
      child.kill()
      stopped += 1
    } catch {
      // Already gone.
    }
  }
  soundPlayers.clear()
  previewChild = undefined
  note('silence: stopped ' + String(stopped) + ' sound(s)')
  res.writeHead(204)
  res.end()
}

/** Answer /focus. */
function handleFocus(req, res) {
  if (!guarded(req, res, 'POST')) return
  focusDesktopWindow()
  res.writeHead(204)
  res.end()
}

/** Answer /foreground. */
function handleForeground(req, res) {
  if (!guarded(req, res, 'GET')) return
  void appWindowFocused().then(focused => json(res, 200, { focused }), () => json(res, 500, { error: 'failed' }))
}

/** Answer /sound-library. */
function handleLibrary(req, res) {
  if (!guarded(req, res, 'GET')) return
  json(res, 200, soundLibrary())
}

/** Answer /import-sound. */
function handleImport(req, res) {
  if (!guarded(req, res, 'POST')) return
  readBody(req, body => {
    const parsed = parseJson(body)
    const file = parsed !== undefined && typeof parsed.file === 'string' ? parsed.file : ''
    const result = importSound(file)
    note('import sound: ' + ('name' in result ? result.name : result.error))
    json(res, 200, result)
  })
}

/** Answer /delete-sound. */
function handleDelete(req, res) {
  if (!guarded(req, res, 'POST')) return
  readBody(req, body => {
    const parsed = parseJson(body)
    const id = parsed !== undefined ? parsed.id : ''
    const ok = deleteSound(id)
    note('delete sound: ' + String(id) + ' -> ' + String(ok))
    json(res, 200, { ok })
  })
}

/** Answer /sound-cache. */
function handleCache(req, res) {
  if (req.method === 'GET') {
    if (!guarded(req, res, 'GET')) return
    json(res, 200, cacheInfo())
    return
  }
  if (!guarded(req, res, 'POST')) return
  const result = clearCache()
  note('sound cache cleared: ' + String(result.removed) + ' file(s)')
  json(res, 200, result)
}

/** Answer /pick-file. */
function handlePickFile(req, res) {
  if (!guarded(req, res, 'POST')) return
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    "$dialog.Filter = 'Audio files|*.wav;*.mp3;*.m4a;*.aac;*.wma;*.flac;*.ogg;*.opus|All files|*.*'",
    "$dialog.Title = '选择一个音效文件'",
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }',
  ].join('; ')
  let picked = ''
  try {
    const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { windowsHide: true })
    child.stdout.on('data', chunk => {
      picked += String(chunk)
    })
    child.stderr.resume()
    child.on('error', error => note('file picker failed: ' + String(error)))
    child.on('close', () => {
      const path = picked.trim()
      note('file picker returned ' + (path === '' ? '(cancelled)' : path))
      json(res, 200, { path })
    })
  } catch (error) {
    note('file picker threw: ' + String(error))
    json(res, 500, { error: 'failed' })
  }
}

/** One question record, as the client polls it. */
function questionRecordOf(input, seq, at) {
  const ask = typeof input === 'object' && input !== null ? input : undefined
  const list = ask === undefined ? undefined : ask.questions
  if (!Array.isArray(list) || list.length === 0) return undefined
  const first = list[0]
  if (typeof first !== 'object' || first === null) return undefined
  const intent = typeof first.intent === 'object' && first.intent !== null ? first.intent : undefined
  const kind = intent !== undefined && intent.kind === 'plan-review' ? 'plan-review' : 'question'
  const summary = String(first.header || first.question || first.id || '')
  const wait = ask === undefined ? undefined : ask.wait
  const callId = wait !== undefined && typeof wait.callId === 'string' ? wait.callId : ''
  const key = callId !== '' ? callId : 'q:' + (String(first.id || '') || summary)
  const agent = ask === undefined ? undefined : ask.agent
  const sessionId = agent === undefined ? '' : String(agent.session || agent.sessionId || agent.id || '')
  return { seq, key, sessionId, kind, summary, at, open: true }
}

/** Observe one service-level ask without touching the waterfall's result. */
function observeQuestion(request, next) {
  let record
  try {
    questionSeq += 1
    record = questionRecordOf(request, questionSeq, Date.now())
    if (record === undefined) {
      questionSeq -= 1
    } else {
      questionRecords.push(record)
      while (questionRecords.length > QUESTION_LIMIT) questionRecords.shift()
      note('question observed ' + record.kind + ' session=' + record.sessionId.slice(0, 12))
    }
  } catch (error) {
    note('question observe failed: ' + String(error))
  }
  const downstream = next()
  if (record === undefined) return downstream
  const tracked = record
  const settle = () => {
    tracked.open = false
  }
  return Promise.resolve(downstream).then(
    value => {
      settle()
      return value
    },
    error => {
      settle()
      throw error
    },
  )
}

/** Answer /questions. */
function handleQuestions(req, res) {
  if (!guarded(req, res, 'GET')) return
  json(res, 200, { seq: questionSeq, items: questionRecords })
}

/** Answer /report. */
function handleReport(req, res) {
  if (!guarded(req, res, 'POST')) return
  readBody(req, body => {
    note(body.slice(0, 300))
    res.writeHead(204)
    res.end()
  })
}

/** Answer /debug. */
function handleDebug(ctx, req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  const report = {}
  try {
    const registry = ctx.get('sessionProjections')
    report.registryPresent = registry !== undefined
    const sessions = ctx.get('sessions')
    const list = sessions !== undefined && typeof sessions.list === 'function' ? sessions.list() : []
    report.sessionCount = list.length
    report.sessions = list.slice(0, 3).map(session => {
      const row = { id: String(session.id) }
      try {
        row.bing = registry !== undefined && registry.stateOf(session, 'bing') !== undefined
      } catch (error) {
        row.bing = 'error: ' + String(error)
      }
      try {
        row.projectionKeys = Object.keys(registry.snapshot(session).values || {})
      } catch (error) {
        row.projectionKeys = 'error: ' + String(error)
      }
      return row
    })
    report.client = [...clientReports]
    report.media = {
      ffmpeg: findFfmpeg() || null,
      players: soundPlayers.size,
    }
    const library = soundLibrary()
    report.library = {
      builtin: library.builtin.length,
      custom: library.custom.length,
      customDir: customSoundDir(),
    }
    report.cache = cacheInfo()
  } catch (error) {
    report.error = String(error)
  }
  json(res, 200, report)
}

/** Register the projection, the routes, and the global question observer. */
export function apply(ctx) {
  ctx.sessionProjections.register(bingProjection())
  ctx.effect(
    () => ctx.on('user-questions/request', observeQuestion, { global: true }),
    'dsh-bing: question observer',
  )
  ctx.inject(['webServer'], scoped => {
    const routes = [
      [ROUTES.toast, handleToast],
      [ROUTES.preview, handlePreview],
      [ROUTES.silence, handleSilence],
      [ROUTES.focus, handleFocus],
      [ROUTES.foreground, handleForeground],
      [ROUTES.library, handleLibrary],
      [ROUTES.importSound, handleImport],
      [ROUTES.deleteSound, handleDelete],
      [ROUTES.cache, handleCache],
      [ROUTES.pickFile, handlePickFile],
      [ROUTES.questions, handleQuestions],
      [ROUTES.report, handleReport],
    ]
    for (const [path, handler] of routes) {
      scoped.effect(
        () => scoped.webServer.register({ kind: 'exact', path, handler }),
        'dsh-bing: ' + path,
      )
    }
    scoped.effect(
      () => scoped.webServer.register({
        kind: 'exact',
        path: DEBUG_PATH,
        handler: (req, res) => handleDebug(ctx, req, res),
      }),
      'dsh-bing: ' + DEBUG_PATH,
    )
  })
}