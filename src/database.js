const { NotFound, readonly, isCID, fromBlock, validate } = require('./utils')
const createKV = require('./kv')

module.exports = async (Block, codec = 'dag-cbor') => {
  const toBlock = (value, className) => Block.encoder(validate(value, className), codec)
  const kv = await createKV(Block, codec)

  class Database {
    constructor (root, store) {
      this.root = root
      this.store = store
    }

    tags () {
      const iter = async function * (self) {
        const db = await fromBlock(await self.store.get(self.root), 'Database')
        const trans = db['db-v1'].tags
        const kvs = kv(trans, self.store)
        for await (const [tag, _kv] of kvs.all()) {
          console.log({ tag, _kv })
        }
      }
      return iter(this)
    }
  }

  const exports = (...args) => new Database(...args)

  // empty database
  const [emptyKV] = kv.empties
  const _kvl = await emptyKV.cid()
  const empty = toBlock({ 'db-v1': { tags: _kvl, indexes: _kvl } }, 'Database')
  exports.empty = empty
  exports.empties = [empty, ...kv.empties]

  exports.open = (root, store) => new Database(root, store)
  exports.create = async store => {
    await Promise.all(exports.empties.map(block => store.put(block)))
    const root = await empty.cid()
    return new Database(root, store)
  }
}
