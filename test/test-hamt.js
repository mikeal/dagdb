/* globals describe, it */
import hamt from '../src/hamt.js'
import Block from '@ipld/block/defaults.js'
import assert from 'assert'

const test = it
const same = assert.deepStrictEqual

const missing = Block.encoder({ test: Math.random() }, 'dag-cbor')

describe('test-hamt', () => {
  test('test store comparison', async () => {
    same(hamt._store.isEqual(await missing.cid(), await missing.cid()), true)
    same(hamt._noop(), undefined)
  })
  test('test has', async () => {
    const empty = hamt.empty(Block)
    let head = await empty.cid()
    const blocks = {}
    blocks[head.toString()] = empty
    const _get = async cid => {
      const block = blocks[cid.toString()]
      if (block) return block
      throw new Error('Not Found')
    }
    const ops = [{ set: { key: 'test', val: true } }]
    for await (const block of hamt.bulk(head, ops, _get, Block)) {
      const cid = await block.cid()
      blocks[cid.toString()] = block
      head = cid
    }
    same(await hamt.has(head, 'test', _get), true)
    same(await hamt.has(head, 'test2', _get), false)
  })
})
