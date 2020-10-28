import { toBlock } from './blocks.js'
import { Lazy } from './utils.js'
import * as hamt from 'hamt-utils'
import bent from 'bent'
import replicate from './stores/replicate.js'
import stores from './stores/index.js'
import updaters from './updaters/index.js'
import { CID } from 'multiformats'

const getJSON = bent('json')

const registry = { }

const http = async (info, push = true) => {
  const resp = await getJSON(info.url)
  if (push && !resp.updater) throw new Error('Remote must have updater to use push')
  let root
  if (resp.root) root = CID.from(resp.root)
  let url = new URL(resp.blockstore, info.url)
  const store = await stores.from(url.toString())
  let updater
  if (resp.updater) {
    url = new URL(resp.updater, info.url)
    updater = await updaters.from(info.url, url.toString())
  }
  return { store, updater, root }
}

class Remote {
  constructor (obj, db) {
    this.db = db
    this.rootDecode = obj
    this.kv = db._kv
  }

  get info () {
    if (!this._info) {
      this._info = this.db.store.get(this.rootDecode.info).then(block => block.value)
    }
    return this._info
  }

  async push () {
    const info = await this.info
    if (info.source.type === 'local') {
      throw new Error('Local remotes cannot push')
    }
    if (!info.strategy.full) {
      throw new Error('Can only push databases using full merge strategy')
    }
    const local = this.rootDecode.head

    const { store, updater, root } = await registry[info.source.type](info.source, true)

    const db = new exports.Database(root, store)
    const head = await db.getHead()
    if (!head.equals(local)) {
      throw new Error('Remote has updated since last pull, re-pull before pushing')
    }
    await replicate(this.db.root, this.db.store, store)
    const cid = await updater.update(this.db.root, root)
    if (!cid.equals(this.db.root)) {
      throw new Error('Remote has updated since last pull, re-pull before pushing')
    }
  }

  async pull () {
    const info = await this.info
    if (info.source.type === 'local') {
      throw new Error('Local remotes must use pullDatabase directly')
    }
    const { store, updater, root } = await registry[info.source.type](info.source, false)

    const database = new exports.Database(root, store, updater)
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
      const head = trans.value['kv-v1'].head
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
      if (info.startsWith('http://') || /* c8 ignore next */ info.startsWith('https://')) {
        info = { type: 'http', url: info }
      } else {
        throw new Error('Only http URL can be used as strings')
      }
      info = { source: info }
    }
    const defaults = { strategy: { full: true } }
    info = { ...defaults, ...info }
    const block = await toBlock(info, 'RemoteInfo')
    await this.db.store.put(block)
    const remote = new Remote({ info: block.cid }, this.db)
    return this.pull(name, remote)
  }

  async addLocal (name, strategy = { full: true }) {
    const info = { strategy, source: { type: 'local' } }
    const block = await toBlock(info, 'RemoteInfo')
    await this.db.store.put(block)
    const remote = new Remote({ info: block.cid }, this.db)
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
      ops.push({ set: { key, val: block.cid } })
    }
    let last
    const head = await this.db._kv.then(kv => kv.getHead())
    const get = this.db.store.get.bind(this.db.store)
    for await (const block of hamt.bulk(head, ops, get)) {
      last = block
      promises.push(this.db.store.put(block))
    }
    await Promise.all(promises)
    return last.cid
  }
}

const register = (name, fn) => { registry[name] = fn }
register('http', http)

export { register, Remote, Remotes }
