const { it, describe } = require('mocha')
const inmem = require('../src/store/inmemory')
const test = it
const Block = require('@ipld/block')
const assert = require('assert')
const same = assert.deepStrictEqual

const missing = Block.encoder({ test: Math.random() }, 'dag-cbor')

const basics = async create => {
  const store = await create()
  const block = Block.encoder({ hello: 'world' }, 'dag-cbor')
  await store.put(block)
  const first = await block.cid()
  const second = await store.get(first)
  if (!first.equals(await second.cid())) {
    throw new Error('Store is not retaining blocks')
  }
  try {
    await store.get(await missing.cid())
  } catch (e) {
    if (e.status === 404) {
      return
    } else {
      throw new Error('Storage error is missing status code')
    }
  }
  throw new Error('store.get() must throw when missing block')
}

const b = obj => Block.encoder(obj, 'dag-cbor')

const hello = () => b({ hello: 'world' })

const commonLink = async () => {
  const leaf = await hello()
  const link = await leaf.cid()
  const branch1 = b({ one: link })
  const branch2 = b({ two: link })
  const root = b({ one: await branch1.cid(), two: await branch2.cid() })
  return [root, branch1, branch2, leaf]
}

const fixtures = {
  commonLink
}

const graph = async create => {
  describe('graph', () => {
    test('no links', async () => {
      const store = await create()
      const block = hello()
      const cid = await block.cid()
      await store.put(block)
      const { complete } = await store.graph(cid)
      assert.ok(complete)
    })
    test('common links', async () => {
      const store = await create()
      const blocks = await fixtures.commonLink()
      await Promise.all(blocks.map(b => store.put(b)))
      const [root] = blocks
      const { complete, missing, incomplete } = await store.graph(await root.cid())
      assert.ok(complete)
      assert.ok(!missing)
      assert.ok(!incomplete)
    })
    test('missing branch', async () => {
      const store = await create()
      const blocks = await fixtures.commonLink()
      const [missed] = blocks.splice(1, 1)
      await Promise.all(blocks.map(b => store.put(b)))
      const [root] = blocks
      const { complete, missing, incomplete } = await store.graph(await root.cid())
      assert.ok(!complete)
      assert.ok(!incomplete)
      same(missing.size, 1)
      const _missing = (await missed.cid()).toString('base64')
      assert.ok(missing.has(_missing))
    })
  })
}

describe('inmem', () => {
  test('basic inmem', async () => {
    await basics(inmem)
  })
  graph(inmem)
  // replicate(test, inmem)
})
