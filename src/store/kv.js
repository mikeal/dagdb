const CID = require('cids')

module.exports = Block => {
  class KVStore {
    async graph (cid, depth = 1024, missing = new Set(), incomplete = new Set(), skips = new Set()) {
      const key = cid.toString('base32')

      if (skips.has(key)) return
      skips.add(key)
      if (!(await this.has(cid))) {
        missing.add(key)
        return { missing }
      }

      if (cid.codec === 'raw') return { complete: true }

      if (depth < 0) {
        incomplete.add(key)
        return { incomplete }
      }

      if (await this._hasKey([key, 'complete'])) return { complete: true }
      for await (const linkKey of this._linksFrom(key)) {
        if (await this._hasKey([linkKey, 'complete'])) continue
        const cid = new CID(linkKey)
        if (!(await this.has(cid))) {
          missing.add(linkKey)
          continue
        }
        if (depth < 1) {
          incomplete.add(linkKey)
          continue
        }
        await this.graph(cid, depth - 1, missing, incomplete, skips)
      }
      if (missing.size === 0 && incomplete.size === 0) {
        await this._putKey([key, 'complete'])
        return { complete: true }
      }
      const ret = {}
      if (missing.size) ret.missing = missing
      if (incomplete.size) ret.incomplete = incomplete
      return ret
    }

    async _indexLinks (cid, block) {
      if (cid.codec === 'raw') return
      const key = cid.toString('base32')
      const ops = []
      const seen = new Set()
      for (const [, link] of block.reader().links()) {
        const linkKey = link.toString('base32')
        if (seen.has(linkKey)) continue
        seen.add(linkKey)
        ops.push(this._putKey([linkKey, 'link-to', key]))
        ops.push(this._putKey([key, 'link-from', linkKey]))
      }
      await Promise.all(ops)
      return seen
    }

    async _indexComplete (cid, seen = new Set()) {
      const key = cid.toString('base32')
      const completeKeys = Array.from(seen.values()).map(key => [key, 'complete'])
      const completed = await Promise.all(completeKeys.map(key => this._hasKey(key)))
      const complete = completed.reduce((x, y) => x && y, true)
      if (complete) await this._putKey([key, 'complete'])
    }

    async put (block) {
      const cid = await block.cid()
      if (await this.has(cid)) return
      const seen = await this._indexLinks(cid, block)
      await this._put([cid.toString('base32'), 'encode'], block.encodeUnsafe())
      await this._indexComplete(cid, seen)
    }

    has (cid) {
      return this._hasKey([cid.toString('base32'), 'encode'])
    }

    async get (cid) {
      const key = cid.toString('base32')
      const data = await this._getKey([key, 'encode'])
      return Block.create(data, cid)
    }
  }

  return KVStore
}
