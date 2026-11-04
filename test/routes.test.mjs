import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isAllowedRequest, nextConfigAfterClear, nextConfigAfterSave } from '../src/routes.ts'

/** Build the slice of an HTTP request the fence inspects. */
function req(remoteAddress, headers) {
  return { remoteAddress, headers }
}

const HOST = '100.92.191.33:3080'

describe('isAllowedRequest loopback', () => {
  it('allows a loopback socket addressed as 127.0.0.1', () => {
    assert.equal(isAllowedRequest(req('127.0.0.1', { host: '127.0.0.1:3080' })), true)
  })

  it('allows a loopback socket addressed as localhost', () => {
    assert.equal(isAllowedRequest(req('127.0.0.1', { host: 'localhost:3080' })), true)
  })

  it('allows an IPv6 loopback socket', () => {
    assert.equal(isAllowedRequest(req('::1', { host: '[::1]:3080' })), true)
  })

  it('rejects a loopback socket carrying a non-loopback host header', () => {
    assert.equal(isAllowedRequest(req('127.0.0.1', { host: HOST })), false)
  })

  it('rejects a missing host header', () => {
    assert.equal(isAllowedRequest(req('127.0.0.1', {})), false)
  })
})

describe('isAllowedRequest off-loopback', () => {
  it('rejects a remote socket by default', () => {
    assert.equal(isAllowedRequest(req('100.92.191.33', { host: HOST, origin: `http://${HOST}` })), false)
  })

  it('allows a host the operator listed, from a browser on that same origin', () => {
    const request = req('100.92.191.33', { host: HOST, origin: `http://${HOST}` })
    assert.equal(isAllowedRequest(request, [HOST]), true)
  })

  it('rejects a listed host when the request carries no origin', () => {
    assert.equal(isAllowedRequest(req('100.92.191.33', { host: HOST }), [HOST]), false)
  })

  it('rejects a listed host when the origin points somewhere else', () => {
    const request = req('100.92.191.33', { host: HOST, origin: 'https://evil.example' })
    assert.equal(isAllowedRequest(request, [HOST]), false)
  })

  it('rejects a different host that happens to be listed', () => {
    const request = req('100.92.191.33', { host: 'other:3080', origin: 'http://other:3080' })
    assert.equal(isAllowedRequest(request, [HOST]), false)
  })
})

describe('isAllowedRequest cross-site', () => {
  it('rejects a cross-site browser request even over loopback', () => {
    const request = req('127.0.0.1', { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' })
    assert.equal(isAllowedRequest(request), false)
  })

  it('rejects a cross-site request to a listed host', () => {
    const request = req('100.92.191.33', { host: HOST, origin: `http://${HOST}`, 'sec-fetch-site': 'cross-site' })
    assert.equal(isAllowedRequest(request, [HOST]), false)
  })
})

describe('nextConfigAfterSave', () => {
  it('stores the token and workspace but keeps the host allowlist', () => {
    const next = nextConfigAfterSave({ allowedHosts: [HOST] }, 'secret', 'Work', '🎉')
    assert.equal(next.token, 'secret')
    assert.equal(next.workspaceName, 'Work')
    assert.equal(next.workspaceIcon, '🎉')
    assert.deepEqual(next.allowedHosts, [HOST])
  })
})

describe('nextConfigAfterClear', () => {
  it('drops the token and workspace but keeps the host allowlist', () => {
    const next = nextConfigAfterClear({ token: 'secret', workspaceName: 'Work', workspaceIcon: '🎉', allowedHosts: [HOST] })
    assert.equal(next.token, undefined)
    assert.equal(next.workspaceName, '')
    assert.deepEqual(next.allowedHosts, [HOST])
  })
})
