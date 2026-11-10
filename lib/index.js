// src/notion.ts
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var NOTION_API = "https://api.notion.com";
var NOTION_VERSION = "2022-06-28";
var CONFIG_PATH = join(homedir(), ".dsh", "notion.json");
function readConfig() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeConfig(config) {
  mkdirSync(join(homedir(), ".dsh"), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 384 });
  chmodSync(CONFIG_PATH, 384);
}
var NotionError = class extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "NotionError";
  }
};
function jsonArg(value, name2, kind) {
  if (value === void 0 || value === null) return void 0;
  let parsed = value;
  if (typeof value === "string") {
    const text2 = value.trim();
    if (text2 === "") return void 0;
    try {
      parsed = JSON.parse(text2);
    } catch {
      throw new NotionError(
        `${name2} is not valid JSON. Send the native Notion structure, for example {"Name":{"title":[{"text":{"content":"Title"}}]}}.`
      );
    }
  }
  if (kind === "array") {
    if (!Array.isArray(parsed)) {
      throw new NotionError(`${name2} must be a JSON array of Notion block objects, not ${describeValue(parsed)}.`);
    }
    return parsed;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new NotionError(
      `${name2} must be a JSON object mapping property names to Notion property values, not ${describeValue(parsed)}.`
    );
  }
  return parsed;
}
function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}
async function notionRequest(token, method, path, body, signal) {
  const response = await fetch(NOTION_API + path, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  const text2 = await response.text();
  let data = null;
  if (text2 !== "") {
    try {
      data = JSON.parse(text2);
    } catch {
      data = { raw: text2 };
    }
  }
  if (!response.ok) {
    const message = data !== null && typeof data.message === "string" ? data.message : `HTTP ${response.status}`;
    const code = data !== null && typeof data.code === "string" ? data.code : void 0;
    throw new NotionError(message, response.status, code);
  }
  return data;
}
async function notionCall(method, path, body, signal) {
  const token = (readConfig().token ?? "").trim();
  if (token === "") {
    throw new NotionError(
      "Notion is not configured yet: paste an Integration Token in Settings -> Notion (create one at https://www.notion.so/my-integrations)."
    );
  }
  return notionRequest(token, method, path, body, signal);
}
function friendlyNotionError(error) {
  if (error instanceof NotionError) {
    const message = error.message || "unknown error";
    switch (error.status) {
      case 401:
        return `Notion token is invalid or was revoked (401): ${message}`;
      case 404:
        return `Notion resource not found (404): ${message}. Check that the page or database is shared with this integration and that the id is correct.`;
      case 400:
        return `Notion rejected the request parameters (400 ${error.code ?? ""}): ${message}`;
      case 409:
        return `Notion conflict (409): ${message}`;
      case 429:
        return `Notion rate limit reached (429): ${message}`;
      default:
        return `Notion API error [${error.status ?? "?"}]: ${message}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
var MAX_CHILDREN = 100;
var BLOCK_CAP = 200;
function normalizeId(raw) {
  let s = String(raw ?? "").trim();
  if (s.includes("/")) {
    s = (s.split("/").pop() ?? "").split("?")[0].split("#")[0];
  }
  const match = /([0-9a-fA-F]{32})$/.exec(s.replace(/-/g, ""));
  if (match === null) return s;
  const id = match[1];
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
function plainText(rich) {
  if (!Array.isArray(rich)) return "";
  let out = "";
  for (const r of rich) {
    if (r !== null && typeof r === "object" && typeof r.plain_text === "string") {
      out += r.plain_text;
    }
  }
  return out;
}
function propValue(p) {
  if (p === null || p === void 0) return null;
  switch (p.type) {
    case "title":
      return plainText(p.title);
    case "rich_text":
      return plainText(p.rich_text);
    case "number":
      return p.number;
    case "select":
      return p.select ? p.select.name : null;
    case "status":
      return p.status ? p.status.name : null;
    case "multi_select":
      return (p.multi_select ?? []).map((s) => s.name);
    case "date":
      return p.date ? p.date.start + (p.date.end ? ` \u2192 ${p.date.end}` : "") : null;
    case "checkbox":
      return p.checkbox;
    case "url":
      return p.url;
    case "email":
      return p.email;
    case "phone_number":
      return p.phone_number;
    case "people":
      return (p.people ?? []).map((u) => u.name ?? u.id);
    case "relation":
      return (p.relation ?? []).map((r) => r.id);
    case "formula":
      return p.formula ? p.formula[p.formula.type] : null;
    case "rollup":
      return p.rollup ? p.rollup.type === "number" ? p.rollup.number : (p.rollup.array ?? []).map(propValue) : null;
    case "created_by":
      return p.created_by ? p.created_by.name : null;
    case "last_edited_by":
      return p.last_edited_by ? p.last_edited_by.name : null;
    case "created_time":
      return p.created_time;
    case "last_edited_time":
      return p.last_edited_time;
    default:
      return JSON.stringify(p);
  }
}
function simplifyProperties(props) {
  const out = {};
  if (props !== null && typeof props === "object") {
    for (const key of Object.keys(props)) out[key] = propValue(props[key]);
  }
  return out;
}
function trimSearchResult(r) {
  let title = "";
  if (r.object === "database") title = plainText(r.title);
  else if (r.properties !== null && r.properties !== void 0 && r.properties.title !== void 0) {
    title = plainText(r.properties.title.title);
  }
  return {
    id: r.id,
    type: r.object,
    title: title || r.id,
    url: r.url ?? null,
    edited: r.last_edited_time ?? null,
    databaseId: (r.parent && r.parent.database_id) ?? null
  };
}
function blockText(b) {
  const t = b.type;
  if (t === "child_page") return b.child_page ? b.child_page.title : "";
  if (t === "child_database") return b.child_database ? b.child_database.title : "";
  if (t === "divider") return "---";
  if (t === "table_row") return (b.table_row.cells ?? []).map((c) => plainText(c)).join(" | ");
  if (t === "equation") return b.equation ? b.equation.expression : "";
  if (t === "synced_block") return "";
  const inner = b[t];
  if (inner !== null && inner !== void 0 && Array.isArray(inner.rich_text)) return plainText(inner.rich_text);
  if (inner !== null && inner !== void 0 && typeof inner.url === "string") {
    const caption = plainText(inner.caption ?? []);
    return inner.url + (caption.length > 0 ? ` ${caption}` : "");
  }
  return "";
}
var NESTED_TYPES = {
  toggle: true,
  bulleted_list_item: true,
  numbered_list_item: true,
  quote: true,
  callout: true,
  paragraph: true,
  synced_block: true,
  template: true,
  table: true
};
function blockLinks(b) {
  const inner = b[b.type];
  const rich = Array.isArray(inner?.rich_text) ? inner.rich_text : [];
  return rich.map((r) => r?.href).filter((href) => typeof href === "string");
}
async function fetchBlocksRecursive(blockId, depth, cap, call = notionCall) {
  const out = [];
  let cursor = null;
  let truncated = false;
  for (; ; ) {
    let path = `/v1/blocks/${encodeURIComponent(normalizeId(blockId))}/children?page_size=100`;
    if (cursor !== null) path += `&start_cursor=${encodeURIComponent(cursor)}`;
    const res = await call("GET", path);
    const list = res.results ?? [];
    for (const b of list) {
      if (out.length >= cap) return { items: out, truncated: true };
      const item = { id: b.id, type: b.type, text: blockText(b) };
      const links = blockLinks(b);
      if (links.length > 0) item.links = links;
      if (depth > 0 && b.has_children === true && NESTED_TYPES[b.type] === true) {
        try {
          const kids = await fetchBlocksRecursive(b.id, depth - 1, cap - out.length, call);
          if (kids.items.length > 0) item.children = kids.items;
          if (kids.truncated) truncated = true;
        } catch (error) {
          item.childrenError = friendlyNotionError(error);
        }
      }
      out.push(item);
    }
    if (res.has_more !== true || typeof res.next_cursor !== "string") return { items: out, truncated };
    cursor = res.next_cursor;
  }
}
async function readPage(pageIdRaw, includeChildren, depth, call = notionCall) {
  const pageId = normalizeId(pageIdRaw);
  const page = await call("GET", `/v1/pages/${encodeURIComponent(pageId)}`);
  const titleProp = Object.values(page.properties ?? {}).find((p) => p?.type === "title");
  const result = {
    id: page.id,
    url: page.url ?? null,
    title: titleProp ? plainText(titleProp.title) : "",
    properties: simplifyProperties(page.properties)
  };
  if (includeChildren) {
    const { items, truncated } = await fetchBlocksRecursive(pageId, depth, BLOCK_CAP, call);
    result.blocks = items;
    if (truncated) result.truncated = true;
  }
  return { ok: true, page: result };
}
async function createPage(parent, properties, children, call = notionCall) {
  const body = {
    parent: parent.type === "database" ? { database_id: normalizeId(parent.id) } : { page_id: normalizeId(parent.id) },
    properties: properties ?? {}
  };
  const head = children.slice(0, MAX_CHILDREN);
  if (head.length > 0) body.children = head;
  const res = await call("POST", "/v1/pages", body);
  const rest = children.slice(MAX_CHILDREN);
  if (rest.length > 0) await appendBlocks(res.id, rest, void 0, call);
  return { ok: true, id: res.id, url: res.url };
}
async function appendBlocks(blockId, children, after, call = notionCall) {
  const inserted = [];
  for (let i = 0; i < children.length; i += MAX_CHILDREN) {
    const batch = children.slice(i, i + MAX_CHILDREN);
    const body = { children: batch };
    if (i === 0 && after !== void 0) body.after = normalizeId(after);
    const res = await call("PATCH", `/v1/blocks/${encodeURIComponent(normalizeId(blockId))}/children`, body);
    for (const b of (res.results ?? []).slice(0, batch.length)) inserted.push(b.id);
  }
  return { ok: true, inserted };
}
async function queryDatabase(args, signal) {
  const body = { page_size: Math.min(Math.max(args.pageSize ?? 20, 1), 100) };
  if (args.filter !== void 0) body.filter = args.filter;
  if (args.sorts !== void 0) body.sorts = args.sorts;
  if (args.startCursor !== void 0) body.start_cursor = args.startCursor;
  const res = await notionCall(
    "POST",
    `/v1/databases/${encodeURIComponent(normalizeId(args.databaseId))}/query`,
    body,
    signal
  );
  return {
    ok: true,
    count: (res.results ?? []).length,
    hasMore: res.has_more === true,
    nextCursor: res.has_more === true ? res.next_cursor : null,
    results: (res.results ?? []).map((r) => ({
      id: r.id,
      url: r.url ?? null,
      properties: simplifyProperties(r.properties)
    }))
  };
}

// src/routes.ts
var NOTION_API_PREFIX = "/api/dsh-notion";
var MAX_JSON_BODY_BYTES = 64 * 1024;
var LOOPBACK_ADDRESSES = /* @__PURE__ */ new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
var LOOPBACK_HOSTNAMES = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "[::1]"]);
function isAllowedRequest(request, allowedHosts = []) {
  const host = request.headers.host;
  if (typeof host !== "string" || host === "") return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const rawOrigin = request.headers.origin;
  const origin = typeof rawOrigin === "string" ? rawOrigin : void 0;
  if (origin !== void 0) {
    try {
      if (new URL(origin).host !== hostUrl.host) return false;
    } catch {
      return false;
    }
  }
  if (LOOPBACK_ADDRESSES.has(request.remoteAddress ?? "") && LOOPBACK_HOSTNAMES.has(hostUrl.hostname)) {
    return true;
  }
  return allowedHosts.includes(hostUrl.host) && origin !== void 0;
}
function nextConfigAfterSave(current, token, workspaceName, workspaceIcon) {
  return { ...current, token, workspaceName, workspaceIcon };
}
function nextConfigAfterClear(current) {
  const next = { ...current, workspaceName: "", workspaceIcon: "" };
  delete next.token;
  return next;
}
function writeJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BODY_BYTES) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    request.on("error", reject);
  });
}
function fenceRequest(request) {
  return { remoteAddress: request.socket.remoteAddress, headers: request.headers };
}
var FORBIDDEN = {
  error: "forbidden: settings are loopback-only. Add this Host to allowedHosts in ~/.dsh/notion.json to use the settings page from it."
};
function makeRoutes() {
  return [
    {
      kind: "exact",
      path: `${NOTION_API_PREFIX}/status`,
      handler: async (req, res) => {
        const cfg = readConfig();
        if (req.method !== "GET" || !isAllowedRequest(fenceRequest(req), cfg.allowedHosts)) {
          writeJson(res, 403, FORBIDDEN);
          return;
        }
        writeJson(res, 200, {
          configured: (cfg.token ?? "").trim() !== "",
          workspaceName: cfg.workspaceName ?? "",
          workspaceIcon: cfg.workspaceIcon ?? ""
        });
      }
    },
    {
      kind: "exact",
      path: `${NOTION_API_PREFIX}/token`,
      handler: async (req, res) => {
        const cfg = readConfig();
        if (req.method !== "POST" || !isAllowedRequest(fenceRequest(req), cfg.allowedHosts)) {
          writeJson(res, 403, FORBIDDEN);
          return;
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          writeJson(res, 400, { ok: false, error: "invalid request body" });
          return;
        }
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (token === "") {
          writeJson(res, 400, { ok: false, error: "token must not be empty" });
          return;
        }
        try {
          const me = await notionRequest(token, "GET", "/v1/users/me");
          const bot = me !== null && typeof me === "object" && me.bot || {};
          const workspaceName = typeof bot.workspace_name === "string" ? bot.workspace_name : "";
          let icon = "";
          if (bot.workspace_icon !== null && bot.workspace_icon !== void 0) {
            icon = String(bot.workspace_icon.emoji ?? bot.workspace_icon.file?.url ?? "");
          }
          writeConfig(nextConfigAfterSave(cfg, token, workspaceName, icon));
          writeJson(res, 200, { ok: true, workspaceName, workspaceIcon: icon });
        } catch (error) {
          writeJson(res, 200, { ok: false, error: friendlyNotionError(error) });
        }
      }
    },
    {
      kind: "exact",
      path: `${NOTION_API_PREFIX}/clear`,
      handler: async (req, res) => {
        const cfg = readConfig();
        if (req.method !== "POST" || !isAllowedRequest(fenceRequest(req), cfg.allowedHosts)) {
          writeJson(res, 403, FORBIDDEN);
          return;
        }
        writeConfig(nextConfigAfterClear(cfg));
        writeJson(res, 200, { ok: true });
      }
    }
  ];
}

// src/tools.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
function text(value) {
  return [{ type: "text", text: value }];
}
function renderJson(_args, value) {
  return text(JSON.stringify(value, null, 2));
}
function notionSearchTool() {
  return defineTool({
    name: "notion_search",
    description: "Search pages and databases in the configured Notion workspace. Returns each result id, type, title, URL and last-edited time.Triggers: Notion, search Notion, find in Notion.",
    parameters: {
      query: { type: "string", description: "Search keywords; omit to list what the workspace changed most recently" },
      objectType: { type: "string", enum: ["page", "database"], description: "Return only this kind of object" },
      limit: { type: "integer", description: "Maximum results, default 10, max 50" }
    },
    output: { schema: { type: "json" }, render: renderJson },
    timeoutMs: 6e4,
    async execute(args) {
      const body = { page_size: Math.min(Math.max(args.limit ?? 10, 1), 50) };
      if (args.query !== void 0 && args.query !== "") body.query = args.query;
      if (args.objectType !== void 0) body.filter = { value: args.objectType, property: "object" };
      const res = await notionCall("POST", "/v1/search", body);
      return {
        ok: true,
        count: (res.results ?? []).length,
        hasMore: res.has_more === true,
        results: (res.results ?? []).map(trimSearchResult)
      };
    }
  });
}
function notionReadPageTool() {
  return defineTool({
    name: "notion_read_page",
    description: "Read a Notion page title, properties and content blocks. pageId accepts a page id (like 8ab3e1c2-xxxx-...) or a full page URL.Triggers: read Notion page, view Notion content.",
    parameters: {
      pageId: { type: "string", required: true, description: "Page id or full page URL" },
      includeChildren: { type: "boolean", description: "Also read the content blocks (default true)" },
      depth: { type: "integer", description: "Nested block recursion depth, default 2, max 3" }
    },
    output: { schema: { type: "json" }, render: renderJson },
    timeoutMs: 6e4,
    async execute(args) {
      const depth = args.depth === void 0 ? 2 : Math.min(Math.max(args.depth, 0), 3);
      return readPage(String(args.pageId), args.includeChildren !== false, depth);
    }
  });
}
function notionQueryDatabaseTool() {
  return defineTool({
    name: "notion_query_database",
    description: "Query entries in a Notion database. filter and sorts use the native Notion structures (see https://developers.notion.com/reference/post-database-query).Triggers: query Notion database, database entries.",
    parameters: {
      databaseId: { type: "string", required: true, description: "Database id or URL" },
      filter: { type: "json", description: 'Filter (native Notion filter object, e.g. {"property":"Status","select":{"equals":"In progress"}})' },
      sorts: { type: "json", description: "Sort array (native Notion sorts)" },
      pageSize: { type: "integer", description: "Entries per page, default 20, max 100" },
      startCursor: { type: "string", description: "Paging cursor (nextCursor from the previous result)" }
    },
    output: { schema: { type: "json" }, render: renderJson },
    timeoutMs: 6e4,
    async execute(args) {
      return queryDatabase({
        ...args,
        filter: jsonArg(args.filter, "filter", "object"),
        sorts: jsonArg(args.sorts, "sorts", "array")
      });
    }
  });
}
function notionCreatePageTool() {
  return defineTool({
    name: "notion_create_page",
    description: "Create a page in Notion. properties and children use the native Notion structures (see https://developers.notion.com/reference/post-page).Triggers: create Notion page, write to Notion, save to Notion.",
    parameters: {
      parentType: { type: "string", enum: ["page", "database"], required: true, description: "Parent object type" },
      parentId: { type: "string", required: true, description: "Parent page or database id / URL" },
      properties: { type: "json", description: 'Page properties, e.g. {"Name": {"title": [{"text": {"content": "Title"}}]}}' },
      children: { type: "json", description: "Content block array (native Notion block objects)" }
    },
    output: { schema: { type: "json" }, render: renderJson },
    timeoutMs: 6e4,
    async execute(args) {
      return createPage(
        { type: args.parentType, id: args.parentId },
        jsonArg(args.properties, "properties", "object") ?? {},
        jsonArg(args.children, "children", "array") ?? []
      );
    }
  });
}
function notionUpdatePageTool() {
  return defineTool({
    name: "notion_update_page",
    description: "Update a Notion page properties or archive state. properties use the native Notion structure.Triggers: update Notion page, change Notion properties.",
    parameters: {
      pageId: { type: "string", required: true, description: "Page id / URL" },
      properties: { type: "json", description: "Properties to update (native Notion structure)" },
      archived: { type: "boolean", description: "true archives the page, false restores it" }
    },
    output: { schema: { type: "json" }, render: renderJson },
    timeoutMs: 6e4,
    async execute(args) {
      const body = {};
      const properties = jsonArg(args.properties, "properties", "object");
      if (properties !== void 0) body.properties = properties;
      if (typeof args.archived === "boolean") body.archived = args.archived;
      if (Object.keys(body).length === 0) throw new Error("provide properties or archived");
      const res = await notionCall("PATCH", `/v1/pages/${normalizeId(args.pageId)}`, body);
      return { ok: true, id: res.id, url: res.url, archived: res.archived === true };
    }
  });
}
function notionAppendBlocksTool() {
  return defineTool({
    name: "notion_append_blocks",
    description: "Append content blocks to a Notion page or block. children is an array of native Notion block objects.Triggers: append Notion content, add content to a Notion page.",
    parameters: {
      blockId: { type: "string", required: true, description: "Target page/block id or URL" },
      children: { type: "json", required: true, description: "Blocks to append (native Notion structure)" },
      after: { type: "string", description: "Insert after this block" }
    },
    output: { schema: { type: "json" }, render: renderJson },
    timeoutMs: 6e4,
    async execute(args) {
      const children = jsonArg(args.children, "children", "array") ?? [];
      if (children.length === 0) throw new NotionError("children must contain at least one block.");
      return appendBlocks(args.blockId, children, args.after);
    }
  });
}
function notionTools() {
  return [
    notionSearchTool(),
    notionReadPageTool(),
    notionQueryDatabaseTool(),
    notionCreatePageTool(),
    notionUpdatePageTool(),
    notionAppendBlocksTool()
  ];
}

// src/index.ts
var name = "notion";
var inject = ["webServer", "tools", "systemPrompt"];
var SECTION_ORDER = 150;
var NOTION_GUIDANCE = 'This machine has the dsh-notion plugin installed (Notion connector): once an Integration Token is configured you can use notion_search to search pages/databases, notion_read_page to read page content, notion_query_database to query database entries, notion_create_page to create pages, notion_update_page to change properties/archive, and notion_append_blocks to append content blocks. The token lives in ~/.dsh/notion.json (mode 0600) and is configured under Settings -> Notion in the GUI; pages and databases must first be shared with that integration. When the user says "Notion", "knowledge base" or "notes", they mean this plugin; collaborate accordingly.';
function apply(ctx) {
  ctx.effect(
    () => {
      const disposers = notionTools().map((tool) => ctx.tools.register(tool));
      return () => {
        for (const dispose of disposers) dispose();
      };
    },
    "dsh-notion: tools"
  );
  ctx.effect(
    () => {
      const disposers = makeRoutes().map((route) => ctx.webServer.register(route));
      return () => {
        for (const dispose of disposers) dispose();
      };
    },
    "dsh-notion: routes"
  );
  ctx.effect(
    () => ctx.systemPrompt.section({ name: "plugin:dsh-notion", order: SECTION_ORDER, text: NOTION_GUIDANCE }),
    "dsh-notion: announcement"
  );
}
export {
  NOTION_GUIDANCE,
  apply,
  inject,
  name
};
