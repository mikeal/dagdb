const { readonly, isCID, validate } = require('./utils')
const createFBL = require('@ipld/fbl/bare')
const types = {}

module.exports = (Block) => {
  const fbl = createFBL(Block, 'dag-cbor')

  const fblDecoder = (root, store) => {
    const get = store.get.bind(store)
    const iter = fbl.read(root, get)
    iter._dagdb = { v1: 'fbl' }
    iter.encode = () => (async function * (r) { yield r })(root)
    iter.read = (...args) => fbl.read(root, get, ...args)
    return iter
  }

  const _typeEncoder = async function * (gen, set) {
    let last
    for await (const block of gen) {
      // testing these guards would require an implementation w/ a schema
      // for a bad implementation, which would be bad to ship with.
      // istanbul ignore next
      if (last) throw new Error('Encoder yield after non-block')
      if (Block.isBlock(block)) {
        yield block
        continue
      }
      last = block
    }
    // istanbul ignore next
    if (typeof last === 'undefined') throw new Error('Encoder did not yield a root node')
    set(last)
  }
  const typeEncoder = gen => {
    const encoder = _typeEncoder(gen, last => { encoder.last = last })
    return encoder
  }
  const decode = (value, store, updater) => {
    // decode only accepts IPLD Data Model
    // this method is expected to accept decoded Block data directly
    // and it can't work with any special types.
    if (isCID(value)) {
      const link = async () => {
        if (link.block) return link.block
        const block = await store.get(value)
        readonly(link, 'block', block)
        return decode(block.decode())
      }
      readonly(link, 'cid', value)
      return link
    }
    if (typeof value === 'object') {
      if (value._dagdb) {
        validate(value, 'DagDB')
        const type = Object.keys(value._dagdb.v1)[0]
        return types[type](value._dagdb.v1[type], store, updater)
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          value[i] = decode(value[i], store, updater)
        }
      } else {
        for (const [key, _value] of Object.entries(value)) {
          value[key] = decode(_value, store, updater)
        }
      }
    }
    return value
  }

  const encode = async function * (value) {
    // Encoders, both here and in special types, are
    // async generators that yield as many blocks as
    // they like as long as the very last thing they
    // yield is NOT a Block. This is so that the final
    // root of each each node can be embedded in a parent.
    // This contract MUST be adhered to by all special types.
    if (typeof value === 'object' && typeof value.then === 'function') value = await value
    if (isCID(value)) {
      yield value
      return
    }
    if (Block.isBlock(value)) {
      yield value.cid()
      return
    }
    if (typeof value === 'function' && value.cid) {
      if (value.block) yield value.block
      yield value.cid
      return
    }
    if (value[Symbol.asyncIterator] && !value._dagdb) {
      let last
      for await (const block of fbl.from(value)) {
        yield block
        last = block
      }
      yield { _dagdb: { v1: { fbl: await last.cid() } } }
      return
    }
    // fast return non-objects
    if (typeof value !== 'object') {
      yield value
    } else {
      if (value._dagdb) {
        const encoder = typeEncoder(value.encode())
        yield * encoder
        const type = value._dagdb.v1
        const typeDef = {}
        typeDef[type] = encoder.last
        yield { _dagdb: { v1: typeDef } }
      } else if (Array.isArray(value)) {
        const ret = []
        for (let i = 0; i < value.length; i++) {
          const encoder = typeEncoder(encode(value[i]))
          yield * encoder
          ret[i] = await encoder.last
        }
        yield ret
      } else {
        const ret = {}
        for (const [key, _value] of Object.entries(value)) {
          const encoder = typeEncoder(encode(_value))
          yield * encoder
          ret[key] = await encoder.last
        }
        yield ret
      }
    }
  }

  const register = (type, fn) => { types[type] = fn }
  register('fbl', fblDecoder)

  return { encode, decode, register }
}
