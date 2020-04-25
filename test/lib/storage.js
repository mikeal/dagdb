/* globals it */
const replicate = require('../../src/stores/replicate')
const test = it
const Block = require('@ipld/block')
const assert = require('assert')
const same = assert.deepStrictEqual

const b = obj => Block.encoder(obj, 'dag-cbor')

const hello = () => b({ hello: 'world' })

const missingBlock = Block.encoder({ test: Math.random() }, 'dag-cbor')

const basics = async create => {
  const store = await create({ lru: false })
  const block = Block.encoder({ hello: 'world' }, 'dag-cbor')
  await store.put(block)
  assert.ok(await store.has(await block.cid()))
  same(await store.has(await missingBlock.cid()), false)
  const first = await block.cid()
  const second = await store.get(first)
  if (!first.equals(await second.cid())) {
    throw new Error('Store is not retaining blocks')
  }
  try {
    await store.get(await missingBlock.cid())
  } catch (e) {
    if (e.statusCode === 404) {
      return
    } else {
      throw new Error('Storage error is missing status code')
    }
  }
  throw new Error('store.get() must throw when missing block')
}

let commonLeaf = async () => {
  const leaf = await hello()
  const link = await leaf.cid()
  const branch1 = b({ one: link })
  const branch2 = b({ two: link })
  const root = b({ one: await branch1.cid(), two: await branch2.cid() })
  return [root, branch1, branch2, leaf]
}
commonLeaf = commonLeaf()

let commonBranches = async () => {
  const leaf = await hello()
  const link = await leaf.cid()
  const branch1 = b({ one: link })
  const branch2 = b({ two: link, three: await branch1.cid() })
  const root = b({ one: await branch1.cid(), two: await branch2.cid(), three: await branch1.cid() })
  return [root, branch1, branch2, leaf]
}
commonBranches = commonBranches()

let rawCommonLeaf = async () => {
  const leaf = await Block.encoder(Buffer.from('test'), 'raw')
  const link = await leaf.cid()
  const branch1 = b({ one: link })
  const branch2 = b({ two: link })
  const root = b({ one: await branch1.cid(), two: await branch2.cid() })
  return [root, branch1, branch2, leaf]
}
rawCommonLeaf = rawCommonLeaf()

const fixtures = {
  commonLeaf: async () => [...await commonLeaf],
  commonBranches: async () => [...await commonBranches],
  rawCommonLeaf: async () => [...await rawCommonLeaf]
}

