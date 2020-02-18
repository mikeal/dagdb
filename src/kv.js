
module.exports = (Block, codec='dag-cbor') => {
  const commitKeyValueTransaction = async function * (_ops, root, get) {
    const rootBlock = await get(root)
    const kvt = types.KeyValueTransaction.decoder(rootBlock)
    const ops = await Promise.all(_ops.map(async o => {
      if (o.val) o.val = await o.val
      return o
    }))
    const kv = await kvt.getNode('head')
    let last
    for await (const block of kv.commit(opts)) {
      yield block
      last = block
    }
    yield types.KeyValueTransaction.toBlock({ ops, prev: root, head: last })
  }

  const isBlock = v => Block.isBlock(v)

  class Transaction {
    constructor () {
      this.ops = []
    }
    set (key, block) {
      const val = block.cid()
      this.ops.push({op: 'set', val})
    }
    del (key) {
      this.ops.push({op: 'del', key})
    }
  }

  class KeyValueDatabase {
    constructor (root, store) {
      this.root = root
      this.store = store
      this.cache = {}
    }
    async set (key, block) {
      // TODO: move this a queue/batch for perf
      if (!isBlock(block)) block = Block.encoder(block, codec)
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
      const block = TODO
      const value = block.decode()
      value._rev = await block.cid()
      value._id = key
      return value
    }
    commit (trans) {
      return commitKeyValueTransaction(trans.ops, this.root, this.store.get.bind(this.store))
    }
  }

  const empty = Block.encoder({type: 'kv-v1', db: {}}, codec)

  const exports = (...args) => new KeyValueDatabase(...args)
  exports.create = async store =>  {
    await store.put(empty)
    const root = await empty.cid()
    return new KeyValueDatabase(root, store)
  }
  return exports
}
