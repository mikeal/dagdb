const { fromBlock, validate, readonly } = require('./utils')
const createKV = require('./kv')

module.exports = (Block, codec = 'dag-cbor') => {
  const toBlock = (value, className) => Block.encoder(validate(value, className), codec)
  const kv = createKV(Block, codec)

  const Lazy {
    constructor (db) {
      const root = db.getRoot().then(root => root[this.prop])
      readonly(this, '_root', root)
      const rootData = root.then(cid => db.store.get(db)).then(block => block.decode())
      readonly(this, 'data', rootData)
      this.db = db
    }
  }

  class Remotes extends Lazy {
    get prop () {
      return 'remotes'
    }
    async merge (db) {
      // TODO: handle merging remote refs
    }
  }
  class Indexes extends Lazy {
    get prop () {
      return 'indexes'
    }
    async merge (db) {
      // TODO: handle merging indexes
    }
  }

  class Database {
    constructor (root, store, updater) {
      readonly(this, 'root', root)
      this.store = store
      this.updater = updater
      readonly(this, '_kv', this.getRoot().then(r => kv(r['db-v1'].kv, store)))
      this.remotes = new Remotes(this)
      this.indexes = new Indexes(this)
    }

    async commit () {
      const kv = await this._kv
      const latest = await kv.commit()
      const root = await this.getRoot()
      root['db-v1'].kv = latest.root
      // TODO: overwrite with current remotes
      // TODO: overwrite with current indexes
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

    async merge (db) {
      const kv = await this._kv
      await kv.merge(await db._kv)
      await Promise.all([this.remotes.merge(db), this.indexes.merge(db)])
    }

    async update (...args) {
      let latest = await this.commit()
      if (latest.root.equals(this.root)) {
        throw new Error('No changes to update')
      }
      let current = await this.updater.update(latest.root, this.root)
      while (!latest.root.equals(current)) {
        await this.merge(new Database(current, this.store, this.updater))
        latest = await this.commit()
        current = await this.updater.update(latest.root, current, ...args)
      }
      return new Database(current, this.store, this.updater)
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
