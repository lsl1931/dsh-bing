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
