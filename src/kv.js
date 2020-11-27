import * as hamt from './hamt.js'
import {
  NotFound, readonly, isCID,
  fromBlock, fromBlockUnsafe, validate,
  encoderTransaction
} from './utils.js'
import valueLoader from './values.js'
import createStaging from './stores/staging.js'

const getKey = decoded => decoded.set ? decoded.set.key : decoded.del.key

const createGet = (local, remote) => {
  const cache = new Map()
  const get = async cid => {
    if (!isCID(cid)) throw new Error('Must be CID')
    const key = cid.toString('base64')
    if (cache.has(key)) return cache.get(key)
    const _cache = (block) => cache.set(key, block)
    let ret
    try {
      ret = await local(cid)
    } catch (e) {
      // noop
    }
    if (ret) {
      _cache(ret)
      return ret
    }
    // final cache check, useful under concurrent load
    /* c8 ignore next */
    if (cache.has(key)) return cache.get(key)
    const block = await remote(cid)
    _cache(block)
    /* c8 ignore next */
    return block
  }
  return get
}

const create = (Block) => {
  const { encode, decode, register } = valueLoader(Block)
  const { toString } = Block.multiformats.bytes
  const toBlock = (value, className) => Block.encoder(validate(value, className), 'dag-cbor')
  const staging = createStaging(Block)

  const commitKeyValueTransaction = async function * (opBlocks, root, get) {
    const rootBlock = await get(root)
    const kvt = fromBlockUnsafe(rootBlock, 'Transaction')

    const opLinks = []
    const opDecodes = []
    for (const op of opBlocks) {
      opDecodes.push(fromBlock(op, 'Operation'))
      opLinks.push(op.cid())
    }

    let last
    for await (const block of hamt.bulk(kvt['kv-v1'].head, opDecodes, get, Block)) {
      last = block
      yield block
    }
    // this happens when there are bugs elsewhere so
    // it's not really possible to test for, but it's
    // an important guard because it protects us from
    // inserting an empty transaction head when there
    // are other bugs
    /* c8 ignore next */
    if (!last) throw new Error('nothing from hamt')

    const [head, ops, prev] = await Promise.all([last.cid(), Promise.all(opLinks), rootBlock.cid()])
    yield toBlock({ 'kv-v1': { head, ops, prev } }, 'Transaction')
    /* c8 ignore next */
  }

  const isBlock = v => Block.isBlock(v)

  const commitTransaction = async function * (trans) {
    const root = trans.root
    const ops = [...trans.cache.values()]
    if (!ops.length) throw new Error('There are no pending operations to commit')
    yield * commitKeyValueTransaction(ops, root, trans.store.get.bind(trans.store))
  }

  class Transaction {
    constructor (root, store) {
      readonly(this, 'root', root)
      this.store = staging(store) // default to inmemory staging area
      this.cache = new Map()
    }

    get pending () {
      return this.cache.size
    }

    async since (prev) {
      let root = this.root
      const ops = []
      const seen = new Set()
      while (!root.equals(prev)) {
        const data = await this.store.get(root).then(block => block.decodeUnsafe())
        const _ops = await Promise.all(data['kv-v1'].ops.map(cid => this.store.get(cid)))
        for (const op of _ops) {
          const decode = op.decodeUnsafe()
          const key = decode.set ? decode.set.key : decode.del.key
          if (!seen.has(key)) {
            ops.push(op)
          }
          seen.add(key)
        }
        root = data['kv-v1'].prev
      }
      return ops
    }

    async __encode (block, opts = {}) {
      if (!isBlock(block)) {
        let last
        for await (const _block of encode(block)) {
          if (Block.isBlock(_block)) {
            if (opts.filter && !(await opts.filter(_block))) {
              // noop
            } else {
              await this.store.put(_block)
            }
          }
          last = _block
        }
        block = Block.encoder(last, 'dag-cbor')
      }
      await this.store.put(block)
      return block
    }

    async link (block) {
      block = await this.__encode(block)
      const cid = await block.cid()
      return decode(cid, this.store, this.updater)
    }

    async set (key, block, opts = {}) {
      if (typeof block === 'undefined') {
        if (typeof key !== 'object') throw new Error('Missing value')
        return Promise.all(Object.entries(key).map(([key, value]) => this.set(key, value)))
      }
      block = await this.__encode(block, opts)
      const op = toBlock({ set: { key, val: await block.cid() } }, 'Operation')
      await this.store.put(op)
      this.cache.set(key, op)
    }

    async pendingTransactions () {
      return Promise.all(Array.from(this.cache.values()).map(x => x.cid()))
    }

    async del (key) {
      const op = toBlock({ del: { key } }, 'Operation')
      await this.store.put(op)
      this.cache.set(key, op)
    }

    all (opts) {
      opts = { ...{ blocks: false, decode: true }, ...opts }
      const get = this.store.get.bind(this.store)
      const _decode = block => decode(block.decode(), this.store, this.updater)
      const iter = async function * (t) {
        const head = await t.getHead()
        for (const [key, op] of t.cache.entries()) {
          const block = await __extract(op, get)
          if (!block) continue
          if (opts.decode) yield [key, _decode(block)]
          else if (opts.blocks) yield [key, block]
          else yield [key, await block.cid()]
        }
        const _iter = hamt.all(head, get)
        for await (let { key, value } of _iter) {
          key = toString(key)
          if (!t.cache.has(key)) {
            if (opts.decode) yield [key, _decode(await get(value))]
            else if (opts.blocks) yield [key, await get(value)]
            else yield [key, value]
          }
        }
      }
      return iter(this)
    }

    async __get (key) {
      if (this.cache.has(key)) {
        const block = await __extract(this.cache.get(key), this.store.get.bind(this.store))
        if (!block) throw new NotFound(`No key named "${key}"`)
        return block
      }
      return null
    }

    async getRootTransaction () {
      const root = await this.store.get(this.root)
      return fromBlock(root, 'Transaction')
    }

    async getBlock (key) {
      let cached = await this.__get(key)
      if (cached) return cached
      const head = await this.getHead()
      const link = await hamt.get(head, key, this.store.get.bind(this.store))
      if (!link) throw new NotFound(`No key named "${key}"`)
      const block = await this.store.get(link)

      // one last cache check since there was async work
      cached = await this.__get(key)
      /* c8 ignore next */
      if (cached) return cached
      // workaround, fixed in Node.js v14.5.0
      /* c8 ignore next */
      return block
    }

    async get (key) {
      if (Array.isArray(key)) return Promise.all(key.map(k => this.get(k)))
      const block = await this.getBlock(key)
      return decode(block.decode(), this.store, this.updater)
    }

    async getRef (key) {
      const block = await this.__get(key)
      if (block) return block.cid()
      const head = await this.getHead()
      const link = await hamt.get(head, key, this.store.get.bind(this.store))
      if (!link) throw new NotFound(`No key named "${key}"`)
      return link
    }

    async getValue (cid) {
      const block = await this.store.get(cid)
      return decode(block.decode(), this.store, this.updater)
    }

    async has (key) {
      if (this.cache.has(key)) {
        const op = this.cache.get(key)
        const decoded = op.decodeUnsafe()
        return decoded.del === undefined
      }
      const head = await this.getHead()
      const link = await hamt.get(head, key, this.store.get.bind(this.store))
      if (!link) return false
      return true
    }

    async size () {
      let i = 0
      const reader = this.all()
      while (true) {
        const { done } = await reader.next()
        if (done) return i
        i++
      } /* c8 ignore next */
    }

    async commit () {
      // Move all staged blocks into main
      this.store = await this.store.merge()
      const pending = []
      const _commit = commitTransaction(this)
      let last
      for await (const block of _commit) {
        // Force any remaining blocks into main. This leads to many
        // duplicate puts to our store, which isn't terrible, but is
        // inefficient if we can find cleanup where they all come from.
        pending.push(this.store.put(block, true))
        last = block
      }
      await Promise.all(pending)
      return new Transaction(await last.cid(), this.store)
    }

    _encode () {
      return commitTransaction(this)
    }

    encode () {
      if (!this.cache.size) return (async function * (r) { yield r })(this.root)
      return encoderTransaction(this._encode())
    }

    get _dagdb () {
      return { v1: 'transaction' }
    }

    async getHead () {
      const root = await this.getRootTransaction()
      return root['kv-v1'].head
    }

    async pull (trans, known = [], resolver = noResolver) {
      if (trans._kv) {
        return this.pull(await trans._kv, known, resolver)
      }
      const local = this.store.get.bind(this.store)
      const remote = trans.store.get.bind(trans.store)
      const oldRoot = this.root
      const newRoot = trans.root
      const stackedGet = createGet(local, remote)
      const staged = await replicate(oldRoot, newRoot, stackedGet, resolver, known)
      // now merge the latest options for each key from the remote
      // into the local cache for the transaction
      for (const [key, blocks] of staged.entries()) {
        let op
        for await (const block of blocks) {
          // Possible that we have already staged this
          await this.store.put(block)
          op = block
        }
        const pending = []
        if (this.cache.has(key)) {
          const old = this.cache.get(key)
          const cid = await old.cid()
          if (cid.equals(await op.cid())) continue
          let last
          for await (const b of resolver([old], [op], stackedGet)) {
            // Unlikely that we have already staged this
            pending.push(this.store.put(b))
            last = b
          }
          await Promise.all(pending)
          this.cache.set(key, last)
        } else {
          // Unlikely that we have already staged this
          await this.store.put(op)
          this.cache.set(key, op)
        }
      }
    }
  }

  const __extract = (op, get) => {
    const decoded = op.decodeUnsafe()
    if (decoded.set) {
      return get(decoded.set.val)
    }
    return null
  }

  const noResolver = localOps => {
    const decoded = localOps[0].decodeUnsafe()
    const key = getKey(decoded)
    throw new Error(`Conflict, databases contain conflicting mutations to "${key}" since last common`)
  }
  const reconcile = async (oldOps, newOps, get, resolver) => {
    const lastId = ops => ops[ops.length - 1].cid().then(cid => cid.toString('base64'))
    const staging = new Map()
    let i = 0
    const add = block => {
      const decoded = fromBlock(block, 'Operation')
      const key = getKey(decoded)
      if (!staging.has(key)) {
        staging.set(key, [[], []])
      }
      const ops = staging.get(key)[i]
      ops.push(block)
    }
    oldOps.forEach(add)
    i = 1
    newOps.forEach(add)

    const ops = new Map()

    for (const [key, [oldOps, newOps]] of staging.entries()) {
      const accept = () => {
        const last = newOps[newOps.length - 1]
        ops.set(key, [__extract(last, get), last])
      }
      // ignore keys that only have local history
      if (!newOps.length) continue
      // accept right away if there are no local changes to conflict with
      if (!oldOps.length) {
        accept()
        continue
      }
      // check if that last ops match and if so, ignore this key since the
      // both already have the same value
      const last = await lastId(oldOps)
      if (last === await lastId(newOps)) continue
      // if the last local operation exists anywhere in the history
      // of the new ops then we can take that as a common history
      // point and accept the latest change from the remote
      const ids = new Set(await Promise.all(newOps.map(block => block.cid().then(cid => cid.toString('base64')))))
      if (ids.has(last)) {
        accept()
        continue
      }
      // there's a conflict, pass it to the resolver
      ops.set(key, resolver(oldOps, newOps, get))
    }
    return ops
  }

  const replicate = async (oldRoot, newRoot, get, resolver, known) => {
    oldRoot = await get(oldRoot)
    newRoot = await get(newRoot)
    const seen = new Set(known.map(cid => cid.toString('base64')))

    const find = root => {
      const decoded = fromBlock(root, 'Transaction')
      // should we validate the schema here or just wait for it to potentially fail?
      const { head, prev } = decoded['kv-v1']
      const key = head.toString('base64')
      if (seen.has(key)) return head
      seen.add(key)
      if (!prev) return null
      return get(prev).then(block => find(block))
    }

    const race = async () => {
      const [old, latest] = [find(oldRoot), find(newRoot)]
      const common = await Promise.race([old, latest])
      // TODO: cancel slower one
      if (common) return common
      else {
        const r = (await Promise.all([old, latest])).filter(x => x)[0]
        return r
      }/* c8 ignore next */
    }

    const common = await race()
    if (!common) throw new Error('No common root between databases')

    const since = async (trans, _ops = []) => {
      const decoded = fromBlock(trans, 'Transaction')
      let { head, prev, ops } = decoded['kv-v1']
      ops = ops.map(op => get(op))
      if (head.equals(common)) {
        return [...ops, ..._ops]
      }
      return since(await get(prev), [...ops, ..._ops])
    }

    const _all = root => since(root).then(ops => Promise.all(ops))

    const [oldOps, newOps] = await Promise.all([_all(oldRoot), _all(newRoot)])
    return reconcile(oldOps, newOps, get, resolver)
  }

  const emptyHamt = hamt.empty(Block, 'dag-cbor')
  const emptyData = emptyHamt.cid().then(head => ({ 'kv-v1': { head, ops: [], prev: null } }))
  const empty = emptyData.then(data => toBlock(data, 'Transaction'))

  const exports = (...args) => new Transaction(...args)
  exports.empties = [empty, emptyHamt]
  exports.create = async store => {
    const _empty = await empty
    await Promise.all([store.put(_empty), store.put(emptyHamt)])
    const root = await _empty.cid()
    return new Transaction(root, store)
  }
  register('transaction', exports)
  exports.register = register
  return exports
}

create.createGet = createGet
export default create
