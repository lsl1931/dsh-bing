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
  if (sessionTitle !== '' && sessionTitle !== project) lines.push(sessionTitle.slice(0, 64))
  const limit = lines.length > 0 ? 42 : SUMMARY_LIMIT
  const body = plainSummary(input.body, limit) || String(input.fallback || '').trim()
  if (body !== '') lines.push(body)
  return { title, lines: lines.slice(0, 2) }
}

module.exports = { plainSummary, composeToast, SUMMARY_LIMIT }
