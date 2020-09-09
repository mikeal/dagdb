import { Lazy } from './utils.js'
import * as hamt from './hamt.js'
import bent from 'bent'
import createReplicate from './stores/replicate.js'

const getJSON = bent('json')

export default (Block, stores, toBlock, updaters, CID) => {
  const replicate = createReplicate(Block)
  const exports = {}

  class Remote {
    constructor (obj, db) {
      this.db = db
      this.rootDecode = obj
      this.kv = db._kv
    }

    get info () {
      if (!this._info) {
        this._info = this.db.store.get(this.rootDecode.info).then(block => block.decodeUnsafe())
      }
      return this._info
    }

    async setStorage (info, resp) {
      let url = new URL(resp.blockstore, info.source)
      this.store = await stores.from(url.toString())
      if (resp.updater) {
        url = new URL(resp.updater, info.source)
        this.updater = await updaters.from(info.source, url.toString())
      }
    }

    async push () {
      const info = await this.info
      if (info.source === 'local') {
        throw new Error('Local remotes cannot push')
      }
      if (!info.strategy.full) {
        throw new Error('Can only push databases using full merge strategy')
      }
      const local = this.rootDecode.head
      const resp = await getJSON(info.source)
      if (!resp.updater) throw new Error('Remote must have updater to use push')
      const root = CID.from(resp.root)

      await this.setStorage(info, resp)

      const db = new exports.Database(root, this.store)
      const head = await db.getHead()
      if (!head.equals(local)) {
        throw new Error('Remote has updated since last pull, re-pull before pushing')
      }
      await replicate(this.db.root, this.db.store, this.store)
      const cid = await this.updater.update(this.db.root, root)
      if (!cid.equals(this.db.root)) {
        throw new Error('Remote has updated since last pull, re-pull before pushing')
      }
    }

    async pull () {
      const info = await this.info
      if (info.source === 'local') {
        throw new Error('Local remotes must use pullDatabase directly')
      }
      const resp = await getJSON(info.source)
      // TODO: validate response data against a schema
      const root = CID.from(resp.root)
      await this.setStorage(info, resp)
      const database = new exports.Database(root, this.store, this.updater)
      if (this.rootDecode.head) {
        if (this.rootDecode.head.equals(await database.getHead())) {
          return root // no changes since last merge
        }
      }
      return this.pullDatabase(database, info.strategy)
    }

    async pullDatabase (database) {
      const info = await this.info
      const strategy = info.strategy
      const known = []
      if (this.rootDecode.head) {
        known.push(this.rootDecode.head)
        known.push(this.rootDecode.merged)
      }
      let cids
      if (strategy.full) {
        cids = await this.fullMerge(database, known)
      } else if (strategy.keyed) {
        cids = await this.keyedMerge(database, strategy.keyed, known)
      } /* c8 ignore next */ else {
        /* c8 ignore next */
        throw new Error(`Unknown strategy '${JSON.stringify(strategy)}'`)
        /* c8 ignore next */
      }
      for (const cid of cids) {
        await replicate(cid, database.store, this.db.store)
      }
    }

    async keyedMerge (db, key, known) {
      const kv = await this.kv
      if (!(await kv.has(key))) {
        await kv.set(key, db)
      } else {
        const prev = await kv.get(key)
        const prevHead = await prev.getHead()
        const dbHead = await db.getHead()
        if (prevHead.equals(dbHead)) return []
        await prev.pull(db, known)
        const latest = await prev.commit()
        await kv.set(key, latest)
      }
      const latest = await kv.commit()
      this.rootDecode.head = await db.getHead()
      this.rootDecode.merged = await latest.getHead()
      return [latest.root]
    }

    async fullMerge (db, known) {
      const kv = await this.kv
      await kv.pull(db, known)
      this.rootDecode.head = await db.getHead()
      this.rootDecode.merged = null
      return kv.pendingTransactions()
    }

    async update (latest) {
      if (this.rootDecode.merged === null) {
        const trans = await this.db.store.get(latest)
        const head = trans.decode()['kv-v1'].head
        this.rootDecode.merged = head
      }
      return toBlock(this.rootDecode, 'Remote')
    }
  }

  class Remotes extends Lazy {
    get prop () {
      return 'remotes'
    }

    async add (name, info = {}) {
      if (typeof info === 'string') {
        info = { source: info }
      }
      const defaults = { strategy: { full: true } }
      info = { ...defaults, ...info }
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

    get (name) {
      return this._get(name, Remote, 'Remote')
    }

    async pull (name, remote) {
      if (!remote) {
        remote = await this.get(name)
      }
      await remote.pull()
      this.pending.set(name, remote)
    }

    push (name, ...args) {
      return this.get(name).then(r => r.push(...args))
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
      for await (const block of hamt.bulk(head, ops, get, Block)) {
        last = block
        promises.push(this.db.store.put(block))
      }
      await Promise.all(promises)
      return last.cid()
    }
  }

  exports.Remote = Remote
  exports.Remotes = Remotes
  return exports
}
