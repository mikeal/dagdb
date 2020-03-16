const { it } = require('mocha')
const inmem = require('../src/store/inmemory')
const { kv } = require('../')
const bare = require('../bare')
const test = it
const assert = require('assert')
const same = assert.deepStrictEqual
const Block = require('@ipld/block')
const { isCID } = require('../src/utils')

const create = async (_kv = kv) => {
  const store = inmem()
  const kvs = await _kv.create(store)
  return { store, kvs }
}

let hello

const basics = async kv => {
  const { kvs } = await create(kv)
  await kvs.set('test', { hello: 'world' })
  let obj = await kvs.get('test')
  same(obj, { hello: 'world' })
  hello = await kvs.getBlock('test')
  const latest = await kvs.commit()
  obj = await latest.get('test')
  same(obj, { hello: 'world' })
  return latest
}

test('basic set/get', async () => {
  await basics(kv)
})

test('basic overwrite', async () => {
  let { kvs } = await create()
  await kvs.set('test', { foo: 0 })
  kvs = await kvs.commit()
  same(await kvs.get('test'), { foo: 0 })
  await kvs.set('test', { foo: 1 })
  same(await kvs.get('test'), { foo: 1 })
  await kvs.commit()
  same(await kvs.get('test'), { foo: 1 })
})

test('not found', async () => {
  const { kvs } = await create()
  try {
    await kvs.get('test')
  } catch (e) {
    if (e.kvs !== 'notfound') {
      throw e
    }
  }
})

test('basic removal', async () => {
  let { kvs } = await create()
  await kvs.set('test', { foo: 0 })
  same(await kvs.has('test'), true)
  kvs = await kvs.commit()
  same(await kvs.get('test'), { foo: 0 })
  await kvs.del('test')
  same(await kvs.has('test'), false)
  kvs = await kvs.commit()
  same(await kvs.has('test'), false)
})

test('custom codec', async () => {
  const { kv } = bare(Block, 'dag-json')
  await basics(kv)
  let store = await kv.create(inmem())
  await store.set('test', { x: 1 })
  store = await store.commit()
  same(await store.get('test'), { x: 1 })
  same(store.root.codec, 'dag-json')
  store = kv(store.root, store.store)
  same(await store.get('test'), { x: 1 })
})

test('iter over all in db', async () => {
  const kvs = await basics()
  assert.ok(await kvs.has('test'))
  for await (const [key, link] of kvs.all()) {
    assert.ok(isCID(link))
    same(key, 'test')
    assert.ok(link.equals(await hello.cid()))
  }
  for await (const [key, block] of kvs.all({ blocks: true })) {
    assert.ok(Block.isBlock(block))
    same(key, 'test')
    assert.ok((await block.cid()).equals(await block.cid()))
  }
  await kvs.set('test2', { test: 1 })
  let _link
  for await (const [key, link] of kvs.all()) {
    if (key === 'test') continue
    same(key, 'test2')
    const block = await kvs.getBlock('test2')
    _link = link
    assert.ok(link.equals(await block.cid()))
  }
  for await (const [key, block] of kvs.all({ blocks: true })) {
    if (key === 'test') continue
    same(key, 'test2')
    assert.ok(_link.equals(await block.cid()))
  }
  const kvs2 = await kvs.commit()
  await kvs.del('test2')
  for await (const [key] of kvs.all()) {
    if (key === 'test2') throw new Error('deleted key is in all iterator')
  }
  kvs2.del('test2')
  for await (const [key, link] of kvs2.all()) {
    assert.ok(isCID(link))
    same(key, 'test')
    assert.ok(link.equals(await hello.cid()))
  }
})

test('write a block as a value', async () => {
  const block = Block.encoder({ hello: 'world' }, 'dag-cbor')
  let db = await basics()
  await db.set('testblock', block)
  same(await db.get('testblock'), { hello: 'world' })
  db = await db.commit()
  same(await db.get('testblock'), { hello: 'world' })
})

test('commit no transactions', async () => {
  const db = await basics()
  let threw = true
  try {
    await db.commit()
    threw = false
  } catch (e) {
    if (!e.message.startsWith('There are no pending operations to commit')) throw e
  }
  assert.ok(threw)
})

test('size', async () => {
  const db = await basics()
  same(await db.size(), 1)
  await db.set('test1', { hello: 'world' })
  same(await db.size(), 2)
  await db.set('test2', { hello: 'world' })
  same(await db.size(), 3)
  await db.del('test')
  same(await db.size(), 2)
  await db.del('missing')
  same(await db.size(), 2)
})
