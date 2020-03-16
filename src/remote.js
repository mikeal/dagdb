const createKV = require('./kv')
const { fromBlock } = require('./util')

module.exports = (Block, codec) => {
  const { KV } = createKV(Block, codec)
  class Remote extends KV {
    async getHead () {
      const block = await this.store.get(this.root)
      const head = fromBlock(block, 'HamtRootNode')
      return head
    }
  }
  const exports = (...args) => new Remote(...args)
  exports.Remote = Remote
  return exports
}
