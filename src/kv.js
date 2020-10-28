import * as hamt from 'hamt-utils'
import { NotFound, readonly, isCID, encoderTransaction } from './utils.js'
import { encoder as blockEncoder, fromBlock, toBlock } from './block.js'
import { encode, decode, register } from './values.js'
import { bytes } from 'multiformats'

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

const { toString } = bytes

const commitKeyValueTransaction = async function * (opBlocks, root, get) {
  const rootBlock = await get(root)
  const kvt = fromBlock(rootBlock, 'Transaction')

  const opLinks = []
  const opDecodes = []
  for (const op of opBlocks) {
    opDecodes.push(fromBlock(op, 'Operation'))
    opLinks.push(op.cid)
  }

  let last
  for await (const block of hamt.bulk(kvt['kv-v1'].head, opDecodes, get)) {
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

  const [head, ops, prev] = [last.cid, Promise.all(opLinks), rootBlock.cid]
  yield toBlock({ 'kv-v1': { head, ops, prev } }, 'Transaction')
  /* c8 ignore next */
}

const isBlock = v => v.asBlock === v

const commitTransaction = async function * (trans) {
  const root = trans.root
  const ops = []
  for (const [op, ...blocks] of trans.cache.values()) {
    ops.push(op)
    yield op
    yield * blocks
  }
  if (!ops.length) throw new Error('There are no pending operations to commit')
  yield * commitKeyValueTransaction(ops, root, trans.store.get.bind(trans.store))
}

class Transaction {
  constructor (root, store) {
    readonly(this, 'root', root)
    this.store = store
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
      const data = await this.store.get(root).then(block => block.value)
      const _ops = await Promise.all(data['kv-v1'].ops.map(cid => this.store.get(cid)))
      for (const op of _ops) {
        const decode = op.value
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
        if (isBlock(_block)) {
          if (opts.filter && !(await opts.filter(_block))) {
            // noop
          } else {
            await this.store.put(_block)
          }
        }
        last = _block
      }
      block = blockEncoder(last)
    }
    await this.store.put(block)
    return block
  }

  async link (block) {
    block = await this.__encode(block)
    const cid = block.cid
    return decode(cid, this.store, this.updater)
  }

  async set (key, block, opts = {}) {
    if (typeof block === 'undefined') {
      if (typeof key !== 'object') throw new Error('Missing value')
      return Promise.all(Object.entries(key).map(([key, value]) => this.set(key, value)))
    }
    block = await this.__encode(block, opts)
    const op = await toBlock({ set: { key, val: block.cid } }, 'Operation')
    this.cache.set(key, [op, block])
  }

  async pendingTransactions () {
    return Promise.all(Array.from(this.cache.values()).map(x => x[0].cid))
  }

  async del (key) {
    const op = await toBlock({ del: { key } }, 'Operation')
    this.cache.set(key, [op])
  }

  all (opts) {
    opts = { ...{ blocks: false, decode: true }, ...opts }
    const get = this.store.get.bind(this.store)
    const _decode = block => decode(block.value, this.store, this.updater)
    const iter = async function * (t) {
      const head = await t.getHead()
      for (const [key, [, block]] of t.cache.entries()) {
        if (!block) continue
        if (opts.decode) yield [key, _decode(block)]
        else if (opts.blocks) yield [key, block]
        else yield [key, block.cid]
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

  __get (key) {
    if (this.cache.has(key)) {
      const [, block] = this.cache.get(key)
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
    if (this.__get(key)) return this.__get(key)
    const head = await this.getHead()
    const link = await hamt.get(head, key, this.store.get.bind(this.store))
    if (!link) throw new NotFound(`No key named "${key}"`)
    const block = await this.store.get(link)

    // one last cache check since there was async work
    /* c8 ignore next */
    if (this.__get(key)) return this.__get(key)
    // workaround, fixed in Node.js v14.5.0
    /* c8 ignore next */
    return block
  }

  async get (key) {
    if (Array.isArray(key)) return Promise.all(key.map(k => this.get(k)))
    const block = await this.getBlock(key)
    return decode(block.value, this.store, this.updater)
  }

  async getRef (key) {
    const block = await this.__get(key)
    if (block) return block.cid
    const head = await this.getHead()
    const link = await hamt.get(head, key, this.store.get.bind(this.store))
    if (!link) throw new NotFound(`No key named "${key}"`)
    return link
  }

  async getValue (cid) {
    const block = await this.store.get(cid)
    return decode(block.value, this.store, this.updater)
  }

  async has (key) {
    if (this.cache.has(key)) {
      if (this.cache.get(key).length === 1) return false
      return true
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
    const pending = []
    const _commit = commitTransaction(this)
    let last
    for await (const block of _commit) {
      last = block
      pending.push(this.store.put(block))
    }
    await Promise.all(pending)
    return new Transaction(last.cid, this.store)
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
    // we need to make all the cached blocks accessible
    // to the resolver
    const _blocks = new Map()
    for (const [, block] of this.cache.values()) {
      if (block) _blocks.set(block.cid.toString('base64'), block)
    }
    const local = async cid => {
      const key = cid.toString('base64')
      if (_blocks.has(key)) return _blocks.get(key)
      return this.store.get(cid)
    }
    const remote = trans.store.get.bind(trans.store)
    const oldRoot = this.root
    const newRoot = trans.root
    const stackedGet = createGet(local, remote)
    const staged = await replicate(oldRoot, newRoot, stackedGet, resolver, known)
    // now merge the latest options for each key from the remote
    // into the local cache for the transaction
    for (const [key, [op, block]] of staged.entries()) {
      if (this.cache.has(key)) {
        const [old] = this.cache.get(key)
        const cid = old.cid
        if (cid.equals(op.cid)) continue
        const newOp = await resolver([old], [op], stackedGet)
        const decoded = newOp.value
        const value = [newOp]
        if (decoded.set) value.push(await stackedGet(decoded.set.val))
        this.cache.set(key, value)
      } else {
        const value = [op]
        // This is an odd one.
        // Arrays with values of undefined end up getting encoded as null
        // in the browser and not in some Node.js versions. This is easily
        // fixable below but it can't be tested effectively in Node.js
        // so we have to disable coverage until we have browser coverage working.
        // c8 ignore else
        if (block) value.push(block)
        this.cache.set(key, value)
      }
    }
  }
}

const noResolver = localOps => {
  const decoded = localOps[0].value
  const key = getKey(decoded)
  throw new Error(`Conflict, databases contain conflicting mutations to "${key}" since last common`)
}
const reconcile = async (oldOps, newOps, get, resolver) => {
  const lastId = ops => ops[ops.length - 1].cid.toString('base64')
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
    const accept = () => ops.set(key, newOps[newOps.length - 1])
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
    const ids = new Set(await Promise.all(newOps.map(block => block.cid.toString('base64'))))
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

  const find = async root => {
    const decoded = await fromBlock(root, 'Transaction')
    // should we validate the schema here or just wait for it to potentially fail?
    const { head, prev } = decoded['kv-v1']
    const key = head.toString('base64')
    if (seen.has(key)) return head
    seen.add(key)
    if (!prev) return null
    return find(await get(prev))
  }

  const race = async () => {
    const [old, latest] = await Promise.all([find(oldRoot), find(newRoot)])
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
    if (head.equals(common)) return _ops
    ops = ops.map(op => get(op))
    return since(await get(prev), [...ops, ..._ops])
  }

  const _all = root => since(root).then(ops => Promise.all(ops))

  const [oldOps, newOps] = await Promise.all([_all(oldRoot), _all(newRoot)])
  const ops = await reconcile(oldOps, newOps, get, resolver)
  const staged = new Map()
  for (const [key, op] of ops.entries()) {
    const decoded = op.value
    if (decoded.set) {
      staged.set(key, [op, await get(decoded.set.val)])
    } else {
      staged.set(key, [op])
    }
  }
  return staged
}

const emptyHamt = hamt.empty('dag-cbor')
const emptyData = { 'kv-v1': { head: emptyHamt.cid, ops: [], prev: null } }
const empty = toBlock(emptyData, 'Transaction') // returns a promise

const exports = (...args) => new Transaction(...args)
exports.empties = [empty, emptyHamt]
exports.create = async store => {
  const _empty = await empty
  await Promise.all([store.put(_empty), store.put(emptyHamt)])
  const root = _empty.cid
  return new Transaction(root, store)
}
register('transaction', exports)
exports.register = register

export default exports
