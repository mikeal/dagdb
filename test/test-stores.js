/* globals describe, it */
const inmem = require('../src/store/inmemory')
const replicate = require('../src/store/replicate')
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

const graph = async (create, fn) => {
  test('no links', async () => {
    const store = await create()
    const block = hello()
    const cid = await block.cid()
    await store.put(block)
    const { complete, incomplete, missing } = await fn(store, cid)
    assert.ok(complete)
    assert.ok(!incomplete)
    assert.ok(!missing)
  })
  test('missing', async () => {
    const store = await create()
    const block = hello()
    const cid = await block.cid()
    const { complete, missing } = await fn(store, cid)
    assert.ok(!complete)
    assert.ok(missing)
    same(missing.size, 1)
    assert.ok(missing.has(cid.toString('base64')))
  })
  const testSmallGraph = fixtureName => {
    const addTests = (reverse = false) => {
      const r = reverse ? ', reversed' : ''
      const flip = arr => reverse ? [...arr].reverse() : arr
      test(`${fixtureName}${r}`, async () => {
        const store = await create()
        const blocks = await fixtures[fixtureName]()
        await Promise.all(flip(blocks).map(b => store.put(b)))
        const [root] = blocks
        const { complete, missing, incomplete } = await fn(store, await root.cid())
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
        const { complete, missing, incomplete } = await fn(store, await root.cid())
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
        const { complete, missing, incomplete } = await fn(store, await root.cid())
        assert.ok(!complete)
        assert.ok(!incomplete)
        same(missing.size, 1)
        const _missing = (await missed.cid()).toString('base64')
        assert.ok(missing.has(_missing))
      })
      if (!reverse) addTests(true)
    }
    addTests()
  }
  testSmallGraph('commonLeaf')
  testSmallGraph('commonBranches')
  testSmallGraph('rawCommonLeaf')
}

