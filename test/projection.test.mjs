import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyBingEvent, bingProjection, initialState } from '../src/shared/projection.js'

function event(seq, type, data, time = seq * 100) {
  return { seq, type, data, time }
}

test('fold produces the last finished turn', () => {
  let state = initialState(0)
  state = applyBingEvent(state, event(0, 'turn/start', { turn: 1 }))
  state = applyBingEvent(state, event(1, 'assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'hello' }] } }))
  state = applyBingEvent(state, event(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
  assert.deepEqual(state.view, {
    turn: 1,
    reason: 'completed',
    body: 'hello',
    endedAt: 200,
    pending: [],
    updatedAt: 200,
  })
})

test('unrelated events keep the same state and open text keeps the same view', () => {
  let state = initialState(0)
  state = applyBingEvent(state, event(0, 'turn/start', { turn: 1 }))
  const started = state
  state = applyBingEvent(state, event(1, 'assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'a' }] } }))
  assert.notEqual(state, started)
  assert.equal(state.view, started.view)
  assert.equal(applyBingEvent(state, event(2, 'user/message', {})), state)
})

test('fork-inherited events are skipped', () => {
  const state = initialState(5)
  assert.equal(applyBingEvent(state, event(4, 'turn/start', { turn: 1 })), state)
})

test('approval asked and decided update pending', () => {
  let state = initialState(0)
  state = applyBingEvent(state, event(0, 'approval/asked', { id: 'a1', toolName: 'pwsh' }))
  assert.deepEqual(state.view.pending, [{ kind: 'approval', requestId: 'a1', summary: 'pwsh', at: 0 }])
  state = applyBingEvent(state, event(1, 'approval/decided', { id: 'a1' }))
  assert.deepEqual(state.view.pending, [])
})

test('the state schema accepts a checkpoint and rejects a broken one', () => {
  let state = initialState(0)
  state = applyBingEvent(state, event(0, 'turn/start', { turn: 1 }))
  state = applyBingEvent(state, event(1, 'turn/end', { turn: 1, reason: { kind: 'error' } }))
  const definition = bingProjection()
  assert.equal(definition.stateVersion, 1)
  const parsed = definition.stateSchema.parse(JSON.parse(JSON.stringify(state)))
  assert.equal(parsed.view.reason, 'error')
  assert.throws(() => definition.stateSchema.parse({ ...state, view: { ...state.view, turn: -1 } }))
  assert.throws(() => definition.stateSchema.parse({ ...state, pending: [{ kind: 'question' }] }))
})
