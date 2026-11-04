import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  appendBlocks,
  blockText,
  createPage,
  normalizeId,
  plainText,
  readPage,
} from '../src/notion.ts'

/** Fake API client that records every call and answers from `handler`. */
function fakeCall(handler) {
  const calls = []
  const call = async (method, path, body) => {
    calls.push({ method, path, body })
    return handler(method, path, body)
  }
  call.calls = calls
  return call
}

/** A page whose only children are `count` paragraphs, paginated 100 at a time. */
function childrenHandler(count, { hasMoreBeyond = false } = {}) {
  return (method, path) => {
    if (method !== 'GET') throw new Error(`unexpected ${method} ${path}`)
    if (!path.includes('/children')) return pageResponse({ title: { type: 'title', title: [text('Doc')] } })
    const cursor = Number(new URL(path, 'https://x').searchParams.get('start_cursor') ?? 0)
    const end = Math.min(cursor + 100, count)
    const results = []
    for (let i = cursor; i < end; i += 1) results.push({ id: `b${i}`, type: 'paragraph', paragraph: rt(`p${i}`) })
    const more = end < count || (hasMoreBeyond && end === count)
    return { results, has_more: more, next_cursor: more ? String(end) : null }
  }
}

/** A Notion rich_text entry. */
function text(content, extra = {}) {
  return { plain_text: content, ...extra }
}

/** A paragraph's rich_text container. */
function rt(content) {
  return { rich_text: [text(content)] }
}

/** Minimal page object as the API returns it. */
function pageResponse(properties, id = 'page-1') {
  return { id, url: `https://notion.so/${id}`, properties }
}

describe('normalizeId', () => {
  it('accepts a bare 32-hex id', () => {
    assert.equal(normalizeId('40de97e18ebf810bbd24cc66cecd2d44'), '40de97e1-8ebf-810b-bd24-cc66cecd2d44')
  })

  it('accepts a dashed uuid', () => {
    assert.equal(normalizeId('40de97e1-8ebf-810b-bd24-cc66cecd2d44'), '40de97e1-8ebf-810b-bd24-cc66cecd2d44')
  })

  it('extracts the id from a Notion slug URL, which ends with the raw id', () => {
    const url = 'https://app.notion.com/p/Dev-log-40de97e18ebf810bbd24cc66cecd2d44'
    assert.equal(normalizeId(url), '40de97e1-8ebf-810b-bd24-cc66cecd2d44')
  })

  it('extracts the id from a slug URL with a query string', () => {
    const url = 'https://app.notion.com/p/Dev-log-40de97e18ebf810bbd24cc66cecd2d44?pvs=4'
    assert.equal(normalizeId(url), '40de97e1-8ebf-810b-bd24-cc66cecd2d44')
  })

  it('extracts the database id from a database URL with a view query', () => {
    const url = 'https://www.notion.so/ws/40de97e18ebf810bbd24cc66cecd2d44?v=1234abcd5678abcd1234abcd5678abcd'
    assert.equal(normalizeId(url), '40de97e1-8ebf-810b-bd24-cc66cecd2d44')
  })

  it('passes unrecognised input through unchanged', () => {
    assert.equal(normalizeId('not-an-id'), 'not-an-id')
  })
})

describe('blockText', () => {
  it('returns the plain text of a paragraph', () => {
    assert.equal(blockText({ type: 'paragraph', paragraph: rt('hello') }), 'hello')
  })

  it('returns the divider marker', () => {
    assert.equal(blockText({ type: 'divider', divider: {} }), '---')
  })

  it('returns the child page title', () => {
    assert.equal(blockText({ type: 'child_page', child_page: { title: 'Sub' } }), 'Sub')
  })
})

describe('blockText links', () => {
  it('keeps the text of a link', () => {
    const block = {
      type: 'paragraph',
      paragraph: { rich_text: [{ plain_text: 'docs', href: 'https://example.com/docs' }] },
    }
    assert.equal(blockText(block), 'docs')
  })
})

describe('plainText', () => {
  it('joins rich text segments', () => {
    assert.equal(plainText([text('a'), text('b')]), 'ab')
  })

  it('returns empty string for a non-array', () => {
    assert.equal(plainText(undefined), '')
  })
})

