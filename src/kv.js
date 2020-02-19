const noResolver = () => {
  throw new Error('Operation conflict and no resolver has been provided')
}

const sanitize = obj => {
  const ret = {}
  for (const key of obj) {
    if (!key.startsWith('_')) ret[key] = obj[key]
  }
  return ret
}

module.exports = (Block, codec = 'dag-cbor') => {
  const types = require('./types')(Block, codec)
  const commitKeyValueTransaction = async function * (_ops, root, get, conflictResolver = noResolver) {
    const rootBlock = await get(root)
    const kvt = types.Transaction.fromBlock(rootBlock)
    const blocks = (await Promise.all(_ops.map(async o => {
      if (o.val) o.val = await o.val
      return o
    }))).map(op => types.Operation.toBlock(op, codec))
    const seen = new Set()
    const keyMap = new Map()
    // hash in parallel
    await Promise.all(blocks.map(b => b.cid()))
    for (const block of blocks) {
      const cid = await block.cid()
      const cidString = cid.toString('base64')

      // remove duplicate ops
      if (seen.has(cidString)) continue
      else seen.add(cidString)

      // resole any conflicts over the same key
      const op = block.decodeUnsafe()
      const key = op[Object.keys(op)[0]].key
      if (keyMap.has(key)) {
        keyMap.set(key, conflictResolver(keyMap.get(key), block))
      } else {
        keyMap.set(key, block)
      }
    }

    const head = kvt.get('v1/head')

    for (const block of keyMap.values()) {
      yield block
      const op = block.decodeUnsafe()
      if (op.set) {
        head[op.set.key] = op.set.value
      } else if (op.del) {
        delete head[op.del.key]
      } else {
        throw new Error('Unknown operation' + JSON.stringify(op))
      }
    }
    const ops = await Promise.all(Array.from(keyMap.values()).map(block => block.cid()))
    yield types.Transaction.toBlock({ v1: { head, ops, prev: await rootBlock.cid() } })
  }

  const isBlock = v => Block.isBlock(v)

  class Transaction {
    constructor () {
      this.ops = []
    }

    set (key, block) {
      const val = block.cid()
      this.ops.push({ set: { key, val } })
    }

    del (key) {
      this.ops.push({ del: { key } })
    }
  }

  class KeyValueDatabase {
    constructor (root, store) {
      this.root = root
      this.rootTransaction = store.get(root).then(block => {
        return types.Transaction.fromBlock(block)
      })
      this.store = store
      this.cache = {}
    }

    async set (key, block) {
      // TODO: move this a queue/batch for perf
      if (!isBlock(block)) block = Block.encoder(block, codec)
      // TODO: check if new key/block are identical to old value
      const trans = new Transaction()
      trans.set(key, block)
      const promises = []
      let last
      for await (const block of this.commit(trans)) {
        last = block
        promises.push(this.store.put(block))
      }
      await Promise.all(promises)
      this.root = await last.cid()
    }

    async get (key) {
      const head = (await this.rootTransaction).get('v1/head')
      const value = block.decode()
      return value
    }

    commit (trans) {
      return commitKeyValueTransaction(trans.ops, this.root, this.store.get.bind(this.store))
    }
  }

  const empty = Block.encoder({ v1: { head: {}, ops: [], prev: null } }, codec)

  const exports = (...args) => new KeyValueDatabase(...args)
  exports.create = async store => {
    await store.put(empty)
    const root = await empty.cid()
    return new KeyValueDatabase(root, store)
  }
  return exports
}
