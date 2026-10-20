window.__ModuleLoader__.load({
	id: "dsh-bing",
	factory: (require) => {
		var __modules = {};
		var __cache = {};
		function __localRequire(id) {
			if (__cache[id]) return __cache[id].exports;
			var factory = __modules[id];
			if (!factory) throw new Error("dsh-bing: local module not found: " + id);
			var module = { exports: {} };
			__cache[id] = module;
			factory(module, module.exports, function (name) {
				return name.charAt(0) === "." ? __localRequire(name) : require(name);
			});
			return module.exports;
		}
	__modules["./index.js"] = function (module, exports, require) {
// dsh-bing client half: watch the session list, decide whether a toast is
// warranted, compose "<project> · <status>" with the real session title, and
// hand the chosen sound id to the host.
const { createSettingsStore } = require('./settings.cjs')
const { projectLabel, sessionTitle } = require('./project.cjs')
const { composeToast } = require('./summary.cjs')
const {
  DEDUPE_MS,
  askKey,
  isFresh,
  newRequestIds,
  recentlyKeyed,
  remember,
  requestKey,
  turnAdvance,
  turnKey,
} = require('./runner.cjs')
const { activeQuestions, questionSummary } = require('./questions.cjs')
const notifier = require('./notifier.cjs')
const { NS, zh, en, fmt } = require('./locales.cjs')
const { SettingsPage, PluginsTab } = require('./ui.cjs')
const { adoptStyles } = require('./styles.cjs')

/** Client services required before apply runs. */
exports.inject = ['sessions', 'slots', 'locale']

/** How often focus + the host question queue are refreshed. */
const POLL_MS = 2000

/** How often unanswered waits are checked. */
const REMINDER_MS = 30000

/** How long a document focus counts as "the user is here". */
const FOCUS_GRACE_MS = 5000

function waitKey(sessionId, requestId) {
  return sessionId + ':' + requestId
}

function statusKey(reason) {
  switch (reason) {
    case 'completed': return 'toastCompleted'
    case 'error': return 'toastError'
    case 'aborted': return 'toastAborted'
    case 'blocked': return 'toastBlocked'
    case 'max-tokens': return 'toastMaxTokens'
    default: return undefined
  }
}

function pendingKey(kind) {
  switch (kind) {
    case 'approval': return 'toastApproval'
    case 'question': return 'toastQuestion'
    case 'plan-review': return 'toastPlanReview'
    default: return 'toastPending'
  }
}

function reasonEnabled(settings, reason) {
  switch (reason) {
    case 'completed': return settings.notifyCompleted
    case 'error': return settings.notifyError
    case 'aborted': return settings.notifyAborted
    case 'blocked': return settings.notifyBlocked
    case 'max-tokens': return settings.notifyMaxTokens
    default: return false
  }
}

function pendingEnabled(settings, kind) {
  switch (kind) {
    case 'approval': return settings.notifyApproval
    case 'question': return settings.notifyQuestion
    case 'plan-review': return settings.notifyPlanReview
    default: return false
  }
}

function soundGroupOf(trigger) {
  if (trigger.kind === 'turn') return trigger.reason === 'error' ? 'error' : 'finished'
  if (trigger.kind === 'reminder') return 'reminder'
  return 'attention'
}

function decide(settings, trigger, focused, dedupeKey, recent, now) {
  if (!settings.enabled) return null
  const enabled = trigger.kind === 'turn'
    ? reasonEnabled(settings, trigger.reason)
    : (trigger.kind === 'reminder' ? true : pendingEnabled(settings, trigger.pending))
  if (!enabled) return null
  if (focused) return null
  if (recentlyKeyed(recent, dedupeKey, now, DEDUPE_MS)) return null
  remember(recent, dedupeKey, now, DEDUPE_MS)
  const group = soundGroupOf(trigger)
  return settings.soundEnabled ? settings.sounds[group] : 'silent'
}

function emitToast(sessionId, summary, t, status, body, fallback, sound, workspaces) {
  const project = projectLabel(sessionId, summary || {}, workspaces)
  const title = sessionTitle(summary || {})
  const composed = composeToast({
    project,
    status,
    sessionTitle: title,
    body,
    fallback,
  })
  notifier.showToast({ title: composed.title, lines: composed.lines, sound })
}

function apply(ctx) {
  adoptStyles()
  notifier.report('client bundle loaded')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-bing: dictionaries')
  const t = ctx.locale.bind(NS)

  const store = createSettingsStore()
  const set = patch => {
    store.update(patch)
    if (patch.soundEnabled === false) void notifier.silence()
  }

  const sessions = ctx.get('sessions')
  const recent = new Map()
  const observedTurn = new Map()
  const knownApprovals = new Map()
  const knownQuestions = new Map()
  const waits = new Map()

  let hostFocused = false
  let lastFocusAt = 0
  let questionSeq = 0
  let questionsSeeded = false

  const isFocused = () =>
    (typeof document !== 'undefined' && document.hasFocus())
    || hostFocused
    || Date.now() - lastFocusAt < FOCUS_GRACE_MS

  const refreshHostFocus = () => {
    void notifier.appWindowFocused().then(value => {
      hostFocused = value === true
    }, () => undefined)
  }

  const workspaceItems = () => {
    try {
      const service = ctx.get('workspaces')
      const snapshot = service !== undefined && service.list !== undefined ? service.list.getSnapshot() : undefined
      return snapshot !== undefined && Array.isArray(snapshot.items) ? snapshot.items : []
    } catch {
      return []
    }
  }

  const addWait = (sessionId, requestId, kind, firstSeenAt) => {
    waits.set(waitKey(sessionId, requestId), {
      sessionId,
      requestId,
      kind,
      firstSeenAt,
      reminded: false,
    })
  }

  const tick = () => {
    if (sessions === undefined || sessions.list === undefined) return
    const state = sessions.list.getSnapshot()
    const settings = store.getSnapshot()
    const now = Date.now()
    const focused = isFocused()
    const workspaces = workspaceItems()

    try {
    for (const id of state.ids) {
      const summary = state.byId[id]
      if (summary === undefined) continue
      const values = summary.projectionValues !== null && typeof summary.projectionValues === 'object'
        ? summary.projectionValues
        : {}
      const projection = values.bing
      const questionsValue = values.userQuestions

      // Finished turns ------------------------------------------------------
      const advance = turnAdvance(observedTurn.get(id), projection)
      observedTurn.set(id, advance.nextTurn)
      if (advance.fresh && projection !== undefined && isFresh(projection.endedAt, now)) {
        const reason = projection.reason
        const status = statusKey(reason)
        if (status !== undefined) {
          const dedupeKey = turnKey(id, projection.turn)
          const sound = decide(settings, { kind: 'turn', reason }, focused, dedupeKey, recent, now)
          if (sound !== null) {
            emitToast(id, summary, t, t(status), projection.body, t('toastEmpty'), sound, workspaces)
          }
        }
      }

      // Approvals -----------------------------------------------------------
      const pending = projection !== undefined && Array.isArray(projection.pending) ? projection.pending : []
      const previousApprovals = knownApprovals.get(id)
      if (previousApprovals === undefined) {
        knownApprovals.set(id, new Set(pending.map(entry => entry.requestId)))
        for (const entry of pending) addWait(id, entry.requestId, 'approval', entry.at || now)
      } else {
        for (const entry of newRequestIds(previousApprovals, pending)) {
          previousApprovals.add(entry.requestId)
          if (!isFresh(entry.at, now)) continue
          const dedupeKey = requestKey(id, entry.requestId)
          const sound = decide(settings, { kind: 'pending', pending: 'approval' }, focused, dedupeKey, recent, now)
          addWait(id, entry.requestId, 'approval', entry.at || now)
          if (sound !== null) {
            emitToast(id, summary, t, t('toastApproval'), entry.summary, t('toastPending'), sound, workspaces)
          }
        }
        const live = new Set(pending.map(entry => entry.requestId))
        for (const requestId of [...previousApprovals]) {
          if (!live.has(requestId)) {
            previousApprovals.delete(requestId)
            waits.delete(waitKey(id, requestId))
          }
        }
      }

      // Questions (official userQuestions projection) -----------------------
      const active = activeQuestions(questionsValue)
      const previousQuestions = knownQuestions.get(id)
      if (previousQuestions === undefined) {
        knownQuestions.set(id, new Set(active.map(entry => entry.callId)))
        for (const entry of active) addWait(id, entry.callId, 'question', now)
      } else {
        for (const entry of active) {
          if (previousQuestions.has(entry.callId)) continue
          const dedupeKey = askKey(id, entry.callId)
          const sound = decide(settings, { kind: 'pending', pending: 'question' }, focused, dedupeKey, recent, now)
          addWait(id, entry.callId, 'question', now)
          previousQuestions.add(entry.callId)
          if (sound !== null) {
            emitToast(id, summary, t, t('toastQuestion'), questionSummary(entry), t('toastPending'), sound, workspaces)
          }
        }
        const live = new Set(active.map(entry => entry.callId))
        for (const callId of [...previousQuestions]) {
          if (!live.has(callId)) {
            previousQuestions.delete(callId)
            waits.delete(waitKey(id, callId))
          }
        }
      }
    }
    } catch (error) {
      notifier.report('tick failed: ' + String(error))
    }

    const liveSessions = new Set(state.ids)
    for (const id of [...observedTurn.keys()]) if (!liveSessions.has(id)) observedTurn.delete(id)
    for (const id of [...knownApprovals.keys()]) if (!liveSessions.has(id)) knownApprovals.delete(id)
    for (const id of [...knownQuestions.keys()]) if (!liveSessions.has(id)) knownQuestions.delete(id)
    for (const entry of [...waits.values()]) {
      if (entry.sessionId !== 'global' && !liveSessions.has(entry.sessionId)) waits.delete(waitKey(entry.sessionId, entry.requestId))
    }
  }

  const rem = () => {
    if (sessions === undefined || sessions.list === undefined) return
    const settings = store.getSnapshot()
    const now = Date.now()
    const focused = isFocused()
    const workspaces = workspaceItems()
    for (const wait of [...waits.values()]) {
      if (wait.reminded) continue
      if (now - wait.firstSeenAt < settings.remindAfterMinutes * 60000) continue
      wait.reminded = true
      if (focused) continue
      const summary = sessions.list.getSnapshot().byId[wait.sessionId]
      const sound = decide(settings, { kind: 'reminder' }, focused, 'reminder:' + waitKey(wait.sessionId, wait.requestId), recent, now)
      if (sound !== null) {
        const status = t('toastReminder')
        const body = fmt(t('toastReminderBody'), { minutes: String(settings.remindAfterMinutes) })
        emitToast(wait.sessionId, summary, t, status, body, t('toastPending'), sound, workspaces)
      }
    }
  }

  const pollQuestions = () => {
    if (sessions === undefined || sessions.list === undefined) return
    if (typeof document !== 'undefined' && !document.hasFocus()) {
      refreshHostFocus()
    } else {
      hostFocused = false
      lastFocusAt = Date.now()
    }
    void notifier.pollQuestions().then(payload => {
      if (payload === null || typeof payload !== 'object') return
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!questionsSeeded) {
        questionSeq = typeof payload.seq === 'number' ? payload.seq : 0
        questionsSeeded = true
        return
      }
      const settings = store.getSnapshot()
      const now = Date.now()
      const focused = isFocused()
      const workspaces = workspaceItems()
      const state = sessions.list.getSnapshot()
      let nextSeq = questionSeq
      for (const item of items) {
        if (item === null || typeof item !== 'object') continue
        const seq = typeof item.seq === 'number' ? item.seq : 0
        if (seq > nextSeq) nextSeq = seq
        if (item.open !== true || seq <= questionSeq) continue
        const summary = state.byId[item.sessionId]
        const values = summary !== undefined && summary.projectionValues !== null && typeof summary.projectionValues === 'object'
          ? summary.projectionValues
          : {}
        const hasProjection = values.userQuestions !== undefined
        const active = new Set(activeQuestions(values.userQuestions).map(entry => entry.callId))
        const kind = item.kind === 'plan-review' ? 'plan-review' : 'question'
        if (kind !== 'plan-review' && hasProjection) continue
        if (active.has(item.key)) continue
        const dedupeKey = askKey(item.sessionId || 'global', item.key)
        const sound = decide(settings, { kind: 'pending', pending: kind }, focused, dedupeKey, recent, now)
        addWait(item.sessionId || 'global', item.key, kind, typeof item.at === 'number' ? item.at : now)
        if (sound !== null) {
          emitToast(item.sessionId || 'global', summary, t, t(pendingKey(kind)), item.summary, t('toastPending'), sound, workspaces)
        }
      }
      questionSeq = nextSeq
    }).catch(() => undefined)
  }

  const sendTest = sound => {
    const settings = store.getSnapshot()
    const chosen = sound !== undefined
      ? sound
      : (settings.soundEnabled ? settings.sounds.finished : 'silent')
    notifier.showToast({
      title: t('testToastTitle'),
      lines: [t('testToastBody')],
      sound: chosen,
    })
  }

  ctx.effect(() => {
    const onFocus = () => {
      lastFocusAt = Date.now()
      hostFocused = false
      void notifier.silence()
    }
    const onBlur = () => {
      refreshHostFocus()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, 'dsh-bing: focus listener')

  ctx.effect(() => {
    const reseed = () => {
      observedTurn.clear()
      knownApprovals.clear()
      knownQuestions.clear()
      waits.clear()
      questionSeq = 0
      questionsSeeded = false
    }
    const offReset = ctx.on('connection/reset', reseed)
    tick()
    if (sessions !== undefined && sessions.list !== undefined) {
      const off = sessions.list.subscribe(tick)
      return () => {
        off()
        offReset()
      }
    }
    return () => {
      offReset()
    }
  }, 'dsh-bing: session watcher')

  ctx.effect(() => {
    const timer = setInterval(pollQuestions, POLL_MS)
    return () => clearInterval(timer)
  }, 'dsh-bing: question poll')

  ctx.effect(() => {
    const timer = setInterval(rem, REMINDER_MS)
    return () => clearInterval(timer)
  }, 'dsh-bing: reminder timer')

  const face = () => ({
    store,
    set,
    sendTest,
    previewSound: id => {
      void notifier.previewSound(id)
    },
    pickFile: () => notifier.pickFile(),
    loadLibrary: () => notifier.soundLibrary(),
    importSound: file => notifier.importSound(file),
    deleteSound: id => notifier.deleteSound(id),
    cacheInfo: () => notifier.cacheInfo(),
    clearCache: () => notifier.clearCache(),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'bing',
    order: 60,
    label: () => t('nav'),
    locale: NS,
    inject: face,
  }, SettingsPage))

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'bing-sounds',
    order: 90,
    label: () => t('navSounds'),
    locale: NS,
    inject: face,
  }, PluginsTab))
}

exports.apply = apply
	};
	__modules["./locales.cjs"] = function (module, exports, require) {
// Locale namespace "bing": settings copy and toast statuses.
const NS = 'bing'

const zh = {
  nav: '通知',
  navSounds: '通知音效',
  title: '桌面通知',
  subtitle: '会话结束、出错或停下来等你时弹出 Windows 通知；点通知把窗口拉回前台。',
  enabled: '启用通知',
  enabledDesc: '总开关；关闭后不再弹任何通知。',
  sound: '提示音',
  soundDesc: '关掉后所有通知静音，音效选择保留。',
  whenTitle: '结束提醒',
  whenDesc: '选择哪些结束状态需要提醒。',
  whenCompleted: '正常完成',
  whenError: '出错',
  whenAborted: '被中止',
  whenBlocked: '被阻塞',
  whenMaxTokens: '达到 Token 上限',
  pendingTitle: '等待确认',
  pendingDesc: '会话停下来等你审批、回答或评审计划时提醒。',
  pendingApproval: '等待审批',
  pendingQuestion: '等待回答',
  pendingPlanReview: '等待计划评审',
  remindTitle: '超时催办',
  remindDesc: '等待超过设定分钟数仍未处理时补一条提醒。',
  remindMinutes: '分钟',
  soundsTitle: '音效',
  soundsDesc: '四类情况各选一个声音；选中即保存，试听只响声音、不弹通知。',
  soundFinished: '任务完成',
  soundError: '任务出错',
  soundAttention: '需要你处理',
  soundReminder: '超时催办',
  preview: '试听',
  groupBuiltin: '内置音效',
  groupCustom: '自定义音效',
  empty: '暂无',
  silent: '静音',
  libraryTitle: '自定义音效',
  libraryEmpty: '还没有自定义音效',
  addSound: '添加音效…',
  remove: '删除',
  libraryCount: '已导入 {count} 个文件',
  added: '已添加：{name}',
  removed: '已删除',
  addFailed: '添加失败：宿主没有响应或格式不支持',
  cacheLabel: '转码缓存',
  cacheEmpty: '暂无缓存',
  cacheInUse: '{files} 个文件 · {size}',
  cacheClear: '清理',
  cacheCleared: '已清理 {files} 个文件',
  testTitle: '测试',
  testDesc: '发一条测试通知，确认权限与音效正常。',
  testButton: '发送测试通知',
  toastCompleted: '已完成',
  toastError: '出错了',
  toastAborted: '已中止',
  toastBlocked: '被阻塞',
  toastMaxTokens: 'Token 达上限',
  toastApproval: '等你确认',
  toastQuestion: '等你回答',
  toastPlanReview: '等你评审',
  toastReminder: '还在等你',
  toastEmpty: '这一轮已结束。',
  toastPending: '有一条待处理的确认。',
  toastReminderBody: '已经等了 {minutes} 分钟。',
  testToastTitle: 'DSH 测试',
  testToastBody: '能看到这条通知，说明通知配置正常。',
  hostDown: '宿主没有响应',
}

const en = {
  nav: 'Notifications',
  navSounds: 'Notification sounds',
  title: 'Desktop notifications',
  subtitle: 'A Windows toast when a session finishes, fails, or waits for you; click it to raise the window.',
  enabled: 'Enable notifications',
  enabledDesc: 'Master switch; off disables every toast.',
  sound: 'Sound',
  soundDesc: 'Off mutes every notification while keeping the chosen sounds.',
  whenTitle: 'Turn outcomes',
  whenDesc: 'Which endings should notify.',
  whenCompleted: 'Completed',
  whenError: 'Error',
  whenAborted: 'Aborted',
  whenBlocked: 'Blocked',
  whenMaxTokens: 'Token limit',
  pendingTitle: 'Waiting on you',
  pendingDesc: 'Notify while a session waits for an approval, an answer, or a plan review.',
  pendingApproval: 'Waiting for approval',
  pendingQuestion: 'Waiting for an answer',
  pendingPlanReview: 'Waiting for a plan review',
  remindTitle: 'Reminder',
  remindDesc: 'Send one more toast when a wait passes the configured minutes.',
  remindMinutes: 'minutes',
  soundsTitle: 'Sounds',
  soundsDesc: 'One sound per situation; picking saves immediately, preview plays only the sound.',
  soundFinished: 'Finished',
  soundError: 'Failed',
  soundAttention: 'Needs you',
  soundReminder: 'Still waiting',
  preview: 'Preview',
  groupBuiltin: 'Built-in sounds',
  groupCustom: 'Custom sounds',
  empty: 'None',
  silent: 'Silent',
  libraryTitle: 'Custom sounds',
  libraryEmpty: 'No custom sounds yet',
  addSound: 'Add sound…',
  remove: 'Remove',
  libraryCount: '{count} file(s) imported',
  added: 'Added: {name}',
  removed: 'Removed',
  addFailed: 'Could not add: host unreachable or unsupported format',
  cacheLabel: 'Transcode cache',
  cacheEmpty: 'No cache',
  cacheInUse: '{files} file(s) · {size}',
  cacheClear: 'Clear',
  cacheCleared: 'Cleared {files} file(s)',
  testTitle: 'Test',
  testDesc: 'Send a test toast to confirm permission and sound.',
  testButton: 'Send a test notification',
  toastCompleted: 'done',
  toastError: 'failed',
  toastAborted: 'aborted',
  toastBlocked: 'blocked',
  toastMaxTokens: 'token limit',
  toastApproval: 'needs approval',
  toastQuestion: 'needs an answer',
  toastPlanReview: 'needs a plan review',
  toastReminder: 'still waiting',
  toastEmpty: 'This turn has ended.',
  toastPending: 'There is a pending confirmation.',
  toastReminderBody: 'Waiting for {minutes} minutes already.',
  testToastTitle: 'DSH test',
  testToastBody: 'If you can see this, notifications are configured.',
  hostDown: 'The host did not answer',
}

function fmt(template, params) {
  if (params === undefined) return template
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => (params[key] === undefined ? whole : params[key]))
}

