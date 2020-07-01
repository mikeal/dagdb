import iamap from 'iamap'
import assert from 'assert'
import murmurhash3 from 'murmurhash3js-revisited'

const cidSymbol = Symbol.for('@ipld/js-cid/CID')
const isCID = node => !!(node && node[cidSymbol])

function murmurHasher (key) {
  // TODO: get rid of Buffer
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

const transaction = async function * (head, ops, get, Block) {
  const blocks = []
  const save = obj => {
    const block = Block.encoder(obj, 'dag-cbor')
    blocks.push(block)
    return block.cid()
  }

  const load = mkload(get)
  let map = await iamap.load({ save, load, ...store }, head)
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
const empty = (Block) => {
  const map = new iamap.IAMap(fixture, config)
  return Block.encoder(map.toSerializable(), 'dag-cbor')
}

const _load = async (head, get) => {
  const load = mkload(get)
  const map = await iamap.load({ save: noop, load, ...store }, head)
  return map
}

const get = async (head, key, get) => {
  const map = await _load(head, get)
  return map.get(key)
}
const has = async (head, key, _get) => {
  const val = await get(head, key, _get)
  if (typeof val === 'undefined') return false
  return true
}
const all = (root, get) => {
  const iter = async function * () {
    const map = await _load(root, get)
    const entries = await map.entries()
    yield * entries
  }
  return iter()
}
const bulk = transaction
const _store = store
const _noop = noop

export { all, bulk, empty, get, _store, _noop, has }
