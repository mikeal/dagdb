const schema = require('./schema.json')
const validate = require('ipld-schema-validation')(schema)
const fromBlock = (block, className) => validate(block.decode(), className)
const hamt = require('./hamt')
const isCID = require('./is-cid')

const readonly = (source, key, value) => {
  Object.defineProperty(source, key, { value, writable: false })
}

const noResolver = () => {
  throw new Error('Operation conflict and no resolver has been provided')
}

class NotFound extends Error {
  get status () {
    return 404
  }

  get kvs () {
    return 'notfound'
  }
}

const createGet = (local, remote) => {
  const cache = new Map()
  const _cache = (key, block) => cache.set(key, block)
  const get = async cid => {
    if (cid.decodeUnsafe) throw new Error('here')
    const key = cid.toString('base64')
    if (cache.has(key)) return cache.get(key)
    let ret
    try {
      ret = await local(cid)
    } catch (e) {
      // noop
    }
    if (ret) {
      _cache(await ret.cid(), ret)
      return ret
    }
    if (cache.has(key)) return cache.get(key)
    const block = await remote(cid)
    _cache(key, block)
    return block
  }
  return get
}

module.exports = (Block, codec = 'dag-cbor') => {
  const toBlock = (value, className) => Block.encoder(validate(value, className), codec)

  const commitKeyValueTransaction = async function * (opBlocks, root, get, conflictResolver = noResolver) {
    const rootBlock = Block.isBlock(root) ? root : await get(root)
    const kvt = validate(rootBlock.decode(), 'Transaction')
    const seen = new Set()
    const keyMap = new Map()
    // hash in parallel
    for (const block of opBlocks) {
      const cid = await block.cid()
      const cidString = cid.toString('base64')

      // remove duplicate ops
      if (seen.has(cidString)) continue
      else seen.add(cidString)

      // resole any conflicts over the same key
      const op = block.decodeUnsafe()
      const key = op[Object.keys(op)[0]].key
      if (keyMap.has(key)) {
        keyMap.set(key, conflictResolver(keyMap.get(key), block))
      } else {
        keyMap.set(key, block)
      }
    }

    const head = kvt.v1.head

    console.log({ops: Array.from(keyMap.values())})
    let last
    for await (const block of hamt.bulk(Block, get, head, keyMap.values(), codec)) {
      last = block
      yield block
    }
    const ops = await Promise.all(Array.from(keyMap.values()).map(block => block.cid()))
    if (!last) throw new Error('nothing from hamt')
    console.error({last, rootBlock})
    yield toBlock({ v1: { head: await last.cid(), ops, prev: await rootBlock.cid() } }, 'Transaction')
  }

  const isBlock = v => Block.isBlock(v)

  class KeyValueTransaction {
    constructor (root, store) {
      readonly(this, 'root', root)
      this.store = store
      this.cache = new Map()
    }

    async set (key, block) {
      if (this.spent) throw new Error('Transaction already commited')
      if (!isBlock(block)) block = Block.encoder(block, codec)
      const op = toBlock({ set: { key, val: await block.cid() }}, 'Operation')
      this.cache.set(key, [op, block])
    }

    async del (key) {
      if (this.spent) throw new Error('Transaction already commited')
      const op = toBlock({ del: { key } }, 'Operation')
      this.cache.set(key, [op])
    }

    commit () {
      if (this.spent) return this.spent
      readonly(this, 'spent', this._commit())
      return this.spent
    }

    async _commit () {
      const root = this.root
      const ops = []
      const pending = []
      for (const [op, block] of this.cache.values()) {
        ops.push(op)
        pending.push(this.store.put(op))
        if (block) pending.push(this.store.put(block))
      }
      if (!ops.length) throw new Error('There are no pending operations to commit')
      const _commit = commitKeyValueTransaction(ops, root, this.store.get.bind(this.store))
      let last
      for await (const block of _commit) {
        last = block
        pending.push(this.store.put(block))
      }
      await Promise.all([...pending])
      return last.cid()
    }

    __get (key) {
      if (this.cache.has(key)) {
        const [ , block] = this.cache.get(key)
        if (!block) throw new NotFound(`No key named "${key}"`)
        return block
      }
      return null
    }

    async getBlock (key) {
      if (this.__get(key)) return this.__get(key)
      const root = await this.store.get(this.root)
      const head = root.decode().v1.head
      const link = await hamt.get(head, key, this.store.get.bind(this.store))
      if (!link) throw new NotFound(`No key named "${key}"`)
      const block = await this.store.get(link)

      // one last cache check since there was async work
      if (this.__get(key)) return this.__get(key)
      return block
    }

    async get (key) {
      const block = await this.getBlock(key)
      return block.decode()
    }

    async pull (trans, reconcile, conflictResolve) {
      const local = this.store.get.bind(this.store)
      const remote = trans.store.get.bind(trans.store)
      const oldRoot = this.root
      const newRoot = trans.root
      const replicator = replicate(oldRoot, newRoot, local, remote, reconcile, conflictResolve)
      for await (const block of replicator) {
        await this.store.put(block)
      }
    }
  }

  const dedupe = async (oldOps, newOps) => {
    const ops = new Map()
    const seen = new Set()
    const blocks = oldOps.concat(newOps)
    const keys = await Promise.all(blocks.map(b => b.cid()))
    for (const block of blocks) {
      const id = keys.shift().toString('base64')
      if (seen.has(id)) continue
      seen.add(id)
      const decoded = block.decodeUnsafe()
      const key = decoded.set ? decoded.set.key : decoded.del.key
      if (ops.has(key)) throw new Error(`Conflict, concurrent over-writes of the same key "${key}"`)
      ops.set(key, block)
    }
    return ops.values()
  }

  const replicate = async function * (oldRoot, newRoot, local, remote,
    reconcile = dedupe, conflictResolver = noResolver) {
    // pushes newRoot (source) to destination's oldRoot
    const get = createGet(local, remote)

    if (isCID(oldRoot)) oldRoot = await get(oldRoot)
    if (isCID(newRoot)) newRoot = await get(newRoot)
    const seen = new Set()

    const find = root => {
      const decoded = root.decodeUnsafe()
      // should we validate the schema here or just wait for it to potentially fail?
      const { head, prev } = decoded.v1
      const key = head.toString('base64')
      if (seen.has(key)) return head
      seen.add(key)
      return get(prev).then(block => find(block))
    }

    const common = await Promise.race([find(oldRoot), find(newRoot)])

    const since = async (trans, _head, _ops = new Map()) => {
      const decoded = trans.decodeUnsafe()
      const { head, prev, ops } = decoded.v1
      if (head.equals(_head)) return _ops
      for (const op of ops) {
        const key = op.set ? op.set.key : op.del.key
        if (!_ops.has(key)) _ops.set(key, get(op))
      }
      return since(await get(prev), head, _ops)
    }

    const _all = root => since(root, common).then(ops => Promise.all(Array.from(ops.values())))

    const [oldOps, newOps] = await Promise.all([_all(oldRoot), _all(newRoot)])
    const ops = Array.from(await reconcile(oldOps, newOps))

    for await (const block of commitKeyValueTransaction(ops, oldRoot, get, conflictResolver)) {
      yield block
    }
    // TODO: remove older mutations on the same key from the each op set
    throw new Error('unfinished')
  }

  const emptyHamt = hamt.empty(Block, codec)
  const emptyData = async () => ({ v1: { head: await emptyHamt.cid(), ops: [], prev: null } })
  const empty = (async () => toBlock(await emptyData(), 'Transaction'))()

  const KVT = KeyValueTransaction
  const exports = (...args) => new KVT(...args)
  exports.create = async store => {
    const _empty = await empty
    await Promise.all([store.put(_empty), store.put(emptyHamt)])
    const root = await _empty.cid()
    return new KeyValueTransaction(root, store)
  }
  exports.transaction = (root, store) => new KVT(root, store)
  exports.replicate = replicate
  return exports
}
