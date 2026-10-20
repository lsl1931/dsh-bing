// The bing session projection: a pure fold of one session's committed events
// into the last finished turn plus the approvals currently blocking on the user.
//
// Questions are deliberately absent: 0.2.1-rc.2 already ships a client-visible
// userQuestions projection with open/continued/settled state, and folding
// ask_user_question here would miss "continued" and report the same ask twice.
import { array, enumOf, nonNegativeInt, nullable, number, object, string } from './schema.js'

/** The projection key this plugin owns. */
export const BING_KEY = 'bing'

/** Character budget for the projected reply text. */
export const MAX_BODY_CHARS = 400

/** One approval waiting on the user. */
const pendingSchema = object({
  kind: enumOf('approval'),
  requestId: string,
  summary: string,
  at: number,
})

const viewSchema = object({
  turn: nonNegativeInt,
  reason: string,
  body: string,
  endedAt: number,
  pending: array(pendingSchema),
  updatedAt: number,
})

const openSchema = object({ turn: number, text: string })
const lastSchema = object({ turn: number, reason: string, body: string, endedAt: number })

const stateSchema = object({
  inheritedEventCount: nonNegativeInt,
  open: nullable(openSchema),
  last: nullable(lastSchema),
  pending: array(pendingSchema),
  updatedAt: number,
  view: viewSchema,
})

/**
 * Rebuild the wire view from the fold's visible fields.
 * @param {object} base - the state without its cached view.
 * @returns {object} the wire view.
 */
function buildView(base) {
  return {
    turn: base.last === null ? 0 : base.last.turn,
    reason: base.last === null ? '' : base.last.reason,
    body: base.last === null ? '' : base.last.body,
    endedAt: base.last === null ? 0 : base.last.endedAt,
    pending: base.pending,
    updatedAt: base.updatedAt,
  }
}

/**
 * Attach a freshly built view.
 * @param {object} base - state without view.
 */
function withView(base) {
  return { ...base, view: buildView(base) }
}

/** The empty-log view, exported for diagnostics and tests. */
export const EMPTY_VIEW = Object.freeze({
  turn: 0,
  reason: '',
  body: '',
  endedAt: 0,
  pending: Object.freeze([]),
  updatedAt: 0,
})

/**
 * The initial fold state.
 * @param {number} inheritedEventCount - events below this seq are fork-inherited.
 */
export function initialState(inheritedEventCount) {
  return withView({
    inheritedEventCount,
    open: null,
    last: null,
    pending: [],
    updatedAt: 0,
  })
}

/** Read a string field off an unknown record. */
function text(source, key) {
  if (typeof source !== 'object' || source === null) return undefined
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

/** Read a number field off an unknown record. */
function num(source, key) {
  if (typeof source !== 'object' || source === null) return undefined
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Bound one reply to the body budget, ellipsizing on overflow. */
function boundText(value, maxChars) {
  if (value.length <= maxChars) return value
  return value.slice(0, Math.max(0, maxChars - 1)) + '…'
}

/** Text contributed by one assistant message. */
function assistantText(message) {
  if (typeof message !== 'object' || message === null) return ''
  const content = message.content
  if (!Array.isArray(content)) return ''
  let textValue = ''
  for (const block of content) {
    if (text(block, 'type') === 'text') textValue += text(block, 'text') || ''
  }
  return textValue
}

/** Remove one pending approval; the same array when absent. */
function withoutPending(pending, requestId) {
  const index = pending.findIndex(entry => entry.requestId === requestId)
  if (index === -1) return pending
  return pending.slice(0, index).concat(pending.slice(index + 1))
}

/** Append one pending approval; the same array when already present. */
function withPending(pending, entry) {
  if (pending.some(current => current.requestId === entry.requestId)) return pending
  return pending.concat([entry])
}

/**
 * Apply one committed event to the fold.
 * @param {object} state - the state covering all prior events.
 * @param {{seq?: number, type?: string, time?: number, data?: unknown}} event - the next event.
 * @param {number} [maxChars] - the reply-text budget.
 * @returns {object} the next state, or the same reference when nothing changed.
 */
export function applyBingEvent(state, event, maxChars = MAX_BODY_CHARS) {
  if (typeof event.seq === 'number' && event.seq < state.inheritedEventCount) return state
  const data = event.data
  const at = typeof event.time === 'number' ? event.time : state.updatedAt
  switch (event.type) {
    case 'turn/start': {
      const turn = num(data, 'turn')
      if (turn === undefined) return state
      return { ...state, open: { turn, text: '' }, updatedAt: at }
    }
    case 'assistant/message': {
      const open = state.open
      if (open === null) return state
      const turn = num(data, 'turn')
      if (turn !== undefined && turn !== open.turn) return state
      const appended = assistantText(data === undefined ? undefined : data.message)
      if (appended === '') return state
      return {
        ...state,
        open: { turn: open.turn, text: boundText(open.text + appended, maxChars) },
        updatedAt: at,
      }
    }
    case 'turn/end': {
      const open = state.open
      if (open === null) return state
      const turn = num(data, 'turn')
      if (turn !== undefined && turn !== open.turn) return state
      const reasonRecord = data === undefined ? undefined : data.reason
      const reason = typeof reasonRecord === 'string' ? reasonRecord : text(reasonRecord, 'kind') || ''
      return withView({
        ...state,
        open: null,
        last: {
          turn: open.turn,
          reason,
          body: open.text.trim(),
          endedAt: at,
        },
        updatedAt: at,
      })
    }
    case 'approval/asked': {
      const requestId = text(data, 'id')
      if (requestId === undefined) return state
      const summary = (text(data, 'reason') || text(data, 'toolName') || '').trim()
      const next = withPending(state.pending, {
        kind: 'approval',
        requestId,
        summary,
        at,
      })
      if (next === state.pending) return state
      return withView({ ...state, pending: next, updatedAt: at })
    }
    case 'approval/decided': {
      const requestId = text(data, 'id')
      if (requestId === undefined) return state
      const next = withoutPending(state.pending, requestId)
      if (next === state.pending) return state
      return withView({ ...state, pending: next, updatedAt: at })
    }
    default:
      return state
  }
}

/**
 * Build the projection definition registered on ctx.sessionProjections.
 * @param {number} [maxChars] - the reply-text budget.
 */
export function bingProjection(maxChars = MAX_BODY_CHARS) {
  return {
    key: BING_KEY,
    stateSchema,
    stateVersion: 1,
    init: (_header, inheritedEventCount) => initialState(inheritedEventCount),
    apply: (state, event) => applyBingEvent(state, event, maxChars),
    wire: {
      viewSchema,
      view: state => state.view,
    },
  }
}
