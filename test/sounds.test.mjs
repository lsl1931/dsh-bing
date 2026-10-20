import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSound, safeSoundName, soundLibrary } from '../src/shared/sounds.js'

test('the built-in pack is complete and resolvable', () => {
  const library = soundLibrary()
  assert.equal(library.builtin.length, 8)
  const ids = library.builtin.map(item => item.id)
  assert.deepEqual(ids, [
    'builtin:aurora',
    'builtin:marimba',
    'builtin:kalimba',
    'builtin:glass',
    'builtin:bubble',
    'builtin:low',
    'builtin:descend',
    'builtin:bloom',
  ])
  const resolved = resolveSound('builtin:aurora')
  assert.equal(typeof resolved.wav, 'string')
  assert.ok(resolved.wav.endsWith('01-aurora.wav'))
})

test('silent and unknown ids degrade safely', () => {
  assert.deepEqual(resolveSound('silent'), { silent: true })
  assert.equal(resolveSound('custom:../../escape.wav').event, 'ms-winsoundevent:Notification.Default')
  assert.equal(resolveSound('nonsense').event, 'ms-winsoundevent:Notification.Default')
})

test('safe names reject traversal and separators', () => {
  assert.equal(safeSoundName('chime.wav'), true)
  assert.equal(safeSoundName('中文 音效.wav'), true)
  assert.equal(safeSoundName('..'), false)
  assert.equal(safeSoundName('..\\x.wav'), false)
  assert.equal(safeSoundName('a/b.wav'), false)
})