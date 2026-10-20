import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, name } from '../src/index.js'

function makeContext() {
  const routes = new Map()
  const ctx = {
    projection: undefined,
    sessionProjections: {
      register(definition) {
        ctx.projection = definition
      },
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    on() {
      return () => {}
    },
    inject(_services, callback) {
      callback(scoped)
    },
    get(service) {
      if (service === 'sessionProjections') return ctx.sessionProjections
      if (service === 'sessions') return { list: () => [] }
      return undefined
    },
  }
  const scoped = {
    effect: ctx.effect,
    webServer: {
      register(entry) {
        routes.set(entry.path, entry.handler)
      },
    },
  }
  return { ctx, routes }
}

function response() {
  const state = { status: 0, body: '' }
  return {
    state,
    writeHead(status) {
      state.status = status
    },
    end(body) {
      state.body = body === undefined ? '' : String(body)
    },
  }
}

test('apply registers the projection and all routes', () => {
  const { ctx, routes } = makeContext()
  apply(ctx)
  assert.equal(name, 'dsh-bing')
  assert.equal(ctx.projection.key, 'bing')
  assert.equal(ctx.projection.stateVersion, 1)
  assert.equal(routes.size, 13)
  assert.equal(typeof routes.get('/dsh-bing/toast'), 'function')
  assert.equal(typeof routes.get('/dsh-bing/debug'), 'function')
})

test('the sound library route lists the eight built-ins', () => {
  const { ctx, routes } = makeContext()
  apply(ctx)
  const res = response()
  routes.get('/dsh-bing/sound-library')({ method: 'GET', headers: { 'x-dsh-bing': '1' } }, res)
  assert.equal(res.state.status, 200)
  const body = JSON.parse(res.state.body)
  assert.equal(body.builtin.length, 8)
  assert.equal(body.custom.length, 0)
})

test('routes reject the wrong method and a missing same-origin header', () => {
  const { ctx, routes } = makeContext()
  apply(ctx)
  const wrongMethod = response()
  routes.get('/dsh-bing/sound-library')({ method: 'POST', headers: { 'x-dsh-bing': '1' } }, wrongMethod)
  assert.equal(wrongMethod.state.status, 405)
  const missingHeader = response()
  routes.get('/dsh-bing/sound-library')({ method: 'GET', headers: {} }, missingHeader)
  assert.equal(missingHeader.state.status, 403)
})

test('debug is readable without the header and reports the library', () => {
  const { ctx, routes } = makeContext()
  apply(ctx)
  const res = response()
  routes.get('/dsh-bing/debug')({ method: 'GET', headers: {} }, res)
  assert.equal(res.state.status, 200)
  const body = JSON.parse(res.state.body)
  assert.equal(body.registryPresent, true)
  assert.equal(body.sessionCount, 0)
  assert.equal(body.library.builtin, 8)
})
