import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { projectLabel } = require('../src/client/project.cjs')

const workspaces = [
  { workspaceId: 'w1', title: '客户项目 A', path: 'C:\\work\\default-workspace', sessionIds: ['s1'] },
  { workspaceId: 'w2', title: 'dsh-bing', path: 'C:\\RJ\\dsh-bing', sessionIds: ['s2'] },
]

test('a renamed workspace wins', () => {
  assert.equal(projectLabel('s1', { cwd: 'C:\\work\\demo', title: 'demo' }, workspaces), '客户项目 A')
})

test('an unrenamed workspace uses the session cwd', () => {
  assert.equal(projectLabel('s2', { cwd: 'C:\\RJ\\dsh-plugins\\dsh-bing' }, workspaces), 'dsh-bing')
})

test('no workspace falls back to cwd, then the real title', () => {
  assert.equal(projectLabel('s3', { cwd: 'C:\\RJ\\dsh-plugins\\dsh-bing' }, []), 'dsh-bing')
  assert.equal(projectLabel('s3', { title: 'fix the toast' }, []), 'fix the toast')
  assert.equal(projectLabel('s3', { displayTitle: 'dsh-bing' }, undefined), 'dsh-bing')
})

test('the default workspace does not mask a different cwd', () => {
  const defaultWorkspace = [{ workspaceId: 'd', title: 'default-workspace', path: 'C:\\Users\\me\\Documents\\default-workspace', sessionIds: ['s4'] }]
  assert.equal(projectLabel('s4', { cwd: 'C:\\RJ\\other-project' }, defaultWorkspace), 'other-project')
})

test('long CJK names are bounded by display width', () => {
  const label = projectLabel('s5', { cwd: 'C:\\RJ\\' + '很长的项目名称'.repeat(4) }, [])
  assert.ok(label.length > 0)
  assert.ok(label.length <= 40)
})
