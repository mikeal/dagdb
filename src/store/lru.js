const LRU = require('lru-cache')

const defaultSize = 1024 * 1024 * 50
const getLength = block => block.encodeUnsafe().length

class LRUStore {
  constructor (opts = {}) {
    if (typeof opts.lru === 'undefined') opts.lru = true
    if (opts.lru) {
      this.lru = new LRU({ max: opts.lruSize || defaultSize, length: getLength })
    }
  }

  async get (cid) {
    if (!this.lru) return this._getBlock(cid)
    const key = cid.toString('base32')
    if (this.lru.has(key)) return this.lru.get(key)
    const block = await this._getBlock(cid)
    this.lru.set(key, block)
    return block
  }

  async put (block) {
    if (!this.lru) return this._putBlock(block)
    const key = (await block.cid()).toString('base32')
    if (this.lru.has(key)) return
    const ret = await this._putBlock(block)
    this.lru.set(key, block)
    return ret
  }

  has (cid) {
    if (!this.lru) return this._hasBlock(cid)
    const key = cid.toString('base32')
    if (this.lru.has(key)) return { length: this.lru.get(key).decodeUnsafe().length }
    return this._hasBlock(cid)
  }
}

module.exports = LRUStore
