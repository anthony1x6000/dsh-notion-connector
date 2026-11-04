/**
 * dsh-notion — host half. Mounts the Notion REST client, the /api/dsh-notion
 * route family (status / save-token / clear-token), the agent tools
 * (notion_search, notion_read_page, notion_query_database, notion_create_page,
 * notion_update_page, notion_append_blocks), and a system-prompt
 * announcement. The browser half (./client) renders the settings page.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { makeRoutes } from './routes.ts'
import { notionTools } from './tools.ts'

/** Stable cordis plugin name. */
export const name = 'notion'

/** Services required before the Notion surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const NOTION_GUIDANCE = 'This machine has the dsh-notion plugin installed (Notion connector): once an Integration Token is configured you can use notion_search to search pages/databases, notion_read_page to read page content, notion_query_database to query database entries, notion_create_page to create pages, notion_update_page to change properties/archive, and notion_append_blocks to append content blocks. The token lives in ~/.dsh/notion.json (mode 0600) and is configured under Settings -> Notion in the GUI; pages and databases must first be shared with that integration. When the user says "Notion", "knowledge base" or "notes", they mean this plugin; collaborate accordingly.'

/** Mount the Notion surfaces. */
export function apply(ctx: Context): void {
  // Agent tools.
  ctx.effect(
    () => {
      const disposers = notionTools().map(tool => ctx.tools.register(tool))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
    'dsh-notion: tools',
  )

  // Settings routes.
  ctx.effect(
    () => {
      const disposers = makeRoutes().map(route => ctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
    'dsh-notion: routes',
  )

  // Announce the plugin to every agent.
  ctx.effect(
    () => ctx.systemPrompt.section({ name: 'plugin:dsh-notion', order: SECTION_ORDER, text: NOTION_GUIDANCE }),
    'dsh-notion: announcement',
  )
}
