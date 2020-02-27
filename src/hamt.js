const iamap = require('../../iamap')
const isCID = require('./is-cid')
const assert = require('assert')
const murmurhash3 = require('murmurhash3js-revisited')
function murmurHasher (key) {
  assert(Buffer.isBuffer(key))
  const b = Buffer.alloc(4)
  b.writeUInt32LE(murmurhash3.x86.hash32(key))
  return b
}
iamap.registerHasher('murmur3-32', 32, murmurHasher)

const noop = () => {}
const config = { hashAlg: 'murmur3-32' }
const isEqual = (one, two) => one.equals(two)
const isLink = isCID
const mkload = get => cid => get(cid).then(block => block.decode())
const store = { isEqual, isLink }

const transaction = async function * (Block, get, head, ops, codec = 'dag-cbor') {
  ops = Array.from(ops).map(block => block.decodeUnsafe())
  const blocks = []
  const save = obj => {
    const block = Block.encoder(obj, codec)
    blocks.push(block)
    return block.cid()
  }

  const load = mkload(get)
  let map = await iamap.load({ save, load, ...store}, head)
  for (const op of ops) {
    /* istanbul ignore else */
    if (op.set) {
      map = await map.set(op.set.key, op.set.val)
    } else if (op.del) {
      map = await map.delete(op.del.key)
    } else {
      throw new Error('Invalid operation')
    }
  }
  // would be great to have a hamt API that took bulk operations
  // and was async iterable
  yield * blocks
}

const fixture = { save: noop, load: noop, ...store }
const empty = (Block, codec) => {
  const map = new iamap.IAMap(fixture, config)
  return Block.encoder(map.toSerializable(), codec)
}

const get = async (head, key, get) => {
  const load = mkload(get)
  const map = await iamap.load({save: noop, load, ...store}, head)
  return map.get(key)
}

module.exports.bulk = transaction
module.exports.empty = empty
module.exports.get = get
module.exports._store = store
module.exports._noop = noop
