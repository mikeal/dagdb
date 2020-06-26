const { validate, chain } = require('./utils')
const hamt = require('./hamt')

// We need singletons on instances for things you can only get async.
// The only good way to do that is by caching the promises and only
// creating those promises when the properties are accessed so that
// any exceptions can propogate to the first bit of code that awaits
// on them.
const lazyprop = (obj, name, fn) => {
  const writable = false
  const get = () => {
    const n = `_${name}`
    if (!obj[n]) Object.defineProperty(obj, n, { value: fn(), writable })
    return obj[n]
  }
  Object.defineProperty(obj, name, { get })
}

module.exports = (Block, fromBlock, kv) => {
  const toBlock = (value, className) => Block.encoder(validate(value, className), 'dag-cbor')
  const emptyHamt = hamt.empty(Block, 'dag-cbor')

  const emptyProp = emptyHamt.cid().then(map => toBlock({ count: 0, sum: 0, map }, 'PropIndex'))
  const exports = {}

  const updatePropIndex = async function * (prop, ops) {
    if (prop.updated) throw new Error('Index has already been updated')
    prop.updated = true
    const root = await prop.rootData
    const kvdb = await prop.props.getKV()
    const getBlock = prop.getBlock
    const hamtRoot = root.map
    const path = prop.name.split('/').filter(x => x)

    let keys = Array.from(new Set(ops.map(op => op.set ? op.set.key : op.del.key)))

    const has = await Promise.all(keys.map(key => hamt.has(hamtRoot, key, getBlock)))
    keys = new Set(keys.filter((v, i) => has[i]))

    root.count -= keys.size

    const updates = []
    for (const op of ops) {
      const _del = async key => {
        // lookup prior resolved value for this key
        const value = await hamt.get(hamtRoot, key, getBlock)
        if (typeof value === 'undefined') return // not in index
        if (typeof value === 'number') {
          root.sum -= value
        }
        updates.push({ del: { key } }) // remove it from the index
      }
      if (op.set) {
        const { key, val } = op.set
        let value = await kvdb.getValue(val)
        const lookup = [...path]
        while (lookup.length && typeof value[lookup[0]] !== 'undefined') {
          value = value[lookup.shift()]
          if (typeof value === 'function') value = await value()
        }
        if (lookup.length) {
          if (keys.has(key)) {
            await _del(key)
          }
          continue
        }
        root.count += 1
        if (typeof value === 'number') {
          root.sum += value
        }
        // TODO: property encode value to handle links
        updates.push({ set: { key, val: value } })
      } else {
        await _del(op.del.key)
      }
    }
    if (!updates.length) {
      prop.newRootBlock = await getBlock(root.map)
      return
    }
    let last
    for await (const block of hamt.bulk(hamtRoot, updates, getBlock, Block)) {
      yield block
      last = block
    }
    root.map = await last.cid()
    const newRootBlock = toBlock(root, 'PropIndex')
    yield newRootBlock
    prop.newRootBlock = newRootBlock
  }

  class Prop {
    constructor (props, root, name) {
      chain(this, props)
      this.root = root.then ? root : new Promise(resolve => resolve(root))
      lazyprop(this, 'rootBlock', () => this.root.then(cid => this.getBlock(cid)))
      lazyprop(this, 'rootData', () => this.rootBlock.then(block => block.decode()))
      this.name = name
      this.props = props
    }

    updateIndex (ops) {
      return updatePropIndex(this, ops)
    }

    async update (ops) {
      let root = await this.root
      const blocks = []
      ops = ops.map(op => op.decodeUnsafe())
      let prop = this
      if (this.newRootBlock) {
        if (!ops.length) return this.newRootBlock.cid()
        root = await this.newRootBlock.cid()
        prop = new Prop(this.props, root, this.name)
      }
      for await (const block of prop.updateIndex(ops)) {
        blocks.push(block)
      }
      if (!blocks.length) {
        return root
      }
      await Promise.all(blocks.map(b => this.store.put(b)))
      return blocks.pop().cid()
    }
  }
  Prop.create = (props, name) => {
    const prop = new Prop(props, emptyProp.then(block => block.cid()), name)
    prop._rootData = emptyProp.then(block => block.decode())
    return prop
  }

  class Props {
    constructor (indexes) {
      chain(this, indexes)
      this.indexes = indexes
      lazyprop(this, 'root', () => indexes.rootData.then(data => data.props))
      lazyprop(this, 'rootBlock', () => this.root.then(cid => this.getBlock(cid)))
      lazyprop(this, 'rootData', () => this.rootBlock.then(block => block.decode()))
      this.pending = new Map()
    }

    async _get (name) {
      const root = await this.rootData
      if (!root[name]) throw new Error(`No property index for "${name}"`)
      return new Prop(this, root[name], name)
    }

    async getKV () {
      const db = this.indexes.db
      const head = (await db.getRoot())['db-v1'].kv
      const kvdb = kv(head, db.store)
      return kvdb
    }

    async add (name) {
      if (this.dirty) throw new Error('Cannot create new index with pending KV transactions, commit or update.')
      // TODO: check if already added and throw
      const prop = Prop.create(this, name)
      const kvdb = await this.getKV()
      const ops = []
      for await (const [key, value] of kvdb.all()) {
        ops.push({ set: { key, val: value } })
      }
      const promises = []
      let last
      for await (const block of prop.updateIndex(ops)) {
        promises.push(this.store.put(block))
        last = block
      }
      await Promise.all(promises)
      prop.newRoot = last
      this.pending.set(name, prop)
    }

    async get (name) {
      if (!this.pending.has(name)) {
        this.pending.set(name, await this._get(name))
      }
      return this.pending.get(name)
    }

    async count (...props) {
      if (this.dirty) throw new Error('Cannot query with pending KV transactions, commit or update.')
      let count = 0
      const indexes = await Promise.all(props.map(name => this.get(name)))
      for (const index of indexes) {
        const data = await index.rootData
        count += data.count
      }
      return count
    }

    async sum (...props) {
      if (this.dirty) throw new Error('Cannot query with pending KV transactions, commit or update.')
      let sum = 0
      const indexes = await Promise.all(props.map(name => this.get(name)))
      for (const index of indexes) {
        const data = await index.rootData
        sum += data.sum
      }
      return sum
    }

    async all () {
      const data = await this.rootData
      const keys = new Set(Object.keys(data))
      const results = []
      for (const [k, prop] of this.pending.entries()) {
        keys.delete(k)
        results.push([k, prop])
      }
      const promises = Array.from(keys.keys()).map(key => this.get(key).then(prop => [key, prop]))
      return [...results, ...await Promise.all(promises)]
    }

    async update (ops) {
      const props = await this.all()
      const _update = async ([key, prop]) => prop.update(ops).then(cid => [key, cid])
      const results = await Promise.all(props.map(_update))
      const block = toBlock(Object.fromEntries(results), 'Props')
      await this.store.put(block)
      return block.cid()
    }
  }
  class Indexes {
    constructor (db) {
      chain(this, db)
      this.db = db
      lazyprop(this, 'kvroot', () => db.getRoot().then(root => root['db-v1'].kv))
      lazyprop(this, 'root', () => db.getRoot().then(root => root['db-v1'].indexes))
      lazyprop(this, 'rootBlock', () => this.root.then(cid => this.getBlock(cid)))
      lazyprop(this, 'rootData', () => this.rootBlock.then(block => block.decode()))
      this.props = new Props(this)
    }

    all () {
      return [['props', this.props]]
    }

    async update (kvRoot) {
      const prev = await this.kvroot
      const kvdb = kv(kvRoot, this.store)
      const ops = await kvdb.since(prev)

      const _update = ([key, index]) => index.update(ops).then(root => [key, root])
      const newIndexes = await Promise.all(this.all().map(_update))
      const newRoot = toBlock(Object.fromEntries(newIndexes), 'Indexes')
      await this.store.put(newRoot)
      return newRoot.cid()
    }
  }
  const emptyMap = Block.encoder({}, 'dag-cbor')
  const emptyIndexes = emptyMap.cid().then(props => toBlock({ props }, 'Indexes'))
  exports.empties = [emptyIndexes, emptyMap, emptyProp]
  exports.Indexes = Indexes
  return exports
}