module.exports = { NS, zh, en, fmt }

	};
	__modules["./notifier.cjs"] = function (module, exports, require) {
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

	};
	__modules["./project.cjs"] = function (module, exports, require) {
// Resolve the project label shown in a toast title.
//
// 0.2.1-rc.2 has no "is default workspace" flag. The default workspace's title
// equals the basename of its path, and a user rename makes the two differ; that
// is the signal this module uses. A default workspace can hold sessions from
// unrelated directories, so the session cwd wins there.
const DEFAULT_TITLES = new Set(['默认分区', '默认工作区', 'Default', 'Default workspace', 'default-workspace'])

const CJK = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/

function charWidth(char) {
  return CJK.test(char) ? 2 : 1
}

function clipWidth(value, maxWidth) {
  const text = String(value === undefined || value === null ? '' : value).trim().replace(/\s+/g, ' ')
  if (text === '') return ''
  let width = 0
  let kept = ''
  for (const char of text) {
    const next = width + charWidth(char)
    if (next > maxWidth) break
    width = next
    kept += char
  }
  return kept === '' ? text.slice(0, maxWidth) : kept
}

function basename(path) {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.split(/[\\/]+/).filter(part => part !== '')
  return parts.length === 0 ? '' : parts[parts.length - 1]
}

function findWorkspace(workspaces, sessionId, summary) {
  if (!Array.isArray(workspaces)) return undefined
  const workspaceId = summary !== null && typeof summary === 'object' ? summary.workspaceId : undefined
  return workspaces.find(workspace => {
    if (workspace === null || typeof workspace !== 'object') return false
    if (Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId)) return true
    return workspaceId !== undefined && workspace.workspaceId === workspaceId
  })
}

