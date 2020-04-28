const { Lazy } = require('./utils')

module.exports = (Block) => {
  const exports = {}
  class Indexes extends Lazy {
    get prop () {
      return 'indexes'
    }

    async update (latest) {
      // TODO: implement index update process
      return this._root
    }
  }
  exports.Indexes = Indexes
  return exports
}
