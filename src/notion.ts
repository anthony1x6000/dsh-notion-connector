/**
 * Notion REST client + response trimmers for the dsh-notion plugin.
 *
 * Token storage: ~/.dsh/notion.json (0600), same convention as dsh-ssh's
 * host store. All API calls go through the Node 22+ global fetch — no shell,
 * no curl. Errors are normalized into NotionError with the API status/code so
 * callers can render friendly, actionable Chinese messages.
 */

import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Notion REST base URL. */
export const NOTION_API = 'https://api.notion.com'
/** API version header value (2022-06-28 covers every endpoint used here). */
export const NOTION_VERSION = '2022-06-28'
/** Token/config file path. */
export const CONFIG_PATH = join(homedir(), '.dsh', 'notion.json')

/** Persisted configuration. */
export interface NotionConfig {
  /** Internal Integration Secret (never returned to the client or model). */
  token?: string
  /** Workspace name from /v1/users/me, captured at save time. */
  workspaceName?: string
  /** Workspace icon (emoji or file URL), captured at save time. */
  workspaceIcon?: string
  /**
   * Extra Host header values allowed to reach the credential routes beyond
   * loopback, e.g. a tailnet address the GUI is served on.
   */
  allowedHosts?: string[]
}

/** Read the config file; any read/parse failure yields an empty config. */
export function readConfig(): NotionConfig {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? (parsed as NotionConfig) : {}
  } catch {
    return {}
  }
}

/** Persist the config file (0600, parent dir created). */
export function writeConfig(config: NotionConfig): void {
  mkdirSync(join(homedir(), '.dsh'), { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
  chmodSync(CONFIG_PATH, 0o600)
}

/** Remove the config file (idempotent). */
export function clearConfig(): void {
  rmSync(CONFIG_PATH, { force: true })
}

/** Normalized Notion API error carrying the HTTP status and API code. */
export class NotionError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message)
    this.name = 'NotionError'
  }
}

/**
 * One raw Notion REST call with an explicit token (used by the settings
 * save flow before the token is persisted).
 */
