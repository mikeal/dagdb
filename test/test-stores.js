/* globals describe, it, before, after */
import { fixtures, graphTests, replicateTests, basics } from './lib/storage.js'
import Block from '@ipld/block/defaults.js'
import LRUStore from '../src/stores/lru.js'
import createInmemory from '../src/stores/inmemory.js'
import assert from 'assert'

const same = assert.deepStrictEqual
const inmem = createInmemory(Block)
const test = it

const b = obj => Block.encoder(obj, 'dag-cbor')

describe('test-stores', () => {
  describe('lru', () => {
    const only = Block.encoder({ hello: 'world' }, 'dag-cbor')
    class TestStore extends LRUStore {
      _putBlock () {
      }

      _getBlock (cid) {
        return Block.encoder({ hello: 'world' }, 'dag-cbor')
      }
    }
    test('get', async () => {
      const store = new TestStore()
      const cid = await only.cid()
      const block = await store.get(cid)
      assert.ok(cid.equals(await block.cid()))
      same(store.lru.length, 13)
      same(block, await store.get(cid))
    })
    test('put', async () => {
      const store = new TestStore()
      await store.put(only)
      await store.put(only)
      same(store.lru.length, 13)
    })
  })

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

  describe('kv', () => {
    const create = require('./lib/mock-kv')
    test('basics', async () => {
      await basics(create)
    })
    test('store block twice', async () => {
      const store = await create({ lru: false })
      const block = b({ hello: 'world' })
      await store.put(block)
      same(Object.keys(store.storage).length, 2)
      await store.put(block)
      same(Object.keys(store.storage).length, 2)
    })
    describe('graph', () => {
      graphTests(create, (store, ...args) => store.graph(...args))
    })
    describe('replicate', () => {
      replicateTests(create)
    })
  })

  describe('s3', () => {
    const createS3 = require('./lib/mock-s3')
    const createStore = require('../src/stores/s3')(Block)
    const create = opts => createStore(createS3(), opts)
    test('basics', async () => {
      await basics(create)
    })
    test('store block twice', async () => {
      const store = await create({ lru: false })
      const block = b({ hello: 'world' })
      await store.put(block)
      same(Object.keys(store.s3.storage).length, 2)
      await store.put(block)
      same(Object.keys(store.s3.storage).length, 2)
    })
    describe('graph', () => {
      graphTests(create, (store, ...args) => store.graph(...args))
    })
    describe('replicate', () => {
      replicateTests(create)
    })
  })

  describe('level', () => {
    const memdown = require('memdown')
    const createStore = require('../src/stores/level')(Block)
    const create = () => createStore(memdown(Math.random().toString()))
    test('basics', async () => {
      await basics(create)
    })
    describe('graph', () => {
      graphTests(create, (store, ...args) => store.graph(...args))
    })
    describe('replicate', () => {
      replicateTests(create)
    })
  })

  describe('errors', () => {
    test('unsupported scheme', async () => {
      const main = require('../src/stores')(Block)
      try {
        await main.from('wss://')
        throw new Error('Did not throw')
      } catch (e) {
        if (e.message !== 'Cannot resolve identifier "wss://"') throw e
      }
    })
  })

  if (!process.browser) {
    const getPort = () => Math.floor(Math.random() * (9000 - 8000) + 8000)
    const stores = {}

    const createNodejsHandler = require('../src/http/nodejs').blockstore

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
      const createStore = require('../src/stores/https')(Block)
      const create = (opts) => {
        const id = Math.random().toString()
        const url = `http://localhost:${port}?id=${id}`
        stores[id] = inmem()
        const store = createStore(url, opts)
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
      const createStore = require('../src/stores/https')(Block)
      const create = (opts) => {
        const url = `http://localhost:${port}`
        return createStore(url, opts)
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
      const createHandler = require('../src/http/handlers').blockstore
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
  } else {
    describe('idb', function () {
      this.timeout(8000)
      const idb = require('level-js')
      const createStore = require('../src/stores/level')(Block)
      const create = (opts) => createStore(idb(Math.random().toString()), opts)
      test('basics', async () => {
        await basics(create)
      })
      describe('graph', () => {
        graphTests(create, (store, ...args) => store.graph(...args))
      })
      describe('replicate', () => {
        replicateTests(create)
      })
    })
  }
})
