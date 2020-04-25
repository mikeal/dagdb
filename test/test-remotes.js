/* globals it */
const Block = require('@ipld/block')
const bent = require('bent')
const inmem = require('../src/stores/inmemory')
const createUpdater = require('../src/updaters/kv')
const database = require('../src/database')(Block)
const createKV = require('./lib/mock-kv')
const test = it
const assert = require('assert')
const same = assert.deepStrictEqual
const ok = assert.ok

const create = async () => {
  const store = inmem()
  const updater = createUpdater(createKV())
  const db = await database.create(store, updater)
  return { store, db, updater }
}

const createRemotes = async (strategy) => {
  const dbs = await Promise.all([create(), create()])
  const [db1, db2] = dbs.map(db => db.db)
  const remote = await db1.remotes.addLocal('test', strategy)
  return { db1, db2, remote }
}

const v1 = 'db-v1'

test('nothing to merge', async () => {
  let { db1, db2, remote } = await createRemotes({ full: true })
  await remote.pullDatabase(db2)
  const latest = await db1.update()
  const kv1 = (await latest._kv).root
  const kv2 = (await db1._kv).root
  ok(kv1.equals(kv2))
  const root1 = await db1.store.get(db1.root)
  const root2 = await latest.store.get(latest.root)
  assert.ok(!root1.decode()[v1].remotes.equals(root2.decode()[v1].remotes))
  remote = await latest.remotes.get('test')
  const decoded = remote.rootDecode
  ok(decoded.head.equals(decoded.merged))
})

test('full merge', async () => {
  let { db1, db2, remote } = await createRemotes({ full: true })
  await db2.set('test', { hello: 'world' })
  db2 = await db2.commit()
  await remote.pullDatabase(db2)
  let latest = await db1.update()
  const kv1 = (await latest._kv).root
  const kv2 = (await db2._kv).root
  ok(kv1.equals(kv2))
  remote = await latest.remotes.get('test')
  await remote.pullDatabase(db2)
  latest = await latest.update()
  same(await latest.get('test'), { hello: 'world' })

  await db2.set('test', { foo: 'bar' })
  db2 = await db2.commit()
  remote = await latest.remotes.get('test')
  await remote.pullDatabase(db2)
  latest = await latest.update()
  same(await latest.get('test'), { foo: 'bar' })
})

test('keyed merge', async () => {
  let { db1, db2, remote } = await createRemotes({ keyed: 'test-db' })
  await db2.set('test', { hello: 'world' })
  db2 = await db2.commit()
  await remote.pullDatabase(db2)
  db1 = await db1.update()
  const kv1 = (await db2._kv).root
  const latestDB = await db1.get('test-db')
  const kv2 = (await latestDB._kv).root
  ok(kv1.equals(kv2))
  same(await latestDB.get('test'), { hello: 'world' })
  remote = await db1.remotes.get('test')
  await remote.pullDatabase(db2)

  let dbValue = await db1.get('test-db')
  same(await dbValue.get('test'), { hello: 'world' })

  await db2.set('test', { foo: 'bar' })
  db2 = await db2.commit()
  remote = await db1.remotes.get('test')
  await remote.pullDatabase(db2)
  db1 = await db1.commit()
  dbValue = await db1.get('test-db')
  same(await dbValue.get('test'), { foo: 'bar' })
})

test('unsupported scheme', async () => {
  const main = require('../src/updaters')(Block)
  try {
    await main.from('ws://')
    throw new Error('Did not throw')
  } catch (e) {
    if (e.message !== 'Unsupported identifier "ws://"') throw e
  }
})

