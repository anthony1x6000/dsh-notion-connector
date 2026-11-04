/**
 * Agent tools for dsh-notion: search, read page, query database, create /
 * update pages, append blocks. Every tool talks to the same Notion REST API
 * and config store the settings page manages, so a token saved in the GUI is
 * immediately usable by any agent (and vice versa).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  appendBlocks,
  createPage,
  friendlyNotionError,
  notionCall,
  normalizeId,
  queryDatabase,
  readPage,
  simplifyProperties,
  trimSearchResult,
} from './notion.ts'

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** JSON render shared by every tool output. */
function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return text(JSON.stringify(value, null, 2))
}

/**
 * Accept a JSON value or its stringified form. The harness delivers
 * `type: 'json'` parameters as strings, which the Notion API rejects when
 * forwarded verbatim (it wants real arrays/objects).
 */
function asJson<T>(value: unknown): T | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return value as T
  const trimmed = value.trim()
  return trimmed === '' ? undefined : (JSON.parse(trimmed) as T)
}

/** The workspace search tool. */
export function notionSearchTool() {
  return defineTool({
    name: 'notion_search',
    description: 'Search pages and databases in the configured Notion workspace. Returns each result id, type, title, URL and last-edited time.' +
      'Triggers: Notion, search Notion, find in Notion.',
    parameters: {
      query: { type: 'string', description: 'Search keywords; omit to list what the workspace changed most recently' },
      objectType: { type: 'string', enum: ['page', 'database'], description: 'Return only this kind of object' },
      limit: { type: 'integer', description: 'Maximum results, default 10, max 50' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 60_000,
    async execute(args) {
      const body: any = { page_size: Math.min(Math.max(args.limit ?? 10, 1), 50) }
      if (args.query !== undefined && args.query !== '') body.query = args.query
      if (args.objectType !== undefined) body.filter = { value: args.objectType, property: 'object' }
      const res = await notionCall('POST', '/v1/search', body)
      return {
        ok: true,
        count: (res.results ?? []).length,
        hasMore: res.has_more === true,
        results: (res.results ?? []).map(trimSearchResult),
      }
    },
  })
}

/** The page reader tool. */
export function notionReadPageTool() {
  return defineTool({
    name: 'notion_read_page',
    description: 'Read a Notion page title, properties and content blocks. pageId accepts a page id (like 8ab3e1c2-xxxx-...) or a full page URL.' +
      'Triggers: read Notion page, view Notion content.',
    parameters: {
      pageId: { type: 'string', required: true, description: 'Page id or full page URL' },
      includeChildren: { type: 'boolean', description: 'Also read the content blocks (default true)' },
      depth: { type: 'integer', description: 'Nested block recursion depth, default 2, max 3' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 60_000,
    async execute(args) {
      const depth = args.depth === undefined ? 2 : Math.min(Math.max(args.depth, 0), 3)
      return readPage(String(args.pageId), args.includeChildren !== false, depth)
    },
  })
}

/** The database query tool. */
export function notionQueryDatabaseTool() {
  return defineTool({
    name: 'notion_query_database',
    description: 'Query entries in a Notion database. filter and sorts use the native Notion structures (see https://developers.notion.com/reference/post-database-query).' +
      'Triggers: query Notion database, database entries.',
    parameters: {
      databaseId: { type: 'string', required: true, description: 'Database id or URL' },
      filter: { type: 'json', description: 'Filter (native Notion filter object, e.g. {"property":"Status","select":{"equals":"In progress"}})' },
      sorts: { type: 'json', description: 'Sort array (native Notion sorts)' },
      pageSize: { type: 'integer', description: 'Entries per page, default 20, max 100' },
      startCursor: { type: 'string', description: 'Paging cursor (nextCursor from the previous result)' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 60_000,
    async execute(args) {
      return queryDatabase({ ...args, filter: asJson(args.filter), sorts: asJson(args.sorts) })
    },
  })
}

/** The page creation tool. */
export function notionCreatePageTool() {
  return defineTool({
    name: 'notion_create_page',
    description: 'Create a page in Notion. properties and children use the native Notion structures (see https://developers.notion.com/reference/post-page).' +
      'Triggers: create Notion page, write to Notion, save to Notion.',
    parameters: {
      parentType: { type: 'string', enum: ['page', 'database'], required: true, description: 'Parent object type' },
      parentId: { type: 'string', required: true, description: 'Parent page or database id / URL' },
      properties: { type: 'json', description: 'Page properties, e.g. {"Name": {"title": [{"text": {"content": "Title"}}]}}' },
      children: { type: 'json', description: 'Content block array (native Notion block objects)' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 60_000,
    async execute(args) {
      return createPage(
        { type: args.parentType, id: args.parentId },
        asJson(args.properties) ?? {},
        asJson<any[]>(args.children) ?? [],
      )
    },
  })
}

/** The page update tool. */
export function notionUpdatePageTool() {
  return defineTool({
    name: 'notion_update_page',
    description: 'Update a Notion page properties or archive state. properties use the native Notion structure.' +
      'Triggers: update Notion page, change Notion properties.',
    parameters: {
      pageId: { type: 'string', required: true, description: 'Page id / URL' },
      properties: { type: 'json', description: 'Properties to update (native Notion structure)' },
      archived: { type: 'boolean', description: 'true archives the page, false restores it' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 60_000,
    async execute(args) {
      const body: any = {}
      const properties = asJson(args.properties)
      if (properties !== undefined) body.properties = properties
      if (typeof args.archived === 'boolean') body.archived = args.archived
      if (Object.keys(body).length === 0) throw new Error('provide properties or archived')
      const res = await notionCall('PATCH', `/v1/pages/${normalizeId(args.pageId)}`, body)
      return { ok: true, id: res.id, url: res.url, archived: res.archived === true }
    },
  })
}

/** The block appender tool. */
export function notionAppendBlocksTool() {
  return defineTool({
    name: 'notion_append_blocks',
    description: 'Append content blocks to a Notion page or block. children is an array of native Notion block objects.' +
      'Triggers: append Notion content, add content to a Notion page.',
    parameters: {
      blockId: { type: 'string', required: true, description: 'Target page/block id or URL' },
      children: { type: 'json', required: true, description: 'Blocks to append (native Notion structure)' },
      after: { type: 'string', description: 'Insert after this block' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 60_000,
    async execute(args) {
      return appendBlocks(args.blockId, asJson<any[]>(args.children) ?? [], args.after)
    },
  })
}

/** All six tools, ready for ctx.tools.register. */
export function notionTools() {
  return [
    notionSearchTool(),
    notionReadPageTool(),
    notionQueryDatabaseTool(),
    notionCreatePageTool(),
    notionUpdatePageTool(),
    notionAppendBlocksTool(),
  ]
}

/** Re-export the friendly error mapping so routes reuse the same wording. */
export { friendlyNotionError, simplifyProperties }
