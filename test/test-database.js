/* globals it, describe, before, after */
import Block from '@ipld/block/defaults'
import createInmemory from '../src/stores/inmemory.js'
import createUpdater from '../src/updaters/kv.js'
import createDatabaseInterface from '../src/database.js'
import createKV from './lib/mock-kv.js'
import assert from 'assert'

const database = createDatabaseInterface(Block)
const test = it
const same = assert.deepStrictEqual
const inmem = createInmemory(Block)
const { CID } = Block

const create = async () => {
  const store = inmem()
  const updater = createUpdater(Block)(createKV())
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
  same(await db.has('test'), true)
  same(await db.has('missing'), false)
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

  test('register custom type', async () => {
    let db = await basics()
    class Dog {
      constructor ({ name, age }) {
        this.name = name
        this.age = age
      }

      get _dagdb () {
        return { v1: 'dog' }
      }

      async * encode () {
        const block = Block.encoder({ ...this }, 'dag-cbor')
        yield block
        yield block.cid()
      }

      static async decode (block) {
        return new Dog(block.decodeUnsafe())
      }

      bark () {
        return `hello from "${this.name}"`
      }
    }

    const createDog = async (root, store) => {
      return Dog.decode(await store.get(root))
    }

    db.register('dog', createDog)

    const dog = new Dog({ name: 'lucas', age: 8 })
    await db.set('lucas', dog)
    db = await db.update()

    const lucas = await db.get('lucas')
    const bark = lucas.bark()
    same(bark, 'hello from "lucas"')
  })

  test('update', async () => {
    let { db, updater } = await create()
    await db.set('test', { hello: 'world' })
    db = await db.update()
    same(await db.get('test'), { hello: 'world' })
    const root = CID.from(await updater.store._getKey(['root']))
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
    const root = CID.from(await updater.store._getKey(['root']))
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

  test('all()', async () => {
    const db = await basics()
    for await (const [key, value] of db.all()) {
      same(value, { hello: 'world' })
      same(key, 'test')
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
    const db = await database.create(store, createUpdater(Block)(createKV()))
    const updater = createUpdater(Block)(createKV())
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
    let httpModule
    let getPort
    let stores
    let updaters
    let createHandler
    let handler
    before(async () => {
      httpModule = (await import('http')).default
      getPort = () => Math.floor(Math.random() * (9000 - 8000) + 8000)
      stores = {}
      updaters = {}

      createHandler = (await import('../src/http/nodejs.js')).default

      handler = async (req, res) => {
        const [id] = req.url.split('/').filter(x => x)
        const store = stores[id]
        const updater = updaters[id]
        if (!store) throw new Error('Missing store')
        const _handler = createHandler(Block, store, updater)
        return _handler(req, res, '/' + id)
      }
    })

    describe('http', () => {
      let port
      let server
      let closed
      let createDatabase
      let create
      before(async () => {
        port = getPort()
        server = httpModule.createServer(handler)
        closed = new Promise(resolve => server.once('close', resolve))
        createDatabase = (await import('../src/index.js')).default
        create = async (opts) => {
          const id = Math.random().toString()
          const url = `http://localhost:${port}/${id}`
          stores[id] = inmem()
          updaters[id] = createUpdater(Block)(createKV())
          return { db: await createDatabase.create(url) }
        }
        await new Promise((resolve, reject) => {
          server.listen(port, e => {
            if (e) return reject(e)
            resolve()
          })
        })
      })
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
