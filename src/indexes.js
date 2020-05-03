const { validate } = require('./utils')

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
  const exports = {}

  class Prop {
    constructor (props, root) {
      this.root = root
      lazyprop(this, 'rootBlock', () => this.root.then(cid => props.indexes.getBlock(cid)))
      lazyprop(this, 'rootData', () => this.rootBlock.then(block => block.decode()))
    }
  }

  class Props {
    constructor (indexes) {
      this.indexes = indexes
      lazyprop(this, 'root', () => indexes.rootData.then(data => data.props))
      lazyprop(this, 'rootBlock', () => this.root.then(cid => indexes.getBlock(cid)))
      lazyprop(this, 'rootData', () => this.rootBlock.then(block => block.decode()))
      this.pending = new Map()
    }

    async _get (name) {
      const root = await this.rootData
      if (!root[name]) throw new Error(`No property index for "${name}"`)
      return new Prop(this, root[name])
    }

    async add (name) {
      const db = this.indexes.db
      const head = (await db.getRoot())['db-v1'].kv
      const kvdb = kv(head, db.store)
      for await (const [key, value] of kvdb.all()) {
        console.log({key, value})
      }
    }

    get (name) {
      if (!this.pending.has(name)) {
        this.pending.set(name, this._get(name))
      }
      return this.pending.get(name)
    }

    async count (...props) {
      let count = 0
      const indexes = await Promise.all(props.map(name => this.get(name)))
      for (const index of indexes) {
        const data = index.rootData
        count += data.count
      }
      return count
    }

    async sum (...props) {
      let sum = 0
      const indexes = await Promise.all(props.map(name => this.get(name)))
      for (const index of indexes) {
        const data = index.rootData
        sum += data.count
      }
      return sum
    }
  }
  class Indexes {
    constructor (db) {
      this.db = db
      this.store = db.store
      this.getBlock = db.store.get.bind(db.store)
      lazyprop(this, 'root', () => db.getRoot().then(root => root['db-v1'].indexes))
      lazyprop(this, 'rootBlock', () => this.root.then(cid => this.getBlock(cid)))
      lazyprop(this, 'rootData', () => this.rootBlock.then(block => block.decode()))
      this.props = new Props(this)
    }
    async update (kvRoot) {
      return kvRoot
    }
  }
  const emptyMap = Block.encoder({}, 'dag-cbor')
  const emptyIndexes = emptyMap.cid().then(props => toBlock({ props }, 'Indexes'))
  exports.empties = [ emptyIndexes, emptyMap ]
  exports.Indexes = Indexes
  return exports
}
