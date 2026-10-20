import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { composeToast, plainSummary } = require('../src/client/summary.cjs')

test('markdown is flattened into one line', () => {
  const text = '# Title\n\n- one\n- two\n\n`code` and **bold** and [link](https://x.test)'
  assert.equal(plainSummary(text, 200), 'Title one two code and bold and link')
})

test('the title is project + status', () => {
  const toast = composeToast({ project: 'dsh-bing', status: '已完成', sessionTitle: '实现通知', body: 'done', fallback: '结束' })
  assert.equal(toast.title, 'dsh-bing · 已完成')
  assert.deepEqual(toast.lines, ['实现通知', 'done'])
})

test('a session title equal to the project is omitted, and the body gets more room', () => {
  const toast = composeToast({ project: 'dsh-bing', status: 'done', sessionTitle: 'dsh-bing', body: 'x'.repeat(200), fallback: '' })
  assert.deepEqual(toast.lines.length, 1)
  assert.ok(toast.lines[0].endsWith('…'))
})

test('empty prose falls back', () => {
  const toast = composeToast({ project: 'p', status: 's', sessionTitle: '', body: '', fallback: '这一轮已结束。' })
  assert.deepEqual(toast.lines, ['这一轮已结束。'])
})
