/* globals it, describe, before, after */
import Block from '@ipld/block/defaults.js'
import createInmemory from '../src/stores/inmemory'
import createKV from '../src/kv.js'
import assert from 'assert'
import bent from 'bent'

const inmem = createInmemory(Block)
const kv = createKV(Block)
const test = it
const same = assert.deepStrictEqual

const create = async (_kv = kv) => {
  const store = inmem()
  const kvs = await _kv.create(store)
  return { store, kvs }
}

const basics = async kv => {
  const { kvs } = await create(kv)
  await kvs.set('test', { hello: 'world' })
  let obj = await kvs.get('test')
  same(obj, { hello: 'world' })
  const root = await kvs.commit()
  obj = await root.get('test')
  same(obj, { hello: 'world' })
  return root
}

describe('test-errors', () => {
  test('createGet CID check', async () => {
    const { createGet } = require('../src/kv')
    const get = createGet()
    let threw = true
    try {
      await get('test')
      threw = false
    } catch (e) {
      if (!e.message.startsWith('Must be CID')) throw e
    }
    assert.ok(threw)
  })

  test('has() message exception', async () => {
    const db = await basics()
    db.store.get = cid => {
      throw new Error('test error')
    }
    let threw = true
    try {
      await db.has('test')
      threw = false
    } catch (e) {
      if (!e.message.startsWith('test error')) throw e
    }
    assert.ok(threw)
  })

  test('no common root', async () => {
    const original = await basics()
    await original.set('another', 'asdf')
    const db = await original.commit()
    const rootBlock = await db.store.get(db.root)
    const rootObject = rootBlock.decode()
    rootObject['kv-v1'].prev = null
    const _root = Block.encoder(rootObject, 'dag-cbor')
    const store = inmem()
    await store.put(_root)
    const db2 = kv(await _root.cid(), store)
    let threw = true
    try {
      await original.pull(db2)
      threw = false
    } catch (e) {
      if (!e.message.startsWith('No common root between databases')) throw e
    }
    assert.ok(threw)
  })

  test('not found', async () => {
    const db = await basics()
    let threw = true
    try {
      await db.get('notfound')
      threw = false
    } catch (e) {
      const match = 'No key named "notfound"'
      if (e.message !== match) throw e
      if (e.statusCode !== 404) throw e
    }
    assert.ok(threw)
    await db.del('test')
    try {
      await db.get('test')
      threw = false
    } catch (e) {
      const match = 'No key named "test"'
      if (e.message !== match) throw e
      if (e.statusCode !== 404) throw e
    }
    assert.ok(threw)
  })

  if (!process.browser) {
    describe('http', () => {
      const store = inmem()
      test('http storage handler', async () => {
        const handler = require('../src/http/handlers').blockstore(Block, store)
        const getError = async (...args) => {
          try {
            await handler(...args)
          } catch (e) {
            return e
          }
          throw new Error('function did not throw')
        }
        const missing = Block.encoder({ test: Math.random() }, 'dag-cbor')
        const missingKey = (await missing.cid()).toString('base32')

        let e = await getError({})
        same(e.message, 'Missing required param "method"')
        e = await getError({ method: 'GET' })
        same(e.message, 'Missing required param "path"')
        e = await getError({ method: 'PUT', path: '/' })
        same(e.message, 'Missing required param "body"')
        e = await getError({ method: 'GET', path: '/cid/graph', params: { depth: 1025 } })
        same(e.message, 'Depth is greater than max limit of 1024')
        e = await getError({ method: 'GET', path: 'cid/blah/nope/breaks' })
        same(e.message, 'Path for block retreival must not include slashes')
        e = await getError({ method: 'PUT', path: '/cid/nope', body: Buffer.from('') })
        same(e.message, 'Path for block writes must not include slashes')
        e = await getError({ method: 'PUT', path: `/${missingKey}`, body: Buffer.from('adsf') })
        same(e.message, 'Block data does not match hash in CID')
        e = await getError({ method: 'HEAD', path: '/cid/nope' })
        same(e.message, 'Path for block retreival must not include slashes')
        e = await getError({ method: 'OPTIONS', path: '/test' })
        same(e.message, 'Unknown method "OPTIONS"')
        same(e.statusCode, 405)

        const notfound = (await Block.encoder(Buffer.from('asdf'), 'raw').cid()).toString('base32')
        e = await handler({ method: 'GET', path: `/${notfound}` })
        same(e.statusCode, 404)
      })
      const getPort = () => Math.floor(Math.random() * (9000 - 8000) + 8000)
      const port = getPort()
      const handler = require('../src/http/nodejs').blockstore(Block, store)
      const server = require('http').createServer(handler)
      const closed = new Promise(resolve => server.once('close', resolve))

      before(() => new Promise((resolve, reject) => {
        server.listen(port, e => {
          if (e) return reject(e)
          resolve()
        })
      }))

      const headNotFound = bent(404, 'string', `http://localhost:${port}`)

      describe('blockstore', async () => {
        test('not found', async () => {
          const block = Block.encoder(Buffer.from('test'), 'raw')
          const cid = await block.cid()
          const msg = await headNotFound(`/${cid.toString('base32')}`)
          same(msg, '')
        })
      })

      after(() => {
        server.close()
        return closed
      })
    })
  }
})