const graphTests = async (create, fn) => {
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
    assert.ok(missing.has(cid.toString('base32')))
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
        const _missing = (await missed.cid()).toString('base32')
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
        const _missing = (await missed.cid()).toString('base32')
        assert.ok(missing.has(_missing))
      })
      if (!reverse) addTests(true)
    }
    addTests()
  }
  testSmallGraph('commonLeaf')
  testSmallGraph('commonBranches')
  testSmallGraph('rawCommonLeaf')
  const load = async blocks => {
    const store = create()
    await Promise.all(blocks.map(b => store.put(b)))
    for (const block of blocks) {
      await store.graph(await block.cid())
    }
    return store
  }
  test('depth 0', async () => {
    const blocks = await fixtures.commonBranches()
    const root = await blocks[0].cid()
    const store = await load(blocks)
    const { complete, missing, incomplete } = await store.graph(root, 0)
    assert.ok(complete && !missing && !incomplete)
  })
  test('depth 1', async () => {
    const blocks = await fixtures.commonBranches()
    const root = await blocks[0].cid()
    const store = await load(blocks)
    const { complete, missing, incomplete } = await store.graph(root, 1)
    assert.ok(complete && !missing && !incomplete)
  })
  test('depth 0, missing root', async () => {
    const blocks = await fixtures.commonBranches()
    const root = blocks.shift()
    const store = await load(blocks)
    const { complete, missing, incomplete } = await store.graph(await root.cid(), 1)
    assert.ok(!complete && missing && !incomplete)
    same(missing.size, 1)
    assert.ok(missing.has((await root.cid()).toString('base32')))
  })
  test('depth 1, missing root', async () => {
    const blocks = await fixtures.commonBranches()
    const root = blocks.shift()
    const store = await load(blocks)
    const { complete, missing, incomplete } = await store.graph(await root.cid(), 1)
    assert.ok(!complete && missing && !incomplete)
    same(missing.size, 1)
    assert.ok(missing.has((await root.cid()).toString('base32')))
  })
  test('depth 0, missing branch', async () => {
    const blocks = await fixtures.commonBranches()
    const root = await blocks[0].cid()
    const [branch] = blocks.splice(1, 1)
    const store = await load(blocks)
    const { complete, missing, incomplete } = await store.graph(root, 1)
    assert.ok(!complete && missing && !incomplete)
    same(missing.size, 1)
    assert.ok(missing.has((await branch.cid()).toString('base32')))
  })
  test('depth 1, missing branch', async () => {
    const blocks = await fixtures.commonBranches()
    const root = await blocks[0].cid()
    const [branch] = blocks.splice(1, 1)
    const store = await load(blocks)
    const { complete, missing, incomplete } = await store.graph(root, 1)
    assert.ok(!complete && missing && !incomplete)
    same(missing.size, 1)
    assert.ok(missing.has((await branch.cid()).toString('base32')))
  })
  test('depth 1, missing leaf', async () => {
    const blocks = await fixtures.commonBranches()
    const root = await blocks[0].cid()
    const leaf = blocks.pop()
    const store = await load(blocks)
    const { complete, missing, incomplete } = await store.graph(root, 1)
    assert.ok(!complete && missing && incomplete)
    same(missing.size, 1)
    same(incomplete.size, 1)
    assert.ok(missing.has((await leaf.cid()).toString('base32')))
    assert.ok(incomplete.has((await blocks[1].cid()).toString('base32')))
  })
  test('depth 1, missing leaf', async () => {
    const blocks = await fixtures.commonBranches()
    const root = await blocks[0].cid()
    const leaf = blocks.pop()
    const store = await load(blocks)
    const { complete, missing, incomplete } = await store.graph(root, 1)
    assert.ok(!complete && missing && incomplete)
    same(missing.size, 1)
    same(incomplete.size, 1)
    assert.ok(missing.has((await leaf.cid()).toString('base32')))
    assert.ok(incomplete.has((await blocks[1].cid()).toString('base32')))
  })
}

