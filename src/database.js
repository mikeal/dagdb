const { fromBlock, validate, readonly } = require('./utils')
const createKV = require('./kv')

module.exports = (Block, codec = 'dag-cbor') => {
  const toBlock = (value, className) => Block.encoder(validate(value, className), codec)
  const kv = createKV(Block, codec)

  class Database {
    constructor (root, store) {
      this.root = root
      this.store = store
      readonly(this, '_kv', this.getRoot().then(root => kv(root['db-v1'].kv, store)))
    }

    kv () { return this._kv }

    async _getRoot () {
      if (!this._rootBlock) {
        this._rootBlock = this.store.get(this.root)
      }
      const block = await this._rootBlock
      return fromBlock(block, 'Database')
    }

    getRoot () {
      if (!this._rootDecode) this._rootDecode = this._getRoot()
      return this._rootDecode
    }

    async info () {
      const [kv, remotes, indexes] = Promise.all([this.kv(), this.remotes(), this.indexes()])
      const [kSize, rSize, iSize] = Promise.all([kv.size(), remotes.size(), indexes.size()])
      return { kv, remotes, indexes, kSize, rSize, iSize }
    }

    get (...args) {
      return this._kv.then(kv => kv.get(...args))
    }

    set (...args) {
      return this._kv.then(kv => kv.set(...args))
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

  exports.open = (root, store) => new Database(root, store)
  exports.create = async store => {
    await Promise.all(exports.empties.map(p => p.then(block => store.put(block))))
    const root = await empty.cid()
    return new Database(root, store)
  }
  return exports
}
