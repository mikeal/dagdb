import * as hamt from './hamt.js'
import schema from './schema.js'
import createValidate from '@ipld/schema-validation'

const isCID = node => node.asCID === node
const validate = createValidate(schema)

const fromBlock = (block, className) => validate(block.decode(), className)
const fromBlockUnsafe = (block, className) => validate(block.decodeUnsafe(), className)

const readonly = (source, key, value) => {
  Object.defineProperty(source, key, { value, writable: false })
}

class NotFound extends Error {
  get statusCode () {
    return 404
  }

  get kvs () {
    return 'notfound'
  }
}

const encoderTransaction = async function * (iter) {
  let last
  for await (const block of iter) {
    last = block
    yield block
  }
  yield last.cid()
}

class Lazy {
  constructor (db) {
    const root = db.getRoot().then(root => root['db-v1'][this.prop])
    readonly(this, '_root', root)
    this.db = db
    this.pending = new Map()
    this.store = db.store
    this.getBlock = db.store.get.bind(db.store)
  }

  async _get (name, Cls, typeName) {
    if (this.pending.has(name)) return this.pending.get(name)
    const root = await this._root
    const cid = await hamt.get(root, name, this.getBlock)
    if (!cid) throw new Error(`No ${typeName.toLowerCase()} named "${name}"`)
    const block = await this.db.store.get(cid)
    const decoded = fromBlock(block, typeName)
    return new Cls(decoded, this.db)
  }
}

const chain = (child, parent) => {
  Object.defineProperty(child, 'dirty', { get: () => parent.dirty })
  readonly(child, 'store', parent.store)
  readonly(child, 'getBlock', parent.getBlock || parent.store.get.bind(parent.store))
}

export { Lazy, NotFound, readonly, fromBlock, fromBlockUnsafe, validate, encoderTransaction, chain, isCID }
