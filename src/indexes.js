const { Lazy } = require('./utils')

module.exports = (Block, fromBlock) => {
  const exports = {}

  class KeyedIndex {
    constructor (obj, db) {
      this.db = db
      this.rootDecode = obj
    }
  }
  KeyedIndex.create = async (indexes, paths) => {
  }
  const typeMap = {
    keyed: ['kpi', KeyedIndex]
  }
  class Indexes extends Lazy {
    get prop () {
      return 'indexes'
    }

    async add (type, ...args) {
      const [union, Cls] = typeMap[type]
      const root = await Cls.create(this, ...args)
      return [union, root]
    }

    async get (name) {
      const block = await this._get(name)
      const decoded = fromBlock(block, 'Index')
      const [, Cls] = typeMap[name]
      return new Cls(decoded, this.db)
    }

    async update (latest) {
      // TODO: implement index update process
      return this._root
    }
  }
  exports.Indexes = Indexes
  return exports
}
