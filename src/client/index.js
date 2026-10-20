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
    for (const entry of [...waits.values()]) if (!liveSessions.has(entry.sessionId)) waits.delete(waitKey(entry.sessionId, entry.requestId))
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