function projectLabel(sessionId, summary, workspaces) {
  const row = summary !== null && typeof summary === 'object' ? summary : {}
  const workspace = findWorkspace(workspaces, sessionId, row)
  const cwdName = basename(row.cwd)
  if (workspace !== undefined && typeof workspace.title === 'string' && workspace.title.trim() !== '') {
    const pathName = basename(workspace.path)
    const renamed = pathName !== '' && workspace.title !== pathName && !DEFAULT_TITLES.has(workspace.title)
    if (renamed) return clipWidth(workspace.title, 40)
    if (cwdName !== '') return clipWidth(cwdName, 40)
    return clipWidth(workspace.title, 40)
  }
  if (cwdName !== '') return clipWidth(cwdName, 40)
  if (typeof row.title === 'string' && row.title.trim() !== '') return clipWidth(row.title, 40)
  return clipWidth(row.displayTitle || 'DSH', 40) || 'DSH'
}

function sessionTitle(summary) {
  const row = summary !== null && typeof summary === 'object' ? summary : {}
  return typeof row.title === 'string' && row.title.trim() !== '' ? row.title.trim() : ''
}

module.exports = { projectLabel, sessionTitle, basename, clipWidth, charWidth }
	};
	__modules["./questions.cjs"] = function (module, exports, require) {
// Normalize the two question sources:
//   - the official userQuestions projection (logged asks, open/continued/settled);
//   - the host /questions queue (service-level plan review, plus a fallback for
//     sessions that carry no userQuestions projection).
function activeQuestions(value) {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.active)) return []
  return value.active.filter(entry => entry !== null && typeof entry === 'object' && typeof entry.callId === 'string')
}

