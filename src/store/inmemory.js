const CID = require('cids')

class Missing extends Error {
  get statusCode () {
    return 404
  }
}

class InMemory {
  constructor () {
    this.storage = new Map()
    this.links = { to: new Map(), from: new Map() }
    this.complete = new Set()
  }

  async graph (cid, depth = 1024, missing = new Set(), incomplete = new Set(), skips = new Set()) {
    // returns the graph information for the given CID
    const key = cid.toString('base32')

    if (skips.has(key)) return
    skips.add(key)
    if (this.complete.has(key)) return { complete: true }

    if (!(await this.has(cid))) {
      missing.add(key)
      return { missing }
    }
    if (cid.codec === 'raw') return { complete: true }

    if (depth < 0) {
      incomplete.add(key)
      return { incomplete }
    }

    for (const linkKey of this.links.from.get(key).keys()) {
      if (this.complete.has(linkKey)) continue
      if (!this.links.from.has(linkKey)) {
        missing.add(linkKey)
        continue
      }
      if (depth < 1) {
        incomplete.add(linkKey)
        continue
      }
      await this.graph(new CID(linkKey), depth - 1, missing, incomplete, skips)
    }
    if (missing.size === 0 && incomplete.size === 0) {
      this.complete.add(key)
      return { complete: true }
    }
    const ret = {}
    if (missing.size) ret.missing = missing
    if (incomplete.size) ret.incomplete = incomplete
    return ret
  }

  _index (cid, block) {
    const key = cid.toString('base32')
    if (this.links.from.has(key)) {
      return // already indexed this block
    }
    const _from = new Set()
    this.links.from.set(key, _from)
    if (cid.codec === 'raw') return
    let complete = true
    for (const [, link] of block.reader().links()) {
      const linkKey = link.toString('base32')
      if (!this.links.to.has(linkKey)) this.links.to.set(linkKey, new Set())
      this.links.to.get(linkKey).add(key)
      _from.add(linkKey)
      if (!this.complete.has(linkKey)) complete = false
    }
    if (complete) this.complete.add(key)
  }

  _put (cid, block) {
    this.storage.set(cid.toString('base32'), block)
  }

  async put (block) {
    const cid = await block.cid()
    this._put(cid, block)
    this._index(cid, block)
  }

  has (cid) {
    const key = cid.toString('base32')
    if (!this.links.from.has(key)) {
      return false
    } else {
      const length = this.storage.get(key).encodeUnsafe().length
      return new Promise(resolve => resolve({ length }))
    }
  }

  async get (cid) {
    const key = cid.toString('base32')
    const value = this.storage.get(key)
    if (!value) throw new Missing(`Do not have ${key} in store`)
    return value
  }
}

module.exports = (...args) => new InMemory(...args)
