
const { it } = require('mocha')
const inmem = require('../src/store/inmemory')
const { kv } = require('../')
const test = it

test('basic set/get', async () => {
  const store = inmem()
  const kv = await kv.create(store)
  await kv.set('test', { hello: 'world' })
  const obj = await kv.get('test')
  same(obj, { hello: 'world' })
})