if (!process.browser) {
  const stores = {}
  const updaters = {}

  const httpTests = require('./lib/http.js')
  const createHandler = require('../src/http/nodejs')

  test('handler info, readonly', async () => {
    const handler = require('../src/http/handlers').info({}, { root: 'test' })
    const resp = await handler({})
    const info = JSON.parse(resp.body.toString())
    same(info.root, 'test')
    assert.ok(!info.updater)
    same(info.blockstore, 'blockstore')
  })
  test('missing required param', async () => {
    const handler = require('../src/http/handlers').updater()
    try {
      await handler({ params: {} })
      throw new Error('Did not throw')
    } catch (e) {
      if (e.message !== 'Missing required param "new"') throw e
    }
  })
  test('update handler', async () => {
    const b = Buffer.from('test')
    const block = Block.encoder(b, 'raw')
    const cid = await block.cid()
    const updater = { update: () => cid }
    const handler = createHandler.updater(updater)
    let head
    let body
    const mock = {
      writeHead: (...args) => { head = args },
      end: (...args) => { body = args }
    }
    await handler({ method: 'GET', url: `/?new=${cid.toString('base32')}` }, mock)
    body = JSON.parse(body.toString())
    const [status, headers] = head
    same(headers['content-type'], 'application/json')
    same(status, 200)
    same(body, { root: cid.toString('base32') })
  })
  test('handler no base path', async () => {
    const b = Block.encoder(Buffer.from('test'), 'raw')
    const cid = await b.cid()
    const store = {}
    const updater = { root: await b.cid() }
    const handler = createHandler(Block, store, updater)
    let head
    let body
    const mock = {
      writeHead: (...args) => { head = args },
      end: (...args) => { body = args }
    }
    await handler({ method: 'GET', url: '/' }, mock)
    body = JSON.parse(body.toString())
    const [status, headers] = head
    same(headers['content-type'], 'application/json')
    same(status, 200)
    same(body, { root: cid.toString('base32'), blockstore: 'blockstore' })
  })

  const handler = async (req, res) => {
    const [id] = req.url.split('/').filter(x => x)
    const store = stores[id]
    const updater = updaters[id]
    if (!store) throw new Error('Missing store')
    const _handler = createHandler(Block, store, updater)
    return _handler(req, res, '/' + id)
  }
  httpTests(handler, port => {
    const createDatabase = require('../')
    const create = async (opts) => {
      const id = Math.random().toString()
      const url = `http://localhost:${port}/${id}`
      stores[id] = inmem()
      updaters[id] = createUpdater(createKV())
      return createDatabase.create(url)
    }
    test('basic full merge', async () => {
      let db1 = await create()
      let db2 = await create()
      await db2.set('test', { hello: 'world' })
      db2 = await db2.update()
      const info = { source: db2.updater.infoUrl, strategy: { full: true } }
      await db1.remotes.add('a', info)
      db1 = await db1.update()
      db1 = await createDatabase.open(db1.updater.infoUrl)
      same(await db1.get('test'), { hello: 'world' })
      await db2.set('test2', { foo: 'bar' })
      db2 = await db2.update()
      await db1.remotes.pull('a')
      same(await db1.get('test2'), { foo: 'bar' })
      db1 = await db1.update()
      await db1.remotes.pull('a')
      const root = db1.root
      db1 = await db1.update()
      root.equals(db1.root)
    })
    test('updater', async () => {
      let db = await create()
      await db.set('test', { hello: 'world' })
      db = await db.update()
      assert.ok(db.root.equals(await db.updater.root))
    })
    test('not found', async () => {
      const db = await create()
      const url = db.updater.infoUrl + 'notfound'
      const get = bent(404, 'string')
      const resp = await get(url)
      same(resp, 'Not found')
    })
    test('push', async () => {
      let db = await create()
      const info = { source: db.updater.infoUrl, strategy: { full: true } }
      delete db.updater
      await db.remotes.add('origin', info)
      db = await db.commit()
      const remote = await db.remotes.get('origin')
      await remote.push()
    })
    const createReadonly = async (opts) => {
      const db = await create()
      const url = db.updater.infoUrl
      const split = url.split('/').filter(x => x)
      const id = split[split.length - 1]
      const updater = { root: db.root }
      updaters[id] = updater
      return [db, updater]
    }
    test('pull readonly', async () => {
      let [db1, updater] = await createReadonly()
      await db1.set('foo', 'bar')
      db1 = await db1.commit()
      updater.root = db1.root
      let db2 = await create()
      const info = { source: db1.updater.infoUrl, strategy: { full: true } }
      await db2.remotes.add('test', info)
      await db2.remotes.pull('test')
      same(await db2.get('foo'), 'bar')
      db2 = await db2.update()
      try {
        await db2.remotes.push('test')
        throw new Error('Did not throw')
      } catch (e) {
        if (e.message !== 'Remote must have updater to use push') throw e
      }
    })
  })
}
