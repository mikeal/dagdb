const hamt = require('./hamt')
const {
  NotFound, readonly, isCID,
  fromBlock, validate,
  encoderTransaction
} = require('./utils')
const valueLoader = require('./values')
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
    // istanbul ignore next
    if (cache.has(key)) return cache.get(key)
    const block = await remote(cid)
    _cache(block)
    return block
  }
  return get
}

module.exports = (Block, codec = 'dag-cbor') => {
  const { encode, decode, register } = valueLoader(Block, codec)
  const toBlock = (value, className) => Block.encoder(validate(value, className), codec)

  const commitKeyValueTransaction = async function * (opBlocks, root, get) {
    const rootBlock = await get(root)
    const kvt = fromBlock(rootBlock, 'Transaction')

    const opLinks = []
    const opDecodes = []
    for (const op of opBlocks) {
      opDecodes.push(fromBlock(op, 'Operation'))
      opLinks.push(op.cid())
    }

    let last
    for await (const block of hamt.bulk(kvt['kv-v1'].head, opDecodes, get, Block, codec)) {
      last = block
      yield block
    }
    // this happens when there are bugs elsewhere so
    // it's not really possible to test for, but it's
    // an important guard because it protects us from
    // inserting an empty transaction head when there
    // are other bugs
    // istanbul ignore next
    if (!last) throw new Error('nothing from hamt')

    const [head, ops, prev] = await Promise.all([last.cid(), Promise.all(opLinks), rootBlock.cid()])
    yield toBlock({ 'kv-v1': { head, ops, prev } }, 'Transaction')
  }

  const isBlock = v => Block.isBlock(v)

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

  class KV {
    constructor (root, store) {
      readonly(this, 'root', root)
      this.store = store
      this.cache = new Map()
    }

    async set (key, block) {
      const encoderBlocks = []
      if (!isBlock(block)) {
        for await (const _block of encode(block)) {
          encoderBlocks.push(_block)
        }
        block = Block.encoder(encoderBlocks.pop(), codec)
      }
      const op = toBlock({ set: { key, val: await block.cid() } }, 'Operation')
      this.cache.set(key, [op, block, ...encoderBlocks])
    }

    async del (key) {
      const op = toBlock({ del: { key } }, 'Operation')
      this.cache.set(key, [op])
    }

    all (opts) {
      opts = { ...{ blocks: false }, ...opts }
      const get = this.store.get.bind(this.store)
      const iter = async function * (t) {
        const head = await t.getHead()
        for (const [key, [, block]] of t.cache.entries()) {
          if (!block) continue
          if (opts.blocks) yield [key, block]
          else yield [key, await block.cid()]
        }
        const _iter = hamt.all(head, get)
        for await (let { key, value } of _iter) {
          key = key.toString()
          if (!t.cache.has(key)) {
            if (opts.blocks) yield [key, await get(value)]
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
      // istanbul ignore next
      if (this.__get(key)) return this.__get(key)
      return block
    }

    async get (key) {
      const block = await this.getBlock(key)
      return decode(block.decode(), this.store)
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
      }
    }
  }

  class Transaction extends KV {
    get _dagdb () {
      return { v1: 'transaction' }
    }

    encode () {
      if (!this.cache.size) return (async function * (r) { yield r })(this.root)
      return encoderTransaction(commitTransaction(this))
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
      return new Transaction(await last.cid(), this.store)
    }

    async getHead () {
      const root = await this.getRootTransaction()
      return root['kv-v1'].head
    }

    async pull (trans, resolver = noResolver) {
      // we need to make all the cached blocks accessible
      // to the resolver
      const _blocks = new Map()
      for (const [, block] of this.cache.values()) {
        if (block) _blocks.set(await block.cid().then(cid => cid.toString('base64')), block)
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
      const staged = await replicate(oldRoot, newRoot, stackedGet, resolver)
      // now merge the latest options for each key from the remote
      // into the local cache for the transaction
      for (const [key, [op, block]] of staged.entries()) {
        if (this.cache.has(key)) {
          const [old] = this.cache.get(key)
          const cid = await old.cid()
          if (cid.equals(await op.cid())) continue
          const newOp = await resolver([old], [op], stackedGet)
          const decoded = newOp.decodeUnsafe()
          const value = [newOp]
          if (decoded.set) value.push(await stackedGet(decoded.set.val))
          this.cache.set(key, value)
        } else {
          this.cache.set(key, [op, block])
        }
      }
    }
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

  const replicate = async (oldRoot, newRoot, get, resolver) => {
    oldRoot = await get(oldRoot)
    newRoot = await get(newRoot)
    const seen = new Set()

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
        return (await Promise.all([old, latest])).filter(x => x)[0]
      }
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
      const decoded = op.decodeUnsafe()
      if (decoded.set) {
        staged.set(key, [op, await get(decoded.set.val)])
      } else {
        staged.set(key, [op])
      }
    }
    return staged
  }

  const emptyHamt = hamt.empty(Block, codec)
  const emptyData = emptyHamt.cid().then(head => ({ 'kv-v1': { head, ops: [], prev: null } }))
  const empty = emptyData.then(data => toBlock(data, 'Transaction'))

  const exports = (...args) => new Transaction(...args)
  exports.KV = KV
  exports.empties = [empty, emptyHamt]
  exports.create = async store => {
    const _empty = await empty
    await Promise.all([store.put(_empty), store.put(emptyHamt)])
    const root = await _empty.cid()
    return new Transaction(root, store)
  }
  register('transaction', exports)
  return exports
}
module.exports.createGet = createGet
