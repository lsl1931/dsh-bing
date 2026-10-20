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
