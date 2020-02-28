const { it } = require('mocha')
const inmem = require('../src/store/inmemory')
const test = it
const Block = require('@ipld/block')

const missing = Block.encoder({ test: Math.random() }, 'dag-cbor')

const basics = async create => {
  const store = await create()
  const block = Block.encoder({ hello: 'world' }, 'dag-cbor')
  await store.put(block)
  const first = await block.cid()
  const second = await store.get(first)
  if (!first.equals(await second.cid())) {
    throw new Error('Store is not retaining blocks')
  }
  try {
    await store.get(await missing.cid())
  } catch (e) {
    if (e.status === 404) {
      return
    } else {
      throw new Error('Storage error is missing status code')
    }
  }
  throw new Error('store.get() must throw when missing block')
}

test('basic inmem', async () => {
  await basics(inmem)
})
