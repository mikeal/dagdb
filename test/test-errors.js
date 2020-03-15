const { it } = require('mocha')
const inmem = require('../src/store/inmemory')
const { kv } = require('../')
const test = it
const assert = require('assert')
const same = assert.deepStrictEqual
const Block = require('@ipld/block')

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
    if (e.status !== 404) throw e
  }
  assert.ok(threw)
  await db.del('test')
  try {
    await db.get('test')
    threw = false
  } catch (e) {
    const match = 'No key named "test"'
    if (e.message !== match) throw e
    if (e.status !== 404) throw e
  }
  assert.ok(threw)
})