function activeIds(value) {
  return new Set(activeQuestions(value).map(entry => entry.callId))
}

function questionSummary(entry) {
  if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.questions)) return ''
  const first = entry.questions[0]
  if (first === null || typeof first !== 'object') return ''
  return String(first.header || first.question || first.id || '')
}

function hostOpenItems(payload, afterSeq, activeCallIds) {
  const items = payload !== null && typeof payload === 'object' && Array.isArray(payload.items) ? payload.items : []
  let nextSeq = afterSeq
  const fresh = []
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const seq = typeof item.seq === 'number' ? item.seq : 0
    if (seq > nextSeq) nextSeq = seq
    if (item.open !== true || seq <= afterSeq) continue
    if (typeof item.key !== 'string' || item.key === '') continue
    if (activeCallIds !== undefined && activeCallIds.has(item.key)) continue
    fresh.push(item)
  }
  return { items: fresh, nextSeq }
}

function hostKind(item) {
  return item !== null && typeof item === 'object' && item.kind === 'plan-review' ? 'plan-review' : 'question'
}

function hostSummary(item) {
  return item !== null && typeof item === 'object' && typeof item.summary === 'string' ? item.summary : ''
}

module.exports = { activeQuestions, activeIds, questionSummary, hostOpenItems, hostKind, hostSummary }

	};
	__modules["./runner.cjs"] = function (module, exports, require) {
// Edge detection, freshness and de-duplication over the session list.
const FRESH_EVENT_MS = 60000
const DEDUPE_MS = 3000
const ASK_TWIN_MS = 5000

function turnAdvance(previousTurn, projection) {
  const turn = projection !== undefined && typeof projection.turn === 'number' ? projection.turn : 0
  return { nextTurn: turn, fresh: previousTurn !== undefined && turn > previousTurn }
}

function isFresh(timestamp, now) {
  return typeof timestamp === 'number' && timestamp > 0 && now - timestamp <= FRESH_EVENT_MS
}

function newRequestIds(known, pending) {
  if (!Array.isArray(pending)) return []
  return pending.filter(entry => entry !== null && typeof entry === 'object' && !known.has(entry.requestId))
}

function recentlyKeyed(recent, key, now, windowMs) {
  const at = recent.get(key)
  return at !== undefined && now - at < windowMs
}

function remember(recent, key, now, windowMs) {
  recent.set(key, now)
  for (const [stored, at] of recent) {
    if (now - at >= (windowMs === undefined ? DEDUPE_MS : windowMs)) recent.delete(stored)
  }
}

function turnKey(sessionId, turn) {
  return sessionId + ':turn:' + turn
}

function requestKey(sessionId, requestId) {
  return sessionId + ':request:' + requestId
}

function askKey(sessionId, callId) {
  return sessionId + ':ask:' + callId
}

module.exports = {
  FRESH_EVENT_MS,
  DEDUPE_MS,
  ASK_TWIN_MS,
  turnAdvance,
  isFresh,
  newRequestIds,
  recentlyKeyed,
  remember,
  turnKey,
  requestKey,
  askKey,
}

	};
	__modules["./settings.cjs"] = function (module, exports, require) {
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

	};
	__modules["./styles.cjs"] = function (module, exports, require) {
// One injected stylesheet; all colours and borders use DSH design tokens so
// the picker follows the active light/dark theme.
const STYLE_ID = 'dsh-bing-style'

const CSS = [
  '.dsh_bing_section{max-width:760px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary)}',
  '.dsh_bing_h2{margin:0;font-size:18px;font-weight:600}',
  '.dsh_bing_subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}',
  '.dsh_bing_card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
  '.dsh_bing_cardTitle{margin:0;font-size:14px;font-weight:600}',
  '.dsh_bing_row{display:flex;align-items:flex-start;gap:10px}',
  '.dsh_bing_rowText{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '.dsh_bing_rowLabel{font-size:13px;line-height:18px;cursor:pointer}',
  '.dsh_bing_rowDesc{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh_bing_check{margin-top:2px;accent-color:var(--dsw-alias-state-business-primary)}',
  '.dsh_bing_soundRow{display:flex;align-items:center;gap:10px;justify-content:space-between}',
  '.dsh_bing_soundLabel{font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh_bing_picker{position:relative;flex:0 0 auto}',
  '.dsh_bing_trigger{display:inline-flex;align-items:center;gap:6px;max-width:240px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
  '.dsh_bing_trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh_bing_triggerLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh_bing_caret{color:var(--dsw-alias-label-tertiary);font-size:10px}',
  '.dsh_bing_panel{position:absolute;z-index:40;top:calc(100% + 6px);right:0;width:320px;max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-surface-secondary,var(--dsw-alias-bg-layer-2,#1c1d21));box-shadow:0 10px 30px rgba(0,0,0,.28);padding:6px}',
  '.dsh_bing_group{padding:4px 0}',
  '.dsh_bing_groupLabel{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:4px 6px;text-transform:uppercase;letter-spacing:.04em}',
  '.dsh_bing_option{display:flex;align-items:center;gap:4px;border-radius:7px;padding:2px 2px 2px 0}',
  '.dsh_bing_option:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh_bing_selected{background:var(--dsw-alias-interactive-bg-selected,var(--dsw-alias-interactive-bg-hover))}',
  '.dsh_bing_optionMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;padding:5px 7px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.dsh_bing_optionName{font-size:12px;line-height:17px}',
  '.dsh_bing_optionMeta{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh_bing_preview{flex:0 0 auto;width:26px;height:24px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;cursor:pointer}',
  '.dsh_bing_preview:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh_bing_empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:6px}',
  '.dsh_bing_button{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
  '.dsh_bing_button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh_bing_danger{color:var(--dsw-alias-label-tertiary)}',
  '.dsh_bing_danger:hover{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary))}',
  '.dsh_bing_list{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}',
  '.dsh_bing_listRow{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;line-height:18px}',
  '.dsh_bing_muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh_bing_input{width:64px;padding:3px 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
  '.dsh_bing_actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.dsh_bing_note{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
].join('')

function adoptStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin="dsh-bing"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-bing'
  tag.textContent = CSS
  document.head.appendChild(tag)
}

