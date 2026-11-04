/**
 * The /api/dsh-notion route family: connection status, token save (validates
 * against /v1/users/me before persisting), and token clear. Every route
 * carries a trust fence because these endpoints write credentials. Loopback is
 * always allowed; another host must be listed in allowedHosts, so reaching the
 * GUI over a LAN or tailnet address is an explicit operator decision.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { NotionConfig } from './notion.ts'
import { friendlyNotionError, notionRequest, readConfig, writeConfig } from './notion.ts'

/** Route prefix of the Notion settings API. */
export const NOTION_API_PREFIX = '/api/dsh-notion'

/** Cap on JSON request bodies (token payloads are tiny). */
const MAX_JSON_BODY_BYTES = 64 * 1024

/** TCP peers that mean "this machine". */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** Host header values that mean "this machine". */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** The request facts the fence inspects (kept small so it is easy to test). */
export interface FenceRequest {
  remoteAddress?: string
  headers: Record<string, string | string[] | undefined>
}

/**
 * Whether a request may touch the credential routes. Cross-site requests are
 * always refused. Loopback passes. Any other host passes only when the
 * operator listed it and a browser sent a matching Origin, so a page on some
 * other site cannot rewrite the token.
 */
export function isAllowedRequest(request: FenceRequest, allowedHosts: string[] = []): boolean {
  const host = request.headers.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const rawOrigin = request.headers.origin
  const origin = typeof rawOrigin === 'string' ? rawOrigin : undefined
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== hostUrl.host) return false
    } catch {
      return false
    }
  }
  if (LOOPBACK_ADDRESSES.has(request.remoteAddress ?? '') && LOOPBACK_HOSTNAMES.has(hostUrl.hostname)) {
    return true
  }
  return allowedHosts.includes(hostUrl.host) && origin !== undefined
}

/** Config after a successful token save; the allowlist survives. */
export function nextConfigAfterSave(
  current: NotionConfig,
  token: string,
  workspaceName: string,
  workspaceIcon: string,
): NotionConfig {
  return { ...current, token, workspaceName, workspaceIcon }
}

/** Config after a token clear; the allowlist survives so settings stay reachable. */
export function nextConfigAfterClear(current: NotionConfig): NotionConfig {
  const next: NotionConfig = { ...current, workspaceName: '', workspaceIcon: '' }
  delete next.token
  return next
}

/** Write one JSON response. */
function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

/** Read and parse a bounded JSON request body. */
function readJsonBody(request: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_JSON_BODY_BYTES) {
        reject(new Error('body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    request.on('error', reject)
  })
}

/** The fence input for one incoming request. */
function fenceRequest(request: IncomingMessage): FenceRequest {
  return { remoteAddress: request.socket.remoteAddress, headers: request.headers }
}

/** 403 body that says how to opt a host in. */
const FORBIDDEN = {
  error: 'forbidden: settings are loopback-only. Add this Host to allowedHosts in ~/.dsh/notion.json to use the settings page from it.',
}

/** The Notion settings route family. */
export function makeRoutes(): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: `${NOTION_API_PREFIX}/status`,
      handler: async (req, res) => {
        const cfg = readConfig()
        if (req.method !== 'GET' || !isAllowedRequest(fenceRequest(req), cfg.allowedHosts)) {
          writeJson(res, 403, FORBIDDEN)
          return
        }
        writeJson(res, 200, {
          configured: (cfg.token ?? '').trim() !== '',
          workspaceName: cfg.workspaceName ?? '',
          workspaceIcon: cfg.workspaceIcon ?? '',
        })
      },
    },
    {
      kind: 'exact',
      path: `${NOTION_API_PREFIX}/token`,
      handler: async (req, res) => {
        const cfg = readConfig()
        if (req.method !== 'POST' || !isAllowedRequest(fenceRequest(req), cfg.allowedHosts)) {
          writeJson(res, 403, FORBIDDEN)
          return
        }
        let body: any
        try {
          body = await readJsonBody(req)
        } catch {
          writeJson(res, 400, { ok: false, error: 'invalid request body' })
          return
        }
        const token = typeof body.token === 'string' ? body.token.trim() : ''
        if (token === '') {
          writeJson(res, 400, { ok: false, error: 'token must not be empty' })
          return
        }
        try {
          // Validate before persisting, and capture the workspace identity.
          const me = await notionRequest(token, 'GET', '/v1/users/me')
          const bot = (me !== null && typeof me === 'object' && me.bot) || {}
          const workspaceName = typeof bot.workspace_name === 'string' ? bot.workspace_name : ''
          let icon = ''
          if (bot.workspace_icon !== null && bot.workspace_icon !== undefined) {
            icon = String(bot.workspace_icon.emoji ?? bot.workspace_icon.file?.url ?? '')
          }
          writeConfig(nextConfigAfterSave(cfg, token, workspaceName, icon))
          writeJson(res, 200, { ok: true, workspaceName, workspaceIcon: icon })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: friendlyNotionError(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${NOTION_API_PREFIX}/clear`,
      handler: async (req, res) => {
        const cfg = readConfig()
        if (req.method !== 'POST' || !isAllowedRequest(fenceRequest(req), cfg.allowedHosts)) {
          writeJson(res, 403, FORBIDDEN)
          return
        }
        writeConfig(nextConfigAfterClear(cfg))
        writeJson(res, 200, { ok: true })
      },
    },
  ]
}
