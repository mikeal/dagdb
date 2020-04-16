const { fromBlock, validate, readonly } = require('./utils')
const createKV = require('./kv')
const createStore = require('./store')
const hamt = require('./hamt')
const CID = require('cids')
const bent = require('bent')
const getJSON = bent('json')

module.exports = (Block, codec = 'dag-cbor') => {
  const toBlock = (value, className) => Block.encoder(validate(value, className), codec)
  const kv = createKV(Block, codec)
  const store = createStore(Block)

  class Remote {
    constructor (obj, db) {
      if (!obj.info) throw new Error('Missing remote info')
      let info
      if (CID.isCID(obj.info)) {
        info = db.store.get(obj.info).then(block => block.decodeUnsafe())
      } else {
        info = new Promise(resolve => resolve(info))
      }
      this.db = db
      this.info = info
      this.rootDecode = obj
      this.kv = db._kv
    }

    async pull () {
      const info = await this.info
      if (info.source === 'local') {
        throw new Error('Local remotes must use pullDatabase directly')
      }
      const resp = await getJSON(info.source)
      // TODO: validate response data against a schema
      const known = []
      const root = new CID(resp.root)
      if (this.rootDecode.head) {
        if (root.equals(this.rootDecode.head)) {
          return root // no changes since last merge
        }
        known.push(this.rootDecode.head)
        known.push(this.rootDecode.merged)
      }
      this.store = await store.from(resp.blockstore)
      const database = new Database(root, this.store)
      return this.pullDatabase(database, info.strategy, known)
    }

    async pullDatabase (database, known = []) {
      const kv = await this.kv
      const info = await this.info
      const strategy = info.strategy
      // istanbul ignore else
      if (strategy.full) {
        return this.fullMerge(kv, database, known)
      } else if (strategy.keyed) {
        return this.keyedMerge(kv, database, strategy.keyed, known)
      } else {
        throw new Error(`Unknown strategy '${JSON.stringify(strategy)}'`)
      }
    }

    async keyedMerge (kv, db, key, known = []) {
      if (!(await kv.has(key))) {
        return kv.set(key, db.root)
      }
      const prev = await kv.get(key)
      await prev.pull(kv, known)
      const latest = await prev.commit()
      kv.set(key, latest.root)
      this.rootDecode.head = await prev.getHead()
      this.rootDecode.merged = await kv.getHead()
    }

    async fullMerge (kv, db, known = []) {
      const remoteKV = await db._kv
      await kv.pull(remoteKV, known)
      this.rootDecode.head = await remoteKV.getHead()
      this.rootDecode.merged = null
    }

    async update (latest) {
      const trans = await this.db.store.get(latest)
      const head = trans.decode()['kv-v1'].head
      this.rootDecode.merged = head
      return toBlock(this.rootDecode, 'Remote')
    }
  }

  class Lazy {
    constructor (db) {
      const root = db.getRoot().then(root => root['db-v1'][this.prop])
      readonly(this, '_root', root)
      this.db = db
      this.pending = new Map()
      this.store = db.store
      this._get = db.store.get.bind(db.store)
    }
  }

  class Remotes extends Lazy {
    get prop () {
      return 'remotes'
    }

    async add (name, info) {
      const block = toBlock(info, 'RemoteInfo')
      await this.db.store.put(block)
      const remote = new Remote({ info: await block.cid() }, this.db)
      return this.pull(name, remote)
    }

    async addLocal (name, strategy) {
      const info = { strategy, source: 'local' }
      const block = toBlock(info, 'RemoteInfo')
      await this.db.store.put(block)
      const remote = new Remote({ info: await block.cid() }, this.db)
      this.pending.set(name, remote)
      return remote
    }

    async get (name) {
      const root = await this._root
      const cid = await hamt.get(root, name, this._get)
      const block = await this.db.store.get(cid)
      const decoded = fromBlock(block, 'Remote')
      return new Remote(decoded, this.db)
    }

    async pull (name, remote) {
      if (!remote) {
        remote = await this.get(name)
      }
      await remote.pull()
      this.pending.set(name, remote)
    }

    async update (latest) {
      if (!this.pending.size) return this._root
      const ops = []
      const promises = []
      for (const [key, remote] of this.pending.entries()) {
        // TODO: implement remote removal
        const block = await remote.update(latest)
        promises.push(this.db.store.put(block))
        ops.push({ set: { key, val: await block.cid() } })
      }
      let last
      const head = await this.db._kv.then(kv => kv.getHead())
      const get = this.db.store.get.bind(this.db.store)
      for await (const block of hamt.bulk(head, ops, get, Block, codec)) {
        last = block
        promises.push(this.db.store.put(block))
      }
      await Promise.all(promises)
      return last.cid()
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

    get _dagdb () {
      return { v1: 'database' }
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
      return new Database(await block.cid(), this.store)
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
  kv.register('database', exports)
  return exports
}
