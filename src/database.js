const { fromBlock, validate, readonly } = require('./utils')
const createKV = require('./kv')
const createStores = require('./stores')
const createUpdaters = require('./updaters')
const createRemotes = require('./remotes')
const createIndexes = require('./indexes')
const CID = require('cids')

const databaseEncoder = async function * (db) {
  const kv = await db._kv
  if (kv.pending) throw new Error('Cannot use database with pending transactions as a value')
  // TODO: refactor to support encoding dirty databases
  // if you look at how .commit() is implemented in kv, it's
  // implemented as a generator and then flattened for the
  // .commit() method. that approach should be used here as well,
  // with all the commit() and latest() implementations below done as
  // generators that can be used by this encoder so that you can
  // use databases with pending transactions as values.
  yield db.root
}

module.exports = (Block) => {
  const toBlock = (value, className) => Block.encoder(validate(value, className), 'dag-cbor')
  const kv = createKV(Block)
  const stores = createStores(Block)
  const updaters = createUpdaters(Block)
  const remoteExports = createRemotes(Block, stores, toBlock, updaters, CID)
  const indexExports = createIndexes(Block, fromBlock, kv)
  const { Remotes, Remote } = remoteExports
  const { Indexes } = indexExports

  class Database {
    constructor (root, store, updater) {
      readonly(this, 'root', root)
      this.store = store
      this.updater = updater
      readonly(this, '_kv', this.getRoot().then(r => kv(r['db-v1'].kv, store)))
      this.remotes = new Remotes(this)
      this.indexes = new Indexes(this)
    }

    get _dagdb () {
      return { v1: 'database' }
    }

    get dirty () {
      return kv.pending
    }

    async commit () {
      let kv = await this._kv
      if (kv.pending) {
        kv = await kv.commit()
      }
      const root = await this.getRoot()
      root['db-v1'].kv = kv.root
      root['db-v1'].remotes = await this.remotes.update(kv.root)
      root['db-v1'].indexes = await this.indexes.update(kv.root)
      const block = toBlock(root, 'Database')
      await this.store.put(block)
      return new Database(await block.cid(), this.store, this.updater)
    }

    async getHead () {
      const kv = await this._kv
      return kv.getHead()
    }

    async pull (...args) {
      const kv = await this._kv
      return kv.pull(...args)
    }

    async get (...args) {
      const kv = await this._kv
      return kv.get(...args)
    }

    async set (...args) {
      const kv = await this._kv
      return kv.set(...args)
    }

    async del (...args) {
      const kv = await this._kv
      return kv.del(...args)
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
      await kv.pull(db)
    }

    encode () {
      return databaseEncoder(this)
    }

    async update (...args) {
      let latest = await this.commit()
      let prevRoot = this.root
      if (latest.root.equals(this.root)) {
        prevRoot = null
      }
      let current = await this.updater.update(latest.root, prevRoot)
      while (!latest.root.equals(current)) {
        await this.merge(new Database(current, this.store, this.updater))
        latest = await this.commit()
        current = await this.updater.update(latest.root, current, ...args)
      }
      return new Database(current, this.store, this.updater)
    }
  }

  remoteExports.Database = Database
  const exports = (...args) => new Database(...args)

  // empty database
  const empty = (async () => {
    const [kvBlock, hamtBlock] = await Promise.all(kv.empties)
    const [kvCID, hamtCID] = await Promise.all([kvBlock.cid(), hamtBlock.cid()])
    const [indexesBlock] = await Promise.all(indexExports.empties)
    const indexes = await indexesBlock.cid()
    return toBlock({ 'db-v1': { kv: kvCID, remotes: hamtCID, indexes } }, 'Database')
  })()
  exports.empties = [empty, ...kv.empties, ...indexExports.empties]
  exports.create = async (store, updater) => {
    const empties = await Promise.all(exports.empties)
    await Promise.all(empties.map(b => store.put(b)))
    const root = await empties[0].cid()
    await updater.update(root)
    return new Database(root, store, updater)
  }
  exports.Remote = Remote
  kv.register('database', exports)
  return exports
}
