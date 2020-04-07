/* globals describe, it, before, after */
const { fixtures, graphTests, replicateTests } = require('./lib/storage')
const Block = require('@ipld/block')
const assert = require('assert')
const same = assert.deepStrictEqual
const inmem = require('../src/store/inmemory')
const test = it

const missing = Block.encoder({ test: Math.random() }, 'dag-cbor')
const b = obj => Block.encoder(obj, 'dag-cbor')

const basics = async create => {
  const store = await create()
  const block = Block.encoder({ hello: 'world' }, 'dag-cbor')
  await store.put(block)
  assert.ok(await store.has(await block.cid()))
  same(await store.has(await missing.cid()), false)
  const first = await block.cid()
  const second = await store.get(first)
  if (!first.equals(await second.cid())) {
    throw new Error('Store is not retaining blocks')
  }
  try {
    await store.get(await missing.cid())
  } catch (e) {
    if (e.statusCode === 404) {
      return
    } else {
      throw new Error('Storage error is missing status code')
    }
  }
  throw new Error('store.get() must throw when missing block')
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
  describe('graph', () => {
    graphTests(inmem, (store, ...args) => store.graph(...args))

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
        assert.ok(incomplete.has(cid.toString('base32')))
      }
      // cause a full traversal
      await store.graph(await root.cid())
      // the full traversal should update the competion cache
      const r = await store.graph(await root.cid(), 0)
      assert.ok(r.complete && !r.missing && !r.incomplete)
    })
  })
  describe('replicate', () => {
    replicateTests(inmem)
  })
})

if (!process.browser) {
  const getPort = () => Math.floor(Math.random() * (9000 - 8000) + 8000)
  const stores = {}

  const createNodejsHandler = require('../src/http/store/nodejs')

  const handler = async (req, res) => {
    const parsed = new URL('http://asdf' + req.url)
    const id = parsed.searchParams.get('id')
    parsed.searchParams.delete('id')
    const store = stores[id]
    if (!store) throw new Error('Missing store')
    req.url = parsed.toString().slice('http://asdf'.length)
    const _handler = createNodejsHandler(Block, store)
    return _handler(req, res)
  }

  describe('http', () => {
    const port = getPort()
    const server = require('http').createServer(handler)
    const closed = new Promise(resolve => server.once('close', resolve))
    before(() => new Promise((resolve, reject) => {
      server.listen(port, e => {
        if (e) return reject(e)
        resolve()
      })
    }))
    const createStore = require('../src/store/https')(Block)
    const create = () => {
      const id = Math.random().toString()
      const url = `http://localhost:${port}?id=${id}`
      stores[id] = inmem()
      const store = createStore(url)
      return store
    }
    test('basics', async () => {
      await basics(create)
    })
    describe('store.graph()', () => {
      graphTests(create, (store, ...args) => store.graph(...args))
    })
    describe('replicate', () => {
      replicateTests(create)
    })
    after(() => {
      server.close()
      return closed
    })
  })
  describe('http no params', () => {
    const port = getPort()
    const store = inmem()
    const server = require('http').createServer(createNodejsHandler(Block, store))
    const closed = new Promise(resolve => server.once('close', resolve))
    before(() => new Promise((resolve, reject) => {
      server.listen(port, e => {
        if (e) return reject(e)
        resolve()
      })
    }))
    const createStore = require('../src/store/https')(Block)
    const create = () => {
      const url = `http://localhost:${port}`
      return createStore(url)
    }
    test('basics', async () => {
      await basics(create)
    })
    test('url making', done => {
      const store = create()
      same(store.mkurl('asdf'), `http://localhost:${port}/asdf`)
      store.url += '/'
      same(store.mkurl('asdf'), `http://localhost:${port}/asdf`)
      done()
    })
    after(() => {
      server.close()
      return closed
    })
  })
  describe('http handler', () => {
    const createHandler = require('../src/http/store/handler')
    test('head', async () => {
      const store = inmem()
      const handler = createHandler(Block, store)
      const block = Block.encoder(Buffer.from('test'), 'raw')
      await store.put(block)
      const cid = await block.cid()
      const opts = { method: 'HEAD', path: cid.toString('base32') }
      let result = await handler(opts)
      same(result.headers['content-length'], 4)
      store.has = async () => true
      result = await handler(opts)
      same(result.statusCode, 200)
    })
  })
}
