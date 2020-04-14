/* globals it */
const inmem = require('../src/store/inmemory')
const createUpdater = require('../src/updater/kv')
const { database } = require('../')
const createKV = require('./lib/mock-kv')
const test = it
const assert = require('assert')
const same = assert.deepStrictEqual
const CID = require('cids')

const create = async () => {
  const store = inmem()
  const updater = createUpdater(createKV())
  const db = await database.create(store, updater)
  return { store, db, updater }
}

const basics = async () => {
  const { db } = await create()
  await db.set('test', { hello: 'world' })
  let obj = await db.get('test')
  same(obj, { hello: 'world' })
  const latest = await db.commit()
  obj = await latest.get('test')
  same(obj, { hello: 'world' })
  return latest
}

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

// errors

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
