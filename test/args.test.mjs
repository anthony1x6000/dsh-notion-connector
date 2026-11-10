import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { NotionError, jsonArg } from '../src/notion.ts'

/*
 * `type: 'json'` tool parameters project to an annotation-only schema, so a model may send either the value itself or
 * JSON text. Notion answers a string with "Couldn't find editable properties for these identifiers: 0,1,2,...", so
 * the connector has to parse and check the shape before the request goes out.
 */

describe('jsonArg object', () => {
  it('passes a native object through untouched', () => {
    const value = { Name: { title: [{ text: { content: 'x' } }] } }
    assert.equal(jsonArg(value, 'properties', 'object'), value)
  })

  it('parses JSON text into an object', () => {
    assert.deepEqual(jsonArg('{"Name":{"title":[]}}', 'properties', 'object'), { Name: { title: [] } })
  })

  it('treats blank text as omitted', () => {
    assert.equal(jsonArg('   ', 'properties', 'object'), undefined)
  })

  it('treats undefined and null as omitted', () => {
    assert.equal(jsonArg(undefined, 'properties', 'object'), undefined)
    assert.equal(jsonArg(null, 'properties', 'object'), undefined)
  })

  it('rejects text that is not JSON and names the parameter', () => {
    assert.throws(
      () => jsonArg('{Name: nope}', 'properties', 'object'),
      (error) => {
        assert.ok(error instanceof NotionError)
        assert.match(error.message, /properties/)
        assert.match(error.message, /JSON/)
        return true
      },
    )
  })

  it('rejects an array where Notion wants a property map', () => {
    const value = [{ Name: {} }]
    assert.throws(
      () => jsonArg(value, 'properties', 'object'),
      (error) => error instanceof NotionError && /properties.*object/i.test(error.message),
    )
  })

  it('rejects a scalar', () => {
    assert.throws(
      () => jsonArg('42', 'properties', 'object'),
      (error) => error instanceof NotionError && /properties.*object/i.test(error.message),
    )
  })
})

describe('jsonArg array', () => {
  it('parses a JSON array of blocks', () => {
    const blocks = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }]
    assert.deepEqual(jsonArg(JSON.stringify(blocks), 'children', 'array'), blocks)
  })

  it('passes a native array through', () => {
    const blocks = [{ object: 'block', type: 'divider', divider: {} }]
    assert.equal(jsonArg(blocks, 'children', 'array'), blocks)
  })

  it('rejects an object where Notion wants an array', () => {
    const single = { object: 'block', type: 'divider', divider: {} }
    assert.throws(
      () => jsonArg(single, 'children', 'array'),
      (error) => error instanceof NotionError && /children.*array/i.test(error.message),
    )
  })

  it('names the parameter when the text is not JSON', () => {
    assert.throws(
      () => jsonArg('[{,}]', 'children', 'array'),
      (error) => error instanceof NotionError && /children/.test(error.message),
    )
  })
})
