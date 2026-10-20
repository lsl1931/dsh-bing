import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const runner = require('../src/client/runner.cjs')

test('turn advance only fires after the first baseline', () => {
  assert.deepEqual(runner.turnAdvance(undefined, { turn: 3 }), { nextTurn: 3, fresh: false })
  assert.deepEqual(runner.turnAdvance(2, { turn: 3 }), { nextTurn: 3, fresh: true })
  assert.deepEqual(runner.turnAdvance(3, { turn: 3 }), { nextTurn: 3, fresh: false })
})

test('freshness is bounded', () => {
  assert.equal(runner.isFresh(1000, 2000), true)
  assert.equal(runner.isFresh(1000, 61001), false)
  assert.equal(runner.isFresh(0, 1000), false)
})

test('dedupe remembers and prunes', () => {
  const recent = new Map()
  runner.remember(recent, 'a', 1000, 3000)
  assert.equal(runner.recentlyKeyed(recent, 'a', 2000, 3000), true)
  assert.equal(runner.recentlyKeyed(recent, 'a', 5000, 3000), false)
})

test('new request ids ignore known ids', () => {
  const fresh = runner.newRequestIds(new Set(['a']), [{ requestId: 'a' }, { requestId: 'b' }])
  assert.deepEqual(fresh.map(item => item.requestId), ['b'])
})