const replicateTests = create => {
  graphTests(create, (store, ...args) => {
    const empty = create()
    const cid = args.shift()
    return replicate(cid, store, empty, ...args)
  })
  const basicTest = async (fromBlocks, toBlocks, ...args) => {
    const _from = await create()
    const _to = await create()
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
    const _all = (blocks, store) => Promise.all([...blocks].reverse().map(b => b.cid().then(cid => store.graph(cid))))
    await Promise.all([_all(fromBlocks, _from), _all(toBlocks, _to)])
    const { complete, missing, incomplete } = await replicate(root, _from, _to, ...args)
    const stores = [_from, _to]
    return { complete, missing, incomplete, root, count, puts, stores }
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
    test(`missing leaf, depth -1${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const leaf = _to.pop()
      const cid = await leaf.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count } = await basicTest(_from, _to, -1, ...args)
      same(count, 0)
      assert.ok(!complete && !missing && incomplete)
      same(incomplete.size, 1)
    })
    test(`missing leaf, depth 0${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const leaf = _to.pop()
      const cid = await leaf.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count } = await basicTest(_from, _to, 0, ...args)
      same(count, 0)
      assert.ok(!complete && !missing && incomplete)
      same(incomplete.size, 2)
    })
    test(`missing leaf, depth 1${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const leaf = _to.pop()
      const cid = await leaf.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 1, ...args)
      assert.ok(complete && !missing && !incomplete)
      same(count, skip ? 0 : 1)
      if (!skip) assert.ok(puts[0].equals(cid))
    })
    test(`missing leaf, depth 2${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const leaf = _to.pop()
      const cid = await leaf.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 2, ...args)
      assert.ok(complete && !missing && !incomplete)
      same(count, skip ? 0 : 1)
      if (!skip) assert.ok(puts[0].equals(cid))
    })
    test(`missing branch, depth -1${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const [branch] = _to.splice(1, 1)
      const cid = await branch.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count } = await basicTest(_from, _to, -1, ...args)
      assert.ok(!complete && !missing && incomplete)
      same(count, 0)
      same(incomplete.size, 1)
    })
    test(`missing branch, depth 0${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const [branch] = _to.splice(1, 1)
      const cid = await branch.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 0, ...args)
      if (skip) {
        assert.ok(complete && !missing && !incomplete)
        return
      }
      assert.ok(!complete && !missing && incomplete)
      same(count, skip ? 0 : 1)
      if (!skip) assert.ok(puts[0].equals(cid))
      same(incomplete.size, 1)
    })
    test(`missing branch, depth 1${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const [branch] = _to.splice(1, 1)
      const cid = await branch.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 1, ...args)
      assert.ok(complete && !missing && !incomplete)
      same(count, skip ? 0 : 1)
      if (!skip) assert.ok(puts[0].equals(await branch.cid()))
    })
    test(`missing branch, depth 2${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const [branch] = _to.splice(1, 1)
      const cid = await branch.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 2, ...args)
      assert.ok(complete && !missing && !incomplete)
      same(count, skip ? 0 : 1)
      if (!skip) assert.ok(puts[0].equals(cid))
    })
    test(`missing root, depth -1${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const root = _to.shift()
      const cid = await root.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count } = await basicTest(_from, _to, -1, ...args)
      assert.ok(!complete && missing && !incomplete)
      same(count, 0)
      same(missing.size, 1)
    })
    test(`missing root, depth 0${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const root = _to.shift()
      const cid = await root.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 0, ...args)
      // This one has two valid responses.
      // Depending on how lazy the indexing is there are two
      // completely valid response, one is that it has the
      // complete graph or that the root is incomplete because
      // it needs a deeper traversal to update the cache.
      if (complete) {
        assert.ok(complete && !missing && !incomplete)
        return
      }
      assert.ok(!complete && !missing && incomplete)
      same(count, skip ? 0 : 1)
      if (!skip) assert.ok(puts[0].equals(cid))
    })
    test(`missing root, depth 1${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const root = _to.shift()
      const cid = await root.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete } = await basicTest(_from, _to, 1, ...args)
      // this is a little counter-intuitive but nonetheless correct.
      // if you skip the root block and ask for its graph, it will
      // always return that the traversal is complete because you literally
      // asked for nothing.
      assert.ok(complete && !missing && !incomplete)
    })
    test(`missing root, depth 2${s}`, async () => {
      const _to = await fixtures.rawCommonLeaf()
      const _from = await fixtures.rawCommonLeaf()
      const root = _to.shift()
      const cid = await root.cid()
      const key = cid.toString('base32')
      const args = skip ? [1, new Set([key])] : []
      const { complete, missing, incomplete, count, puts } = await basicTest(_from, _to, 2, ...args)
      if (skip) {
        // see note above ^^
        assert.ok(complete && !missing && !incomplete)
        return
      }
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
    assert.ok(!complete && !missing && incomplete)
    same(count, 1)
    same(incomplete.size, 1)
    assert.ok(incomplete.has((await blocks[0].cid()).toString('base32')))
  })
  test('depth 1', async () => {
    const blocks = await fixtures.commonBranches()
    const { complete, missing, incomplete, count } = await basicTest(blocks, [], 1)
    assert.ok(!complete && !missing && incomplete)
    same(count, 3)
    same(incomplete.size, 2)
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
    assert.ok(!complete && !missing && incomplete)
    same(count, 0)
    same(incomplete.size, 2)
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
    assert.ok(!complete && !missing && incomplete)
    same(count, 0)
    same(incomplete.size, 1)
  })
  test('propogate storage error', async () => {
    const _from = await create()
    const _to = await create()
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
}

exports.fixtures = fixtures
exports.graphTests = graphTests
exports.replicateTests = replicateTests
exports.hello = hello
exports.basics = basics