export async function notionRequest(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<any> {
  const response = await fetch(NOTION_API + path, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data: any = null
  if (text !== '') {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }
  if (!response.ok) {
    const message = data !== null && typeof data.message === 'string' ? data.message : `HTTP ${response.status}`
    const code = data !== null && typeof data.code === 'string' ? data.code : undefined
    throw new NotionError(message, response.status, code)
  }
  return data
}

/** Read the stored token and call the API; friendly error when unconfigured. */
export async function notionCall(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<any> {
  const token = (readConfig().token ?? '').trim()
  if (token === '') {
    throw new NotionError(
      'Notion is not configured yet: paste an Integration Token in Settings -> Notion (create one at https://www.notion.so/my-integrations).',
    )
  }
  return notionRequest(token, method, path, body, signal)
}

/** Map an error to a friendly, actionable message. */
export function friendlyNotionError(error: unknown): string {
  if (error instanceof NotionError) {
    const message = error.message || 'unknown error'
    switch (error.status) {
      case 401:
        return `Notion token is invalid or was revoked (401): ${message}`
      case 404:
        return `Notion resource not found (404): ${message}. Check that the page or database is shared with this integration and that the id is correct.`
      case 400:
        return `Notion rejected the request parameters (400 ${error.code ?? ''}): ${message}`
      case 409:
        return `Notion conflict (409): ${message}`
      case 429:
        return `Notion rate limit reached (429): ${message}`
      default:
        return `Notion API error [${error.status ?? '?'}]: ${message}`
    }
  }
  return error instanceof Error ? error.message : String(error)
}

/** Notion caps children per write request at 100. */
export const MAX_CHILDREN = 100

/** How many blocks a page read returns before it stops. */
export const BLOCK_CAP = 200

/** Runs one Notion REST call; injectable so tests never touch the network. */
export type NotionCaller = (method: string, path: string, body?: unknown) => Promise<any>

/**
 * Accept a page id, a dashed UUID, or a full page URL; normalize to dashed UUID
 * form. Notion page URLs end with the bare id after a title slug, so the
 * trailing 32-hex run identifies the page.
 */
export function normalizeId(raw: string): string {
  let s = String(raw ?? '').trim()
  if (s.includes('/')) {
    s = (s.split('/').pop() ?? '').split('?')[0].split('#')[0]
  }
  const match = /([0-9a-fA-F]{32})$/.exec(s.replace(/-/g, ''))
  if (match === null) return s
  const id = match[1]!
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
}

/** Join a rich_text array into plain text. */
export function plainText(rich: unknown): string {
  if (!Array.isArray(rich)) return ''
  let out = ''
  for (const r of rich) {
    if (r !== null && typeof r === 'object' && typeof (r as any).plain_text === 'string') {
      out += (r as any).plain_text
    }
  }
  return out
}

/** Simplify one property value to a scalar the model can read. */
export function propValue(p: any): unknown {
  if (p === null || p === undefined) return null
  switch (p.type) {
    case 'title': return plainText(p.title)
    case 'rich_text': return plainText(p.rich_text)
    case 'number': return p.number
    case 'select': return p.select ? p.select.name : null
    case 'status': return p.status ? p.status.name : null
    case 'multi_select': return (p.multi_select ?? []).map((s: any) => s.name)
    case 'date': return p.date ? (p.date.start + (p.date.end ? ` → ${p.date.end}` : '')) : null
    case 'checkbox': return p.checkbox
    case 'url': return p.url
    case 'email': return p.email
    case 'phone_number': return p.phone_number
    case 'people': return (p.people ?? []).map((u: any) => u.name ?? u.id)
    case 'relation': return (p.relation ?? []).map((r: any) => r.id)
    case 'formula': return p.formula ? p.formula[p.formula.type] : null
    case 'rollup': return p.rollup
      ? (p.rollup.type === 'number' ? p.rollup.number : (p.rollup.array ?? []).map(propValue))
      : null
    case 'created_by': return p.created_by ? p.created_by.name : null
    case 'last_edited_by': return p.last_edited_by ? p.last_edited_by.name : null
    case 'created_time': return p.created_time
    case 'last_edited_time': return p.last_edited_time
    default: return JSON.stringify(p)
  }
}

/** Render a page/database property map as plain key → simplified value. */
export function simplifyProperties(props: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (props !== null && typeof props === 'object') {
    for (const key of Object.keys(props)) out[key] = propValue(props[key])
  }
  return out
}

/** Compact one /v1/search result. */
export function trimSearchResult(r: any): Record<string, unknown> {
  let title = ''
  if (r.object === 'database') title = plainText(r.title)
  else if (r.properties !== null && r.properties !== undefined && r.properties.title !== undefined) {
    title = plainText(r.properties.title.title)
  }
  return {
    id: r.id,
    type: r.object,
    title: title || r.id,
    url: r.url ?? null,
    edited: r.last_edited_time ?? null,
    databaseId: (r.parent && r.parent.database_id) ?? null,
  }
}

/** Extract the plain text of one block. */
export function blockText(b: any): string {
  const t = b.type
  if (t === 'child_page') return b.child_page ? b.child_page.title : ''
  if (t === 'child_database') return b.child_database ? b.child_database.title : ''
  if (t === 'divider') return '---'
  if (t === 'table_row') return (b.table_row.cells ?? []).map((c: any) => plainText(c)).join(' | ')
  if (t === 'equation') return b.equation ? b.equation.expression : ''
  if (t === 'synced_block') return ''
  const inner = b[t]
  if (inner !== null && inner !== undefined && Array.isArray(inner.rich_text)) return plainText(inner.rich_text)
  if (inner !== null && inner !== undefined && typeof inner.url === 'string') {
    const caption = plainText(inner.caption ?? [])
    return inner.url + (caption.length > 0 ? ` ${caption}` : '')
  }
  return ''
}

/** Block types whose children are worth recursing into. */
const NESTED_TYPES: Record<string, true> = {
  toggle: true,
  bulleted_list_item: true,
  numbered_list_item: true,
  quote: true,
  callout: true,
  paragraph: true,
  synced_block: true,
  template: true,
  table: true,
}

/** hrefs inside a block's rich text; plain text drops them. */
export function blockLinks(b: any): string[] {
  const inner = b[b.type]
  const rich = Array.isArray(inner?.rich_text) ? inner.rich_text : []
  return rich.map((r: any) => r?.href).filter((href: unknown): href is string => typeof href === 'string')
}

/** Fetch a block's children recursively (paginated, bounded by `cap`). */
export async function fetchBlocksRecursive(
  blockId: string,
  depth: number,
  cap: number,
  call: NotionCaller = notionCall,
): Promise<{ items: any[]; truncated: boolean }> {
  const out: any[] = []
  let cursor: string | null = null
  let truncated = false
  for (;;) {
    let path = `/v1/blocks/${encodeURIComponent(normalizeId(blockId))}/children?page_size=100`
    if (cursor !== null) path += `&start_cursor=${encodeURIComponent(cursor)}`
    const res = await call('GET', path)
    const list: any[] = res.results ?? []
    for (const b of list) {
      if (out.length >= cap) return { items: out, truncated: true }
      const item: any = { id: b.id, type: b.type, text: blockText(b) }
      const links = blockLinks(b)
      if (links.length > 0) item.links = links
      if (depth > 0 && b.has_children === true && NESTED_TYPES[b.type] === true) {
        try {
          const kids = await fetchBlocksRecursive(b.id, depth - 1, cap - out.length, call)
          if (kids.items.length > 0) item.children = kids.items
          if (kids.truncated) truncated = true
        } catch (error) {
          item.childrenError = friendlyNotionError(error)
        }
      }
      out.push(item)
    }
    if (res.has_more !== true || typeof res.next_cursor !== 'string') return { items: out, truncated }
    cursor = res.next_cursor
  }
}

/** Read one page: metadata + simplified properties + (optional) content blocks. */
export async function readPage(
  pageIdRaw: string,
  includeChildren: boolean,
  depth: number,
  call: NotionCaller = notionCall,
): Promise<any> {
  const pageId = normalizeId(pageIdRaw)
  const page = await call('GET', `/v1/pages/${encodeURIComponent(pageId)}`)
  // A page-parented page names its title property "title"; a database row can
  // name it anything, so find the property by type instead of by key.
  const titleProp = Object.values(page.properties ?? {}).find((p: any) => p?.type === 'title')
  const result: any = {
    id: page.id,
    url: page.url ?? null,
    title: titleProp ? plainText((titleProp as any).title) : '',
    properties: simplifyProperties(page.properties),
  }
  if (includeChildren) {
    const { items, truncated } = await fetchBlocksRecursive(pageId, depth, BLOCK_CAP, call)
    result.blocks = items
    if (truncated) result.truncated = true
  }
  return { ok: true, page: result }
}

/** Create a page, appending any children beyond the API limit afterwards. */
export async function createPage(
  parent: { type: string; id: string },
  properties: unknown,
  children: any[],
  call: NotionCaller = notionCall,
): Promise<any> {
  const body: any = {
    parent: parent.type === 'database'
      ? { database_id: normalizeId(parent.id) }
      : { page_id: normalizeId(parent.id) },
    properties: properties ?? {},
  }
  const head = children.slice(0, MAX_CHILDREN)
  if (head.length > 0) body.children = head
  const res = await call('POST', '/v1/pages', body)
  const rest = children.slice(MAX_CHILDREN)
  if (rest.length > 0) await appendBlocks(res.id, rest, undefined, call)
  return { ok: true, id: res.id, url: res.url }
}

/** Append blocks in API-sized batches; order is preserved across batches. */
export async function appendBlocks(
  blockId: string,
  children: any[],
  after: string | undefined,
  call: NotionCaller = notionCall,
): Promise<any> {
  const inserted: string[] = []
  for (let i = 0; i < children.length; i += MAX_CHILDREN) {
    const batch = children.slice(i, i + MAX_CHILDREN)
    const body: any = { children: batch }
    // `after` only positions the first batch; later batches continue at the end.
    if (i === 0 && after !== undefined) body.after = normalizeId(after)
    const res = await call('PATCH', `/v1/blocks/${encodeURIComponent(normalizeId(blockId))}/children`, body)
    // With `after`, Notion echoes the trailing sibling after the created blocks.
    for (const b of (res.results ?? []).slice(0, batch.length)) inserted.push(b.id)
  }
  return { ok: true, inserted }
}

/** Query a database with an optional native filter/sorts, paginated. */
export async function queryDatabase(args: any, signal?: AbortSignal): Promise<any> {
  const body: any = { page_size: Math.min(Math.max(args.pageSize ?? 20, 1), 100) }
  if (args.filter !== undefined) body.filter = args.filter
  if (args.sorts !== undefined) body.sorts = args.sorts
  if (args.startCursor !== undefined) body.start_cursor = args.startCursor
  const res = await notionCall(
    'POST',
    `/v1/databases/${encodeURIComponent(normalizeId(args.databaseId))}/query`,
    body,
    signal,
  )
  return {
    ok: true,
    count: (res.results ?? []).length,
    hasMore: res.has_more === true,
    nextCursor: res.has_more === true ? res.next_cursor : null,
    results: (res.results ?? []).map((r: any) => ({
      id: r.id,
      url: r.url ?? null,
      properties: simplifyProperties(r.properties),
    })),
  }
}
