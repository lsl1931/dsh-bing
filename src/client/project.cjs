// Resolve the project label shown in a toast title.
//
// 0.2.1-rc.2 has no "is default workspace" flag. The default workspace's title
// equals the basename of its path, and a user rename makes the two differ; that
// is the signal this module uses. A default workspace can hold sessions from
// unrelated directories, so the session cwd wins there.
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
    const renamed = pathName !== '' && workspace.title !== pathName
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
