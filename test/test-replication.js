/* globals it */
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

  // test longer history reconciliation
  await one.set('test2', { foo: 2 })
  one = await one.commit()
  await two.set('test2', { foo: 1 })
  two = await two.commit()
  await two.set('test2', { foo: 2 })
  two = await two.commit()
  await two.set('test2', { foo: 3 })
  two = await two.commit()
  await await one.pull(two)
  same(one.cache.size, 1)
  same(await one.get('test2'), { foo: 3 })
  one = await one.commit()
  // transaction root should not match
  assert(!one.root.equals(two.root))
  const head1 = await one.getHead()
  const head2 = await two.getHead()
  assert(head1.equals(head2))
})

const remoteWins = (locals, remotes) => remotes[remotes.length - 1]

test('remote wins conflict', async () => {
  let [one, two] = await Promise.all([basics(), basics()])
  await one.set('test2', { foo: 'bar' })
  one = await one.commit()
  await two.set('test2', { foo: 'bar' })
  await two.pull(one)
  two = await two.commit()

  // overwrite cached values
  await one.set('test3', { foo: 'bar' })
  one = await one.commit()
  await two.set('test3', { foo: 1 })
  try {
    await two.pull(one)
  } catch (e) {
    if (!e.message.startsWith('Conflict')) throw e
  }
  await two.pull(one, remoteWins)
  same(await one.get('test3'), await two.get('test3'))
  await two.del('test3')
  await two.pull(one, remoteWins)
  same(two.cache.size, 1)
  same(await one.get('test3'), await two.get('test3'))

  // overwrite written conlict
  const _two = two
  await two.set('test3', { foo: 3 })
  two = await two.commit()
  await two.pull(one, remoteWins)
  same(two.cache.size, 1)
  same(await one.get('test3'), await two.get('test3'))

  two = _two
  await two.set('test3', { foo: 7 })
  two = await two.commit()
  await two.del('test3')
  two = await two.commit()
  await two.pull(one, remoteWins)
  same(two.cache.size, 1)
  same(await one.get('test3'), await two.get('test3'))

  two = await two.commit()
  await two.set('two', { x: 1 })
  two = await two.commit()
  await two.set('test3', { foo: 20 })
  two = await two.commit()

  await one.set('test3', { foo: 22 })
  one = await one.commit()
  await one.del('test3')
  one = await one.commit()

  two.set('test3', { foo: 51 })
  await two.pull(one, remoteWins)
  same(two.cache.size, 1)
  same(await two.has('test3'), false)
  two = await two.commit()
  same(await two.has('test3'), false)
})

test('no-conflict on duplicate values', async () => {
  let [one, two] = await Promise.all([basics(), basics()])
  await one.set('one', { foo: 'bar' })
  await two.set('two', { foo: 'bar' })
  one = await one.commit()
  two = await two.commit()
  await one.set('two', { foo: 'bar' })
  one = await one.commit()
  await one.pull(two)
  same(one.cache.size, 0)
  await two.pull(one)
  same(two.cache.size, 1)
  same(await two.get('one'), { foo: 'bar' })
})

test('no-conflict on duplicate values w/ history', async () => {
  let [one, two] = await Promise.all([basics(), basics()])
  await one.set('one', { foo: 'bar' })
  await two.set('two', { foo: 'bar' })
  one = await one.commit()
  two = await two.commit()

  await one.set('two', { foo: 'bar' })
  one = await one.commit()
  let i = 0
  while (i < 10) {
    await one.set('two', { foo: i })
    one = await one.commit()
    i++
  }
  await two.pull(one)
  same(two.cache.size, 2)
  same(await two.get('two'), { foo: 9 })
})