describe('inmem', () => {
  test('basic inmem', async () => {
    await basics(inmem)
  })
  test('store block twice', async () => {
    const store = await inmem()
    const block = b({ hello: 'world' })
    await store.put(block)
    await store.put(block)
    same(store.storage.size, 1)
  })
  describe('store.graph()', () => {
    graph(inmem, (store, ...args) => store.graph(...args))

    test('depth 0', async () => {
      const store = await inmem()
      const blocks = await fixtures.commonBranches()
      const branches = blocks.slice(1, 3)
      await Promise.all(blocks.map(b => store.put(b)))
      const [root] = blocks
      var { complete, missing, incomplete } = await store.graph(await root.cid(), 0)
      assert.ok(!complete)
      assert.ok(!missing)
      assert.ok(incomplete)
      same(incomplete.size, 2)
      for (const block of branches) {
        const cid = await block.cid()
        assert.ok(incomplete.has(cid.toString('base64')))
      }
      // cause a full traversal
      await store.graph(await root.cid())
      // the full traversal should update the competion cache
      const r = await store.graph(await root.cid(), 0)
      assert.ok(r.complete && !r.missing && !r.incomplete)
    })
  })
  describe('replicate', () => {
    graph(inmem, (store, ...args) => {
      const empty = inmem()
      const cid = args.shift()
      return replicate(cid, store, empty, ...args)
    })
    const basicTest = async (fromBlocks, toBlocks, ...args) => {
      const _from = await inmem()
      const _to = await inmem()
      await Promise.all(fromBlocks.map(b => _from.put(b)))
      await Promise.all(toBlocks.map(b => _to.put(b)))
      let count = 0
      const puts = []
      const _put = _to.put.bind(_to)
      _to.put = async block => {
        count++
        puts.push(await block.cid())
        return _put(block)
      }
      const root = await fromBlocks[0].cid()
      await Promise.all([_from.graph(root), _to.graph(root)])
      const { complete, missing, incomplete } = await replicate(root, _from, _to, ...args)
      return { complete, missing, incomplete, root, count, puts }
    }
    test('already complete', async () => {
      const blocks = await fixtures.commonBranches()
      const { complete, missing, incomplete, count } = await basicTest(blocks, blocks)
      assert.ok(complete && !missing && !incomplete)
      same(count, 0)
    })
    test('only missing leaf', async () => {
      const _to = await fixtures.commonBranches()
      const _from = await fixtures.commonBranches()
      const leaf = _to.pop()
      const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to)
      assert.ok(complete && !missing && !incomplete)
      same(count, 1)
      assert.ok(puts[0].equals(await leaf.cid()))
    })
    const depthTests = (skip = false) => {
      const s = skip ? ', skip block' : ''
      test(`missing leaf, depth 0${s}`, async () => {
        const _to = await fixtures.commonBranches()
        const _from = await fixtures.commonBranches()
        const leaf = _to.pop()
        const cid = await leaf.cid()
        const key = cid.toString('base64')
        const args = skip ? [1, new Set([key])] : []
        const { complete, missing, incomplete, count } = await basicTest(_from, _to, 0, ...args)
        same(count, 0)
        if (!skip) {
          assert.ok(!complete && missing && !incomplete)
          assert.ok(missing.has(key))
        } else {
          assert.ok(complete && !missing && !incomplete)
        }
      })
      test(`missing leaf, depth 1${s}`, async () => {
        const _to = await fixtures.commonBranches()
        const _from = await fixtures.commonBranches()
        const leaf = _to.pop()
        const cid = await leaf.cid()
        const key = cid.toString('base64')
        const args = skip ? [1, new Set([key])] : []
        const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 1, ...args)
        assert.ok(complete && !missing && !incomplete)
        same(count, skip ? 0 : 1)
        if (!skip) assert.ok(puts[0].equals(cid))
      })
      test(`missing leaf, depth 2${s}`, async () => {
        const _to = await fixtures.commonBranches()
        const _from = await fixtures.commonBranches()
        const leaf = _to.pop()
        const cid = await leaf.cid()
        const key = cid.toString('base64')
        const args = skip ? [1, new Set([key])] : []
        const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 2, ...args)
        assert.ok(complete && !missing && !incomplete)
        same(count, skip ? 0 : 1)
        if (!skip) assert.ok(puts[0].equals(cid))
      })
      test(`missing branch, depth 0${s}`, async () => {
        const _to = await fixtures.commonBranches()
        const _from = await fixtures.commonBranches()
        const [branch] = _to.splice(1, 1)
        const cid = await branch.cid()
        const key = cid.toString('base64')
        const args = skip ? [1, new Set([key])] : []
        const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 0, ...args)
        assert.ok(complete && !missing && !incomplete)
        same(count, skip ? 0 : 1)
        if (!skip) assert.ok(puts[0].equals(cid))
      })
      test(`missing branch, depth 1${s}`, async () => {
        const _to = await fixtures.commonBranches()
        const _from = await fixtures.commonBranches()
        const [branch] = _to.splice(1, 1)
        const cid = await branch.cid()
        const key = cid.toString('base64')
        const args = skip ? [1, new Set([key])] : []
        const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 1, ...args)
        assert.ok(complete && !missing && !incomplete)
        same(count, skip ? 0 : 1)
        if (!skip) assert.ok(puts[0].equals(await branch.cid()))
      })
      test(`missing branch, depth 2${s}`, async () => {
        const _to = await fixtures.commonBranches()
        const _from = await fixtures.commonBranches()
        const [branch] = _to.splice(1, 1)
        const cid = await branch.cid()
        const key = cid.toString('base64')
        const args = skip ? [1, new Set([key])] : []
        const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 2, ...args)
        assert.ok(complete && !missing && !incomplete)
        same(count, skip ? 0 : 1)
        if (!skip) assert.ok(puts[0].equals(cid))
      })
      test(`missing root, depth 0${s}`, async () => {
        const _to = await fixtures.commonBranches()
        const _from = await fixtures.commonBranches()
        const root = _to.shift()
        const cid = await root.cid()
        const key = cid.toString('base64')
        const args = skip ? [1, new Set([key])] : []
        const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 0, ...args)
        assert.ok(complete && !missing && !incomplete)
        same(count, skip ? 0 : 1)
        if (!skip) assert.ok(puts[0].equals(cid))
      })
      test(`missing root, depth 1${s}`, async () => {
        const _to = await fixtures.commonBranches()
        const _from = await fixtures.commonBranches()
        const root = _to.shift()
        const cid = await root.cid()
        const key = cid.toString('base64')
        const args = skip ? [1, new Set([key])] : []
        const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 1, ...args)
        assert.ok(complete && !missing && !incomplete)
        same(count, skip ? 0 : 1)
        if (!skip) assert.ok(puts[0].equals(cid))
      })
      test(`missing root, depth 2${s}`, async () => {
        const _to = await fixtures.commonBranches()
        const _from = await fixtures.commonBranches()
        const root = _to.shift()
        const cid = await root.cid()
        const key = cid.toString('base64')
        const args = skip ? [1, new Set([key])] : []
        const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 2, ...args)
        assert.ok(complete && !missing && !incomplete)
        same(count, skip ? 0 : 1)
        if (!skip) assert.ok(puts[0].equals(cid))
      })
      if (!skip) depthTests(true)
    }
    depthTests()

    test('depth 0', async () => {
      const blocks = await fixtures.commonBranches()
      const { complete, missing, incomplete, count } = await basicTest(blocks, [], 0)
      assert.ok(!complete && missing && !incomplete)
      same(count, 1)
      same(missing.size, 2)
    })
    test('depth 1', async () => {
      const blocks = await fixtures.commonBranches()
      const { complete, missing, incomplete, count } = await basicTest(blocks, [], 1)
      assert.ok(!complete && missing && !incomplete)
      same(count, 3)
      same(missing.size, 1)
    })
    test('missing leaf', async () => {
      const blocks = await fixtures.commonBranches()
      blocks.pop()
      const { complete, missing, incomplete, count } = await basicTest(blocks, blocks)
      assert.ok(!complete && missing && !incomplete)
      same(count, 0)
      same(missing.size, 1)
    })
    test('depth 0, missing leaf', async () => {
      const blocks = await fixtures.commonBranches()
      blocks.pop()
      const { complete, missing, incomplete, count } = await basicTest(blocks, blocks, 0)
      assert.ok(!complete && missing && !incomplete)
      same(count, 0)
      same(missing.size, 1)
    })
    test('depth 1, missing leaf', async () => {
      const blocks = await fixtures.commonBranches()
      blocks.pop()
      const { complete, missing, incomplete, count } = await basicTest(blocks, blocks, 1)
      assert.ok(!complete && missing && !incomplete)
      same(count, 0)
      same(missing.size, 1)
    })
    test('depth -1, missing leaf', async () => {
      const blocks = await fixtures.commonBranches()
      blocks.pop()
      const { complete, missing, incomplete, count } = await basicTest(blocks, blocks, -1)
      assert.ok(!complete && missing && !incomplete)
      same(count, 0)
      same(missing.size, 1)
    })
    test('propogate storage error', async () => {
      const _from = await inmem()
      const _to = await inmem()
      const blocks = await fixtures.commonBranches()
      const root = blocks.shift()
      const cid = await root.cid()
      _from.get = async cid => {
        throw new Error('test')
      }
      let threw = false
      try {
        await replicate(cid, _from, _to)
      } catch (e) {
        if (e.message !== 'test') throw new Error('Wrong error')
        threw = true
      }
      assert.ok(threw)
    })
  })
})
