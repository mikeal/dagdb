const createKV = require('./kv')
const levelup = require('levelup')
const encoding = require('encoding-down')
const charwise = require('charwise')
const { Buffer } = require('buffer')
const empty = Buffer.from('')

const ls = (lev, gt, lt) => new Promise((resolve, reject) => {
  // for some reason you can't convert the level
  // readable stream into an async generator ;(
  const keys = []
  const opts = { gt, lt }
  const stream = lev.createKeyStream(opts)
  stream.on('data', key => keys.push(key[3]))
  stream.on('error', reject)
  stream.on('end', () => resolve(keys))
})

const lsIter = async function * (lev, gt, lt) {
  const keys = await ls(lev, gt, lt)
  yield * keys
}

module.exports = Block => {
  const KVStore = createKV(Block)
  class LevelStore extends KVStore {
    constructor (leveldown, opts = {}, ...args) {
      super(opts, ...args)
      this.lev = levelup(encoding(leveldown, { valueEncoding: 'binary', keyEncoding: charwise }))
      this.prefix = opts.prefix || '_dagdb-bs'
    }

    _mkey (arr) {
      return [this.prefix, ...arr]
    }

    _put (arr, body) {
      return this.lev.put(this._mkey(arr), body)
    }

    _putKey (arr) {
      return this._put(arr, empty)
    }

    async _hasKey (arr) {
      let resp
      try {
        resp = await this.lev.get(this._mkey(arr))
      } catch (e) {
        // istanbul ignore else
        if (e.status === 404) return false
        // istanbul ignore next
        throw e
      }
      return { length: resp.length }
    }

    async _getKey (arr) {
      try {
        return await this.lev.get(this._mkey(arr))
      } catch (e) {
        e.statusCode = e.status
        throw e
      }
    }

    _linksFrom (key) {
      const start = this._mkey([key, 'link-from', 0])
      const end = this._mkey([key, 'link-from', []])
      return lsIter(this.lev, start, end)
    }
  }
  return (...args) => new LevelStore(...args)
}
