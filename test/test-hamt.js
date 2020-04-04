/* globals it */
const hamt = require('../src/hamt')
const test = it
const same = require('assert').deepStrictEqual
const Block = require('@ipld/block')

const missing = Block.encoder({ test: Math.random() }, 'dag-cbor')

test('test store comparison', async () => {
  same(hamt._store.isEqual(await missing.cid(), await missing.cid()), true)
  same(hamt._noop(), undefined)
})
