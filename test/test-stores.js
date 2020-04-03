/* globals describe, it */
const inmem = require('../src/store/inmemory')
// const replicate = require('../src/store/replicate')
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

const commonLeaf = async () => {
  const leaf = await hello()
  const link = await leaf.cid()
  const branch1 = b({ one: link })
  const branch2 = b({ two: link })
  const root = b({ one: await branch1.cid(), two: await branch2.cid() })
  return [root, branch1, branch2, leaf]
}

const commonBranches = async () => {
  const leaf = await hello()
  const link = await leaf.cid()
  const branch1 = b({ one: link })
  const branch2 = b({ two: link, three: await branch1.cid() })
  const root = b({ one: await branch1.cid(), two: await branch2.cid(), three: await branch1.cid() })
  return [root, branch1, branch2, leaf]
}

const rawCommonLeaf = async () => {
  const leaf = await Block.encoder(Buffer.from('test'), 'raw')
  const link = await leaf.cid()
  const branch1 = b({ one: link })
  const branch2 = b({ two: link })
  const root = b({ one: await branch1.cid(), two: await branch2.cid() })
  return [root, branch1, branch2, leaf]
}

const fixtures = {
  commonLeaf,
  commonBranches,
  rawCommonLeaf
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
    test('missing', async () => {
      const store = await create()
      const block = hello()
      const cid = await block.cid()
      const { complete, missing } = await store.graph(cid)
      assert.ok(!complete)
      assert.ok(missing)
      same(missing.size, 1)
      assert.ok(missing.has(cid.toString('base64')))
    })
    const testSmallGraph = fixtureName => {
      const addTests = (reverse=false) => {
        const r = reverse ? ', reversed' : ''
        const flip = arr => reverse ? [...arr].reverse() : arr
        test(`${fixtureName}${r}`, async () => {
          const store = await create()
          const blocks = await fixtures[fixtureName]()
          await Promise.all(flip(blocks).map(b => store.put(b)))
          const [root] = blocks
          const { complete, missing, incomplete } = await store.graph(await root.cid())
          assert.ok(complete)
          assert.ok(!missing)
          assert.ok(!incomplete)
        })
        test(`${fixtureName}${r}, missing branch`, async () => {
          const store = await create()
          const blocks = await fixtures[fixtureName]()
          const [missed] = blocks.splice(1, 1)
          await Promise.all(flip(blocks).map(b => store.put(b)))
          const [root] = blocks
          const { complete, missing, incomplete } = await store.graph(await root.cid())
          assert.ok(!complete)
          assert.ok(!incomplete)
          same(missing.size, 1)
          const _missing = (await missed.cid()).toString('base64')
          assert.ok(missing.has(_missing))
        })
        test(`${fixtureName}${r}, missing leaf`, async () => {
          const store = await create()
          const blocks = await fixtures[fixtureName]()
          const [missed] = blocks.splice(3, 1)
          await Promise.all(flip(blocks).map(b => store.put(b)))
          const [root] = blocks
          const { complete, missing, incomplete } = await store.graph(await root.cid())
          assert.ok(!complete)
          assert.ok(!incomplete)
          same(missing.size, 1)
          const _missing = (await missed.cid()).toString('base64')
          assert.ok(missing.has(_missing))
        })
        test(`${fixtureName}${r}, depth 0`, async () => {
          const store = await create()
          const blocks = await fixtures[fixtureName]()
          const branches = blocks.slice(1, 3)
          await Promise.all(flip(blocks).map(b => store.put(b)))
          const [root] = blocks
          var { complete, missing, incomplete } = await store.graph(await root.cid(), 0)
          if (!reverse) {
            assert.ok(!complete)
            assert.ok(!missing)
            assert.ok(incomplete)
            same(incomplete.size, 2)
            for (const block of branches) {
              const cid = await block.cid()
              assert.ok(incomplete.has(cid.toString('base64')))
            }
          } else {
            // Since we've never done a full traversal this
            // isn't consistent across graphs and implementations.
            // It could be fully cached already, or it could be partial.
            // Some implementation rely on people asking for this information
            // in order to lazily calculate it and we should support that
          }
          // cause a full traversal
          await store.graph(await root.cid())
          // the full traversal should update the competion cache
          var { complete, missing, incomplete } = await store.graph(await root.cid(), 0)
          assert.ok(complete && !missing && !incomplete)
        })
        if (!reverse) addTests(true)
      }
      addTests()
    }
    testSmallGraph('commonLeaf')
    testSmallGraph('commonBranches')
    testSmallGraph('rawCommonLeaf')
  })
}

describe('inmem', () => {
  test('basic inmem', async () => {
    await basics(inmem)
  })
  test('store block twice', async () => {
    const store = await inmem()
    const block = b({ hello: 'world'})
    await store.put(block)
    await store.put(block)
    same(store.storage.size, 1)
  })
  graph(inmem)
  // replicate(test, inmem)
})