describe('readPage title', () => {
  it('reads the title of a page-child page', async () => {
    const call = fakeCall(() => pageResponse({ title: { type: 'title', title: [text('Dev log')] } }))
    const read = await readPage('page-1', false, 0, call)
    assert.equal(read.page.title, 'Dev log')
  })

  it('reads the title of a database row, whose title property has an arbitrary name', async () => {
    const call = fakeCall(() =>
      pageResponse({
        Name: { type: 'title', title: [text('Row title')] },
        Status: { type: 'select', select: { name: 'Done' } },
      }),
    )
    const read = await readPage('page-1', false, 0, call)
    assert.equal(read.page.title, 'Row title')
    assert.equal(read.page.properties.Status, 'Done')
  })
})

describe('readPage truncation', () => {
  it('reads every block up to the cap and stops there', async () => {
    const read = await readPage('page-1', true, 0, fakeCall(childrenHandler(250)))
    assert.equal(read.page.blocks.length, 200)
  })

  it('flags a page longer than the block cap', async () => {
    const read = await readPage('page-1', true, 0, fakeCall(childrenHandler(250)))
    assert.equal(read.page.truncated, true)
  })

  it('does not flag a page that fits exactly in the cap', async () => {
    const read = await readPage('page-1', true, 0, fakeCall(childrenHandler(200)))
    assert.equal(read.page.blocks.length, 200)
    assert.notEqual(read.page.truncated, true)
  })

  it('does not flag a short page', async () => {
    const read = await readPage('page-1', true, 0, fakeCall(childrenHandler(3)))
    assert.equal(read.page.blocks.length, 3)
    assert.notEqual(read.page.truncated, true)
  })
})

describe('appendBlocks', () => {
  it('sends one request when the children fit in the API limit', async () => {
    const call = fakeCall((method, path, body) => ({ results: body.children.map((b, i) => ({ id: `new${i}` })) }))
    const res = await appendBlocks('page-1', [{ object: 'block', type: 'divider', divider: {} }], undefined, call)
    assert.equal(call.calls.length, 1)
    assert.equal(call.calls[0].body.children.length, 1)
    assert.deepEqual(res.inserted, ['new0'])
  })

  it('batches children into requests of at most 100', async () => {
    const children = Array.from({ length: 250 }, () => ({ object: 'block', type: 'divider', divider: {} }))
    const call = fakeCall((method, path, body) => ({ results: body.children.map((b, i) => ({ id: `n${i}` })) }))
    await appendBlocks('page-1', children, undefined, call)
    assert.deepEqual(
      call.calls.map((c) => c.body.children.length),
      [100, 100, 50],
    )
  })

  it('applies `after` only to the first batch so later batches stay in order', async () => {
    const children = Array.from({ length: 150 }, () => ({ object: 'block', type: 'divider', divider: {} }))
    const call = fakeCall((method, path, body) => ({ results: body.children.map((b, i) => ({ id: `n${i}` })) }))
    const anchor = '40de97e1-8ebf-810b-bd24-cc66cecd2d44'
    await appendBlocks('page-1', children, anchor, call)
    assert.equal(call.calls[0].body.after, anchor)
    assert.equal(call.calls[1].body.after, undefined)
  })

  it('returns only the created block ids, ignoring the sibling Notion echoes back', async () => {
    const children = Array.from({ length: 2 }, () => ({ object: 'block', type: 'divider', divider: {} }))
    const call = fakeCall(() => ({ results: [{ id: 'new-1' }, { id: 'new-2' }, { id: 'sibling' }] }))
    const res = await appendBlocks('page-1', children, 'anchor-id', call)
    assert.deepEqual(res.inserted, ['new-1', 'new-2'])
  })
})

describe('createPage', () => {
  it('creates a page with no children', async () => {
    const call = fakeCall(() => ({ id: 'page-9', url: 'https://notion.so/page-9' }))
    const res = await createPage({ type: 'page', id: 'parent' }, {}, [], call)
    assert.equal(res.id, 'page-9')
    assert.equal(call.calls.length, 1)
    assert.equal(call.calls[0].body.children, undefined)
  })

  it('creates the page with the first 100 children and appends the rest', async () => {
    const children = Array.from({ length: 150 }, () => ({ object: 'block', type: 'divider', divider: {} }))
    const call = fakeCall((method, path, body) => {
      if (method === 'POST') return { id: 'page-9', url: 'https://notion.so/page-9' }
      return { results: body.children.map((b, i) => ({ id: `n${i}` })) }
    })
    await createPage({ type: 'page', id: 'parent' }, {}, children, call)
    assert.equal(call.calls.length, 2)
    assert.equal(call.calls[0].method, 'POST')
    assert.equal(call.calls[0].body.children.length, 100)
    assert.equal(call.calls[1].method, 'PATCH')
    assert.match(call.calls[1].path, /page-9/)
    assert.equal(call.calls[1].body.children.length, 50)
  })
})
