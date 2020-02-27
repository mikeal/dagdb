
const { it } = require('mocha')
const inmem = require('../src/store/inmemory')
const { kv } = require('../')
const test = it
const same = require('assert').deepStrictEqual

const create = async () => {
  const store = inmem()
  const kvs = await kv.create(store)
  return { store, kvs }
}

test('basic set/get', async () => {
  const { kvs } = await create()
  kvs.set('test', { hello: 'world' })
  let obj = await kvs.get('test')
  same(obj, { hello: 'world' })
  await kvs.commit()
  obj = await kvs.get('test')
  same(obj, { hello: 'world' })
})

test('basic overwrite', async () => {
  let { store, kvs } = await create()
  kvs.set('test', { foo: 0 })
  const head = await kvs.commit()
  kvs = kv.transaction(head, store)
  same(await kvs.get('test'), { foo: 0 })
  await kvs.set('test', { foo: 1})
  same(await kvs.get('test'), { foo: 1 })
  await kvs.commit()
  same(await kvs.get('test'), { foo: 1 })
})

test('not found', async () => {
  let { store, kvs } = await create()
  try {
    await kvs.get('test')
  } catch (e) {
    if (e.message !== 'No key named "test"') {
      throw e
    }
  }
})
