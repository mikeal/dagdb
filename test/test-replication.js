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
  const root = await kvs.commit()
  obj = await root.get('test')
  same(obj, { hello: 'world' })
  return root
}

test('basic replication', async () => {
  const base = await basics()
  const { kvs } = await create()
  await kvs.pull(base)
  same(await kvs.get('test'), { hello: 'world' })
})

test('deduplication', async () => {
  let [one, two] = await Promise.all([basics(), basics()])
  await one.set('test2', { foo: 'bar' })
  one = await one.commit()
  await two.set('test2', { foo: 'bar' })
  await two.pull(one)
  two = await two.commit()
  assert.ok(one.root.equals(two.root))
  await one.pull(two)
  same(one.cache.size, 0)
})

test('pull only latest change to key', async () => {
  let [one, two] = await Promise.all([basics(), basics()])
  await one.set('test2', { foo: 'bar' })
  one = await one.commit()
  await two.set('test2', { foo: 'bar' })
  await two.pull(one)
  two = await two.commit()
  assert.ok(one.root.equals(two.root))
  await one.pull(two)
  same(one.cache.size, 0)
})
