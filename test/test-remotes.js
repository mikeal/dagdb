/* globals it, describe */
const inmem = require('../src/store/inmemory')
const createUpdater = require('../src/updater/kv')
const { database } = require('../')
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
  let threw = true
  try {
    latest = await latest.update()
    threw = false
  } catch (e) {
    if (e.message !== 'No changes to update') throw e
  }
  ok(threw)
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
  let threw = true
  try {
    await db1.update()
    threw = false
  } catch (e) {
    if (e.message !== 'No changes to update') throw e
  }
  ok(threw)

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

describe('http', () => {
})
