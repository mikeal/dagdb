const bent = require('bent')
const LRUStore = require('./lru')

module.exports = Block => {
  class HttpsStore extends LRUStore {
    constructor (baseurl, opts) {
      super(opts)
      let url
      let params
      if (baseurl.includes('?')) {
        url = baseurl.slice(0, baseurl.indexOf('?'))
        params = (new URL(baseurl)).searchParams
      } else {
        url = baseurl
      }
      this.url = url
      this.params = params
      this._getBuffer = bent('buffer')
      this._getJSON = bent('json')
      this._put = bent('PUT', 201)
      this._head = bent('HEAD', 200, 404)
    }

    mkurl (path, params) {
      let u = this.url
      if (!u.endsWith('/')) u += '/'
      u += path
      if (!params) params = this.params
      if (params) u += `?${params.toString()}`
      return u
    }

    async _getBlock (cid) {
      const data = await this._getBuffer(this.mkurl(cid.toString('base32')))
      return Block.create(data, cid)
    }

    async _putBlock (block) {
      const cid = await block.cid()
      const url = this.mkurl(cid.toString('base32'))
      return this._put(url, block.encodeUnsafe())
    }

    async _hasBlock (cid) {
      const resp = await this._head(this.mkurl(cid.toString('base32')))
      if (resp.statusCode === 200) return true
      else return false
    }

    async graph (cid, depth) {
      let params
      if (typeof depth !== 'undefined') {
        params = new URLSearchParams(this.params)
        params.set('depth', depth)
      }
      const url = this.mkurl(cid.toString('base32') + '/graph', params)
      const info = await this._getJSON(url)
      const { result } = info
      if (result.incomplete) result.incomplete = new Set(result.incomplete)
      if (result.missing) result.missing = new Set(result.missing)
      return info.result
    }
  }
  return (...args) => new HttpsStore(...args)
}
