const { it } = require('mocha')
const inmem = require('../src/store/inmemory')
const { kv } = require('../')
const test = it
const assert = require('assert')
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
  const latest = await kvs.commit()
  obj = await latest.get('test')
  same(obj, { hello: 'world' })
  return latest
}

test('links', async () => {
  let db = await basics(kv)
  const block = await db.getBlock('test')
  const linked = { test: await block.cid() }
  await db.set('linked', linked)
  let val = await db.get('linked')
  same(await val.test(), { hello: 'world' })
  db = await db.commit()
  val = await db.get('linked')
  same(await val.test(), { hello: 'world' })

  // test w/ getter block caching
  await val.test()
  await db.set('fromLinked', val)
  val = await db.get('fromLinked')
  same(await val.test(), { hello: 'world' })
  db = await db.commit()
  val = await db.get('fromLinked')
  same(await val.test(), { hello: 'world' })

  // test w/o getter block caching
  val = await db.get('fromLinked')
  await db.set('fromLinkedNoCache', val)
  same(await val.test(), { hello: 'world' })
  db = await db.commit()
  val = await db.get('fromLinked')
  same(await val.test(), { hello: 'world' })
})

test('blocks as links', async () => {
  let db = await basics(kv)
  const block = await db.getBlock('test')
  const linked = { test: block }
  await db.set('linked', linked)
  let val = await db.get('linked')
  same(await val.test(), { hello: 'world' })
  db = await db.commit()
  val = await db.get('linked')
  same(await val.test(), { hello: 'world' })
})

test('arrays', async () => {
  const db = await basics(kv)
  const block = await db.getBlock('test')
  await db.set('arr', ['asdf', { hello: 'world' }, block])

  const val = await db.get('arr')
  assert.ok(Array.isArray(val))
  same(val[0], 'asdf')
  same(val[1], { hello: 'world' })
  same(await val[2](), { hello: 'world' })
})
