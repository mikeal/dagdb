const { fromBlock, validate, readonly } = require('./utils')
const createKV = require('./kv')

module.exports = (Block, codec = 'dag-cbor') => {
  const toBlock = (value, className) => Block.encoder(validate(value, className), codec)
  const kv = createKV(Block, codec)

  class Lazy {
    constructor (db) {
      const root = db.getRoot().then(root => root['db-v1'][this.prop])
      readonly(this, '_root', root)
      this.db = db
      this.pending = new Map()
      this.store = db.store
      this._get = db.store.bind(db)
    }
  }

  class Remotes extends Lazy {
    get prop () {
      return 'remotes'
    }

    async add (name, info) {
      const block = toBlock(info, 'RemoteInfo')
      const remote = new Remote(info)
      return this.pull(remote)
    }

    async get (name) {
      const block = await hamt.get(this.root, name, this._get)
      const decoded = fromBlock(block, 'Remote')
      return new Remote(decoded)
    }

    async pull (remote) {
      if (typeof remote === 'string') {
        remote = await this.get(remote)
      }
      throw new Error('left off here')
      const data = await this.data
      console.log(data)
    }

    async merge (db) {
      // TODO: handle merging remote refs
    }

    async commit () {
      const ops = {}
      for (const [key, block] of this.pending.entries()) {

      }
let last
          for await (const block of hamt.bulk(kvt['kv-v1'].head, opDecodes, get, Block, codec)) {
                  last = block
                  yield block
                }
      // TODO: implement commit process for remote refs
      return this._root
    }
  }
  class Indexes extends Lazy {
    get prop () {
      return 'indexes'
    }

    async update (latest) {
      // TODO: implement index update process
      return this._root
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
      let kv = await this._kv
      if (kv.pending) {
        kv = await kv.commit()
      }
      const root = await this.getRoot()
      root['db-v1'].kv = kv.root
      root['db-v1'].remotes = await this.remotes.commit()
      root['db-v1'].indexes = await this.indexes.update(kv.root)
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
      await kv.pull(await db._kv)
      await this.remotes.merge(db)
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
  exports.create = async (store, updater) => {
    const empties = await Promise.all(exports.empties)
    await Promise.all(empties.map(b => store.put(b)))
    const root = await empties[0].cid()
    await updater.update(root)
    return new Database(root, store, updater)
  }
  return exports
}
