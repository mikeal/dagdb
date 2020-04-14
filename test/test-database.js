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
