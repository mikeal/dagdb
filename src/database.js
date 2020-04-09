const { fromBlock, validate, readonly } = require('./utils')
const createKV = require('./kv')

module.exports = (Block, codec = 'dag-cbor') => {
  const toBlock = (value, className) => Block.encoder(validate(value, className), codec)
  const kv = createKV(Block, codec)

  class Database {
    constructor (root, store, updater) {
      readonly(this, 'root', root)
      this.store = store
      this.updater = updater
      readonly(this, '_kv', this.getRoot().then(r => kv(r['db-v1'].kv, store)))
    }

    async commit () {
      const kv = await this._kv
      const latest = await kv.commit()
      const root = await this.getRoot()
      root['db-v1'].kv = latest.root
      const block = toBlock(root, 'Database')
      await this.store.put(block)
      return new Database(await block.cid(), this.store)
    }

    async get (...args) {
      const kv = await this._kv
      return kv.get(...args)
    }

    async set (...args) {
      const kv = await this._kv
      return kv.set(...args)
    }

    async link (...args) {
      const kv = await this._kv
      return kv.link(...args)
    }

    async getRoot () {
      if (!this._rootBlock) {
        readonly(this, '_rootBlock', this.store.get(this.root))
      }
      const block = await this._rootBlock
      return fromBlock(block, 'Database')
    }

    async info () {
      const kv = await this._kv
      return { size: await kv.size() }
    }

    async update (...args) {
      const newRoot = await this.updater.update(this, ...args)
      return new Database(newRoot, this.store, this.updater)
    }
  }

  const exports = (...args) => new Database(...args)

  // empty database
  const empty = (async () => {
    const [kvBlock, hamtBlock] = await Promise.all(kv.empties)
    const [kvCID, hamtCID] = await Promise.all([kvBlock.cid(), hamtBlock.cid()])
    return toBlock({ 'db-v1': { kv: kvCID, remotes: hamtCID, indexes: hamtCID } }, 'Database')
  })()
  exports.empties = [empty, ...kv.empties]
  exports.create = async store => {
    const empties = await Promise.all(exports.empties)
    await Promise.all(empties.map(b => store.put(b)))
    const root = await empties[0].cid()
    return new Database(root, store)
  }
  return exports
}
