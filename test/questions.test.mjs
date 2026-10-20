import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { activeQuestions, activeIds, questionSummary, hostOpenItems, hostKind } = require('../src/client/questions.cjs')

const value = {
  active: [
    { callId: 'c1', questions: [{ header: '选一个', question: 'which?' }], state: 'open' },
    { callId: 'c2', questions: [{ question: 'continued?' }], state: 'continued' },
  ],
  settled: [],
}

test('active questions are exposed with their summary', () => {
  assert.equal(activeQuestions(value).length, 2)
  assert.deepEqual([...activeIds(value)], ['c1', 'c2'])
  assert.equal(questionSummary(value.active[0]), '选一个')
})

test('host queue skips closed, old and already-projected items', () => {
  const payload = {
    seq: 4,
    items: [
      { seq: 3, key: 'old', open: true },
      { seq: 4, key: 'open', open: true },
      { seq: 5, key: 'closed', open: false },
      { seq: 6, key: 'c1', open: true },
    ],
  }
  const result = hostOpenItems(payload, 3, new Set(['c1']))
  assert.deepEqual(result.items.map(item => item.key), ['open'])
  assert.equal(result.nextSeq, 6)
})

test('host kinds map plan review and questions', () => {
  assert.equal(hostKind({ kind: 'plan-review' }), 'plan-review')
  assert.equal(hostKind({ kind: 'question' }), 'question')
})
