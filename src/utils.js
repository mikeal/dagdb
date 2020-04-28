const schema = require('./schema.json')
const validate = require('ipld-schema-validation')(schema)
const fromBlock = (block, className) => validate(block.decode(), className)
const fromBlockUnsafe = (block, className) => validate(block.decodeUnsafe(), className)

const cidSymbol = Symbol.for('@ipld/js-cid/CID')
const isCID = node => !!(node && node[cidSymbol])

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
    this._get = db.store.get.bind(db.store)
  }
}

module.exports = {
  Lazy,
  NotFound,
  readonly,
  isCID,
  fromBlock,
  fromBlockUnsafe,
  validate,
  encoderTransaction
}
