import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { NotionError, notionBlocks } from '../src/notion.ts'

/*
 * A block object is `{object:'block', type:'heading_2', heading_2:{...}}`. Models hand-write those structures and get
 * the envelope wrong: no `object`, a `type` that does not match its payload key, or a non-object entry. The connector
 * normalizes the missing `object` and refuses the rest by name, instead of forwarding it to Notion for a 400.
 */

const heading = { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'x' } }] } }

describe('notionBlocks', () => {
  it('passes a well formed block through untouched', () => {
    const out = notionBlocks([heading], 'children')
    assert.deepEqual(out, [heading])
  })

  it('adds object:block when a model leaves it out', () => {
    const out = notionBlocks([{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [] } }], 'children')
    assert.deepEqual(out, [{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [] } }])
  })

  it('infers the type when only the payload key is present', () => {
    const out = notionBlocks([{ paragraph: { rich_text: [] } }], 'children')
    assert.deepEqual(out, [{ paragraph: { rich_text: [] }, object: 'block', type: 'paragraph' }])
  })

  it('refuses a type that does not match its payload', () => {
    assert.throws(
      () => notionBlocks([{ object: 'block', type: 'heading_2', paragraph: { rich_text: [] } }], 'children'),
      (error) => {
        assert.ok(error instanceof NotionError)
        assert.match(error.message, /children\[0\]/)
        assert.match(error.message, /heading_2/)
        return true
      },
    )
  })

  it('refuses a block with a payload but no type', () => {
    assert.throws(() => notionBlocks([{ object: 'block', rich_text: [] }], 'children'), NotionError)
  })

  it('refuses a non-object entry and names the index', () => {
    assert.throws(
      () => notionBlocks([heading, 'heading_2'], 'children'),
      (error) => {
        assert.ok(error instanceof NotionError)
        assert.match(error.message, /children\[1\]/)
        return true
      },
    )
  })

  it('refuses an empty block', () => {
    assert.throws(() => notionBlocks([{}], 'children'), NotionError)
  })
})
