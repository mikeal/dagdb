const { it } = require('mocha')
const inmem = require('../src/store/inmemory')
const { database } = require('../')
const test = it
const assert = require('assert')
const same = assert.deepStrictEqual

const create = async () => {
  const store = inmem()
  const db = await database.create(store)
  return { store, db }
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
