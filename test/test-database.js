/* globals it, describe, before, after */
import Block from '@ipld/block/defaults.js'
import createInmemory from '../src/stores/inmemory.js'
import createUpdater from '../src/updaters/kv.js'
import createDatabaseInterface = '../src/database.js'
import createKV from './lib/mock-kv.js'
import assert from 'assert'

const database = createDatabaseInterface(Block)
const test = it
const same = assert.deepStrictEqual
const inmem = createInmemory(Block)
const { CID } = Block

const create = async () => {
  const store = inmem()
  const updater = createUpdater(createKV())
  const db = await database.create(store, updater)
  return { store, db, updater }
}

const basics = async (_create = create) => {
  const { db } = await _create()
  await db.set('test', { hello: 'world' })
  let obj = await db.get('test')
  same(obj, { hello: 'world' })
  const latest = await db.commit()
  obj = await latest.get('test')
  same(obj, { hello: 'world' })
  return latest
}

describe('test-database', () => {
  test('basic set/get', async () => {
    await basics()
    await basics()
  })

  test('info', async () => {
    const db = await basics()
    same(await db.info(), { size: 1 })
  })

  test('manual transation', async () => {
    const latest = await basics()
    const db = database(latest.root, latest.store)
    same(await db.get('test'), { hello: 'world' })
  })

  test('links', async () => {
    const db = await basics()
    let link = db.link({ blah: true }) // use the promise
    await db.set('test2', { two: link })
    const obj = await db.get('test2')
    link = await link
    same(await obj.two(), await link())
  })

  test('update', async () => {
    let { db, updater } = await create()
    await db.set('test', { hello: 'world' })
    db = await db.update()
    same(await db.get('test'), { hello: 'world' })
    const root = new CID(await updater.store._getKey(['root']))
    assert.ok(root.equals(db.root))
  })

  test('update out of date root', async () => {
    let { db, updater } = await create()
    await db.set('test', { hello: 'world' })
    await db.update()
    await db.set('test2', { foo: 'bar' })
    db = await db.update()
    same(await db.get('test'), { hello: 'world' })
    same(await db.get('test2'), { foo: 'bar' })
    const root = new CID(await updater.store._getKey(['root']))
    assert.ok(root.equals(db.root))
  })

  test('concurrent updates', async () => {
    const { db } = await create()
    await db.set('test', { hello: 'world' })
    const results = await Promise.all([db.update(), db.update(), db.update()])
    const comp = (cid1, cid2) => cid1 && cid2 && cid1.equals(cid2) ? cid2 : false
    const equals = results.map(db => db.root).reduce(comp)
    assert.ok(equals)
  })

  test('dirty database as value', async () => {
    const db = await basics()
    const val = await basics()
    await val.set('foo', 'bar')
    try {
      await db.set('val', val)
      throw new Error('Did not throw')
    } catch (e) {
      if (e.message !== 'Cannot use database with pending transactions as a value') throw e
    }
  })

  // errors

  /*
  test('error: update no changes', async () => {
    const { db } = await create()
    let threw = true
    try {
      await db.update()
      threw = false
    } catch (e) {
      if (e.message !== 'No changes to update') throw e
    }
    assert.ok(threw)
  })
  */

  test('error: empty updater write', async () => {
    const store = inmem()
    const db = await database.create(store, createUpdater(createKV()))
    const updater = createUpdater(createKV())
    const empty = database(db.root, store, updater)
    await empty.set('test', { hello: 'world' })
    let threw = true
    try {
      await empty.update()
      threw = false
    } catch (e) {
      if (e.message !== 'There is no previous root') throw e
    }
    assert.ok(threw)
  })

  if (!process.browser) {
    const getPort = () => Math.floor(Math.random() * (9000 - 8000) + 8000)
    const stores = {}
    const updaters = {}

    const createHandler = require('../src/http/nodejs')

    const handler = async (req, res) => {
      const [id] = req.url.split('/').filter(x => x)
      const store = stores[id]
      const updater = updaters[id]
      if (!store) throw new Error('Missing store')
      const _handler = createHandler(Block, store, updater)
      return _handler(req, res, '/' + id)
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
      const createDatabase = require('../')
      const create = async (opts) => {
        const id = Math.random().toString()
        const url = `http://localhost:${port}/${id}`
        stores[id] = inmem()
        updaters[id] = createUpdater(createKV())
        return { db: await createDatabase.create(url) }
      }
      test('basics', async () => {
        await basics(create)
      })
      test('open', async () => {
        let db = await basics(create)
        db = await db.update()
        const db2 = await createDatabase.open(db.updater.infoUrl)
        assert.ok(db.root.equals(db2.root))
      })
      after(() => {
        server.close()
        return closed
      })
    })
  }
})
