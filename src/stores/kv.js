import LRUStore from './lru.js'
import { CID } from 'multiformats'
import { create } from '../block.js'

class KVStore extends LRUStore {
  async graph (cid, depth = 1024, missing = new Set(), incomplete = new Set(), skips = new Set()) {
    const key = cid.toString()

    if (skips.has(key)) return
    skips.add(key)
    if (!(await this.has(cid))) {
      missing.add(key)
      return { missing }
    }

    if (cid.code === 0x55) return { complete: true }

    if (depth < 0) {
      incomplete.add(key)
      return { incomplete }
    }

    if (await this._hasKey([key, 'complete'])) return { complete: true }
    for await (const linkKey of this._linksFrom(key)) {
      if (await this._hasKey([linkKey, 'complete'])) continue
      const cid = CID.parse(linkKey)
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
    if (cid.code === 0x55) return
    const key = cid.toString()
    const ops = []
    const seen = new Set()
    for (const [, link] of block.links()) {
      const linkKey = link.toString()
      if (seen.has(linkKey)) continue
      seen.add(linkKey)
      ops.push(this._putKey([linkKey, 'link-to', key]))
      ops.push(this._putKey([key, 'link-from', linkKey]))
    }
    await Promise.all(ops)
    return seen
  }

  async _indexComplete (cid, seen = new Set()) {
    const key = cid.toString()
    const completeKeys = Array.from(seen.values()).map(key => [key, 'complete'])
    const completed = await Promise.all(completeKeys.map(key => this._hasKey(key)))
    const complete = completed.reduce((x, y) => x && y, true)
    if (complete) await this._putKey([key, 'complete'])
  }

  async _putBlock (block) {
    const { cid, bytes } = block
    if (await this.has(cid)) return
    const seen = await this._indexLinks(cid, block)
    await this._put([cid.toString(), 'encode'], bytes)
    await this._indexComplete(cid, seen)
  }

  _hasBlock (cid) {
    return this._hasKey([cid.toString(), 'encode'])
  }

  async _getBlock (cid) {
    const key = cid.toString()
    const data = await this._getKey([key, 'encode'])
    return create({ bytes: data, cid })
  }
}

export default KVStore
