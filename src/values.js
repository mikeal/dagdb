const { readonly, isCID } = require('./utils')

module.exports = (Block, codec) => {
  const decode = (value, get) => {
    // decode only accepts IPLD Data Model
    // this method is expected to accept decoded Block data directly
    // and it can't work with any special types.
    if (isCID(value)) {
      const getter = async () => {
        if (getter.block) return getter.block
        const block = await get(value)
        readonly(getter, 'block', block)
        return decode(block.decodeUnsafe())
      }
      readonly(getter, 'cid', value)
      return getter
    }
    if (typeof value === 'object') {
      if (value._dagdb) {
        // TODO: special objects
        return value
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          value[i] = decode(value[i], get)
        }
      } else {
        for (const [key, _value] of Object.entries(value)) {
          value[key] = decode(_value, get)
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
    // fast return non-objects
    if (typeof value !== 'object') {
      yield value
    } else {
      if (value._dagdb) {
        // TODO: special objects
        yield * value.encode()
        return value
      } else if (Array.isArray(value)) {
        const ret = []
        for (let i = 0; i < value.length; i++) {
          let last
          for await (const block of encode(value[i])) {
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
          if (!last) throw new Error('Encoder did not yield a root node')
          ret[i] = await last
        }
        yield ret
      } else {
        const ret = {}
        for (const [key, _value] of Object.entries(value)) {
          let last
          for await (const block of encode(_value)) {
            // istanbul ignore next
            if (last) throw new Error('Encoder yield after non-block')
            if (Block.isBlock(block)) {
              yield block
              continue
            }
            last = block
          }
          ret[key] = await last
        }
        yield ret
      }
    }
  }

  return { encode, decode }
}