module.exports = { adoptStyles, STYLE_ID, CSS }

	};
	__modules["./summary.cjs"] = function (module, exports, require) {
// Toast copy: flatten the assistant markdown, bound it to the lines a Windows
// toast actually shows, and compose "<project> · <status>" plus two body lines.
const SUMMARY_LIMIT = 56

function plainSummary(text, limit) {
  let out = String(text === undefined || text === null ? '' : text)
  out = out.replace(/\`\`\`[\s\S]*?\`\`\`/g, ' ')
  out = out.replace(/\`([^\`]*)\`/g, '$1')
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  out = out.replace(/^\s{0,3}>\s?/gm, '')
  out = out.replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
  out = out.replace(/^\s*\|.*\|\s*$/gm, ' ')
  out = out.replace(/\*\*(.+?)\*\*/g, '$1')
  out = out.replace(/(?:\*|_)([^*_]+)(?:\*|_)/g, '$1')
  out = out.replace(/<[^>]+>/g, ' ')
  out = out.replace(/\u001b\[[0-9;]*m/g, '')
  out = out.replace(/\s+/g, ' ').trim()
  if (out.length <= limit) return out
  const cut = Math.max(1, limit - 1)
  return out.slice(0, cut).trimEnd() + '…'
}

function composeToast(input) {
  const project = String(input.project || '').trim()
  const status = String(input.status || '').trim()
  const title = project === '' ? status : project + ' · ' + status
  const lines = []
  const sessionTitle = String(input.sessionTitle || '').trim()
  if (sessionTitle !== '' && sessionTitle !== project) lines.push(sessionTitle.slice(0, 36))
  const limit = lines.length > 0 ? 42 : SUMMARY_LIMIT
  const body = plainSummary(input.body, limit) || String(input.fallback || '').trim()
  if (body !== '') lines.push(body)
  return { title, lines: lines.slice(0, 2) }
}

module.exports = { plainSummary, composeToast, SUMMARY_LIMIT }
	};
	__modules["./ui.cjs"] = function (module, exports, require) {
// React surface: one sound picker shared by the full settings page and the
// Plugins-page tab. JSX-free: build.mjs does not transpile, so everything is
// React.createElement.
const React = require('react')
const { createElement: h, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React
const { fmt } = require('./locales.cjs')

function useSettings(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

function useLibrary(loadLibrary) {
  const [library, setLibrary] = useState({ builtin: [], custom: [] })
  const loaderRef = useRef(loadLibrary)
  useEffect(() => {
    loaderRef.current = loadLibrary
  }, [loadLibrary])
  const reload = React.useCallback(() => {
    const loader = loaderRef.current
    if (typeof loader !== 'function') return
    void loader().then(value => {
      if (value !== null && typeof value === 'object') {
        setLibrary({
          builtin: Array.isArray(value.builtin) ? value.builtin : [],
          custom: Array.isArray(value.custom) ? value.custom : [],
        })
      }
    }).catch(() => {})
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return { library, reload }
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function labelOf(id, library, t) {
  if (id === 'silent') return t('silent')
  const all = (library.builtin || []).concat(library.custom || [])
  const found = all.find(item => item.id === id)
  if (found !== undefined) return found.name || id
  if (typeof id === 'string' && id.indexOf(':') !== -1) return id.slice(id.indexOf(':') + 1).replace(/[-_]/g, ' ')
  return id
}

function SoundPicker(props) {
  const { value, library, t, onPick, onPreview } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = event => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const groups = [
    { key: 'builtin', label: t('groupBuiltin'), items: library.builtin || [] },
    { key: 'custom', label: t('groupCustom'), items: library.custom || [] },
  ]

  const sections = groups.map(group => {
    const options = group.items.length === 0
      ? h('div', { className: 'dsh_bing_empty' }, t('empty'))
      : group.items.map(item => {
        const main = h('button', {
          type: 'button',
          className: 'dsh_bing_optionMain',
          onClick: () => {
            onPick(item.id)
            setOpen(false)
          },
        },
        h('span', { className: 'dsh_bing_optionName' }, item.name || item.id),
        h('span', { className: 'dsh_bing_optionMeta' },
          item.description || (typeof item.seconds === 'number' ? item.seconds.toFixed(2) + 's' : '')))

        const preview = h('button', {
          type: 'button',
          className: 'dsh_bing_preview',
          title: t('preview'),
          'aria-label': t('preview'),
          onClick: event => {
            event.stopPropagation()
            onPreview(item.id)
          },
        }, '▶')

        return h('div', {
          key: item.id,
          role: 'option',
          'aria-selected': item.id === value ? 'true' : 'false',
          className: 'dsh_bing_option' + (item.id === value ? ' dsh_bing_selected' : ''),
        }, main, preview)
      })

    return h('div', { key: group.key, className: 'dsh_bing_group' },
      h('div', { className: 'dsh_bing_groupLabel' }, group.label),
      options)
  })

  return h('div', { className: 'dsh_bing_picker', ref: rootRef },
    h('button', {
      type: 'button',
      className: 'dsh_bing_trigger',
      'aria-expanded': open ? 'true' : 'false',
      onClick: () => setOpen(current => !current),
    },
    h('span', { className: 'dsh_bing_triggerLabel' }, labelOf(value, library, t)),
    h('span', { className: 'dsh_bing_caret' }, '▾')),
    open ? h('div', { className: 'dsh_bing_panel', role: 'listbox' }, sections) : null)
}

function Toggle(props) {
  return h('div', { className: 'dsh_bing_row' },
    h('input', {
      id: props.id,
      className: 'dsh_bing_check',
      type: 'checkbox',
      checked: props.checked,
      onChange: event => props.onChange(event.target.checked),
    }),
    h('div', { className: 'dsh_bing_rowText' },
      h('label', { className: 'dsh_bing_rowLabel', htmlFor: props.id }, props.label),
      props.desc === undefined ? null : h('span', { className: 'dsh_bing_rowDesc' }, props.desc)))
}

function SoundRow(props) {
  const { group, label, t, settings, set, library, onPreview } = props
  return h('div', { className: 'dsh_bing_soundRow' },
    h('span', { className: 'dsh_bing_soundLabel' }, label),
    h(SoundPicker, {
      value: settings.sounds[group],
      library,
      t,
      onPick: id => set({ sounds: { ...settings.sounds, [group]: id } }),
      onPreview,
    }))
}

function LibraryCard(props) {
  const { t, library, onAdd, onRemove, note } = props
  const [cache, setCache] = useState(null)
  const cacheInfoRef = useRef(props.cacheInfo)
  useEffect(() => {
    cacheInfoRef.current = props.cacheInfo
  }, [props.cacheInfo])
  useEffect(() => {
    const loader = cacheInfoRef.current
    if (typeof loader !== 'function') return
    void loader().then(value => {
      if (value !== null && typeof value === 'object') setCache(value)
    }).catch(() => {})
  }, [])
  return h('div', { className: 'dsh_bing_card' },
    h('h3', { className: 'dsh_bing_cardTitle' }, t('libraryTitle')),
    library.custom.length === 0
      ? h('span', { className: 'dsh_bing_muted' }, t('libraryEmpty'))
      : h('ul', { className: 'dsh_bing_list' }, library.custom.map(item => h('li', {
        key: item.id,
        className: 'dsh_bing_listRow',
      },
      h('span', null, item.name + (item.bytes ? ' · ' + formatBytes(item.bytes) : '')),
      h('button', {
        type: 'button',
        className: 'dsh_bing_button dsh_bing_danger',
        onClick: () => onRemove(item.id),
      }, t('remove'))))),
    h('div', { className: 'dsh_bing_actions' },
      h('button', { type: 'button', className: 'dsh_bing_button', onClick: onAdd }, t('addSound')),
      note === '' ? null : h('span', { className: 'dsh_bing_note' }, note)),
    cache === null ? null : h('div', { className: 'dsh_bing_row' },
      h('span', { className: 'dsh_bing_muted' },
        cache.files > 0
          ? fmt(t('cacheInUse'), { files: String(cache.files), size: formatBytes(cache.bytes) })
          : t('cacheEmpty')),
      cache.files > 0
        ? h('button', {
          type: 'button',
          className: 'dsh_bing_button',
          onClick: () => {
            void props.clearCache().then(value => {
              if (value !== null && typeof value === 'object') setCache({ files: 0, bytes: 0 })
            }).catch(() => {})
          },
        }, t('cacheClear'))
        : null))
}

function SettingsPage(props) {
  const t = typeof props.t === 'function' ? props.t : key => key
  const settings = useSettings(props.store)
  const { library, reload } = useLibrary(props.loadLibrary)
  const [note, setNote] = useState('')
  const set = props.set
  const preview = id => {
    void props.previewSound(id)
  }
  const addSound = () => {
    void props.pickFile().then(path => {
      if (path === '') return null
      return props.importSound(path)
    }).then(name => {
      if (name === null || name === undefined) {
        setNote(t('addFailed'))
        return
      }
      setNote(fmt(t('added'), { name }))
      reload()
    }).catch(() => setNote(t('addFailed')))
  }
  const removeSound = id => {
    void props.deleteSound(id).then(ok => {
      if (ok === true) {
        setNote(t('removed'))
        reload()
      }
    }).catch(() => {})
  }
  return h('div', { className: 'dsh_bing_section' },
    h('h2', { className: 'dsh_bing_h2' }, t('title')),
    h('p', { className: 'dsh_bing_subtitle' }, t('subtitle')),
    h('div', { className: 'dsh_bing_card' },
      h(Toggle, {
        id: 'dsh-bing-enabled',
        label: t('enabled'),
        desc: t('enabledDesc'),
        checked: settings.enabled,
        onChange: value => set({ enabled: value }),
      }),
      h(Toggle, {
        id: 'dsh-bing-sound',
        label: t('sound'),
        desc: t('soundDesc'),
        checked: settings.soundEnabled,
        onChange: value => set({ soundEnabled: value }),
      })),
    h('div', { className: 'dsh_bing_card' },
      h('h3', { className: 'dsh_bing_cardTitle' }, t('whenTitle')),
      h('span', { className: 'dsh_bing_rowDesc' }, t('whenDesc')),
      h(Toggle, { id: 'dsh-bing-completed', label: t('whenCompleted'), checked: settings.notifyCompleted, onChange: value => set({ notifyCompleted: value }) }),
      h(Toggle, { id: 'dsh-bing-error', label: t('whenError'), checked: settings.notifyError, onChange: value => set({ notifyError: value }) }),
      h(Toggle, { id: 'dsh-bing-aborted', label: t('whenAborted'), checked: settings.notifyAborted, onChange: value => set({ notifyAborted: value }) }),
      h(Toggle, { id: 'dsh-bing-blocked', label: t('whenBlocked'), checked: settings.notifyBlocked, onChange: value => set({ notifyBlocked: value }) }),
      h(Toggle, { id: 'dsh-bing-max', label: t('whenMaxTokens'), checked: settings.notifyMaxTokens, onChange: value => set({ notifyMaxTokens: value }) })),
    h('div', { className: 'dsh_bing_card' },
      h('h3', { className: 'dsh_bing_cardTitle' }, t('pendingTitle')),
      h('span', { className: 'dsh_bing_rowDesc' }, t('pendingDesc')),
      h(Toggle, { id: 'dsh-bing-approval', label: t('pendingApproval'), checked: settings.notifyApproval, onChange: value => set({ notifyApproval: value }) }),
      h(Toggle, { id: 'dsh-bing-question', label: t('pendingQuestion'), checked: settings.notifyQuestion, onChange: value => set({ notifyQuestion: value }) }),
      h(Toggle, { id: 'dsh-bing-plan', label: t('pendingPlanReview'), checked: settings.notifyPlanReview, onChange: value => set({ notifyPlanReview: value }) })),
    h('div', { className: 'dsh_bing_card' },
      h('h3', { className: 'dsh_bing_cardTitle' }, t('soundsTitle')),
      h('span', { className: 'dsh_bing_rowDesc' }, t('soundsDesc')),
      h(SoundRow, { group: 'finished', label: t('soundFinished'), t, settings, set, library, onPreview: preview }),
      h(SoundRow, { group: 'error', label: t('soundError'), t, settings, set, library, onPreview: preview }),
      h(SoundRow, { group: 'attention', label: t('soundAttention'), t, settings, set, library, onPreview: preview }),
      h(SoundRow, { group: 'reminder', label: t('soundReminder'), t, settings, set, library, onPreview: preview }),
      h('div', { className: 'dsh_bing_actions' },
        h('button', { type: 'button', className: 'dsh_bing_button', onClick: () => props.sendTest() }, t('testButton')))),
    h('div', { className: 'dsh_bing_card' },
      h('h3', { className: 'dsh_bing_cardTitle' }, t('remindTitle')),
      h('span', { className: 'dsh_bing_rowDesc' }, t('remindDesc')),
      h('label', { className: 'dsh_bing_row' },
        h('input', {
          className: 'dsh_bing_input',
          type: 'number',
          min: 1,
          max: 240,
          value: settings.remindAfterMinutes,
          onChange: event => set({ remindAfterMinutes: Number(event.target.value) }),
        }),
        h('span', { className: 'dsh_bing_rowLabel' }, t('remindMinutes')))),
    h(LibraryCard, {
      t,
      library,
      onAdd: addSound,
      onRemove: removeSound,
      note,
      cacheInfo: props.cacheInfo,
      clearCache: props.clearCache,
    }))
}

function PluginsTab(props) {
  const t = typeof props.t === 'function' ? props.t : key => key
  const settings = useSettings(props.store)
  const { library, reload } = useLibrary(props.loadLibrary)
  const [note, setNote] = useState('')
  const set = props.set
  const preview = id => {
    void props.previewSound(id)
  }
  const addSound = () => {
    void props.pickFile().then(path => {
      if (path === '') return null
      return props.importSound(path)
    }).then(name => {
      if (name === null || name === undefined) {
        setNote(t('addFailed'))
        return
      }
      setNote(fmt(t('added'), { name }))
      reload()
    }).catch(() => setNote(t('addFailed')))
  }
  return h('div', { className: 'dsh_bing_section' },
    h('h3', { className: 'dsh_bing_h2' }, t('soundsTitle')),
    h('p', { className: 'dsh_bing_subtitle' }, t('soundsDesc')),
    h('div', { className: 'dsh_bing_card' },
      h(SoundRow, { group: 'finished', label: t('soundFinished'), t, settings, set, library, onPreview: preview }),
      h(SoundRow, { group: 'error', label: t('soundError'), t, settings, set, library, onPreview: preview }),
      h(SoundRow, { group: 'attention', label: t('soundAttention'), t, settings, set, library, onPreview: preview }),
      h(SoundRow, { group: 'reminder', label: t('soundReminder'), t, settings, set, library, onPreview: preview }),
      h('div', { className: 'dsh_bing_actions' },
        h('button', { type: 'button', className: 'dsh_bing_button', onClick: addSound }, t('addSound')),
        h('button', { type: 'button', className: 'dsh_bing_button', onClick: () => props.sendTest() }, t('testButton'))),
      note === '' ? null : h('span', { className: 'dsh_bing_note' }, note)))
}

module.exports = { SettingsPage, PluginsTab, SoundPicker, labelOf, useLibrary, useSettings }
	};
		return __localRequire("./index.js");
	}
});
