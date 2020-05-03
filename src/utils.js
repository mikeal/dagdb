const isCID = node => !!(node && node[cidSymbol])
exports.isCID = isCID
// must export before importing hamt due to circular reference
const hamt = require('./hamt')
const schema = require('./schema.json')
const validate = require('@ipld/schema-validation')(schema)
const fromBlock = (block, className) => validate(block.decode(), className)
const fromBlockUnsafe = (block, className) => validate(block.decodeUnsafe(), className)

const cidSymbol = Symbol.for('@ipld/js-cid/CID')

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

exports.Lazy = Lazy
exports.NotFound = NotFound
exports.readonly = readonly
exports.fromBlock = fromBlock
exports.fromBlockUnsafe = fromBlockUnsafe
exports.validate = validate
exports.encoderTransaction = encoderTransaction
