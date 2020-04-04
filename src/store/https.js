const bent = require('bent')

module.exports = Block => {
  class HttpsStore {
    constructor (baseurl) {
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
      if (path) {
        if (!u.endsWith('/')) u += '/'
        u += path
      }
      if (!params) params = this.params
      if (params) u += `?${params.toString()}`
      return u
    }

    async get (cid) {
      const data = await this._getBuffer(this.mkurl(cid.toString('base32')))
      return Block.create(data, data.codec)
    }

    async put (block) {
      const cid = await block.cid()
      await this._put(this.mkurl(cid.toString('base32')), block.encodeUnsafe())
    }

    async has (cid) {
      const resp = await this._head(this.mkurl(cid.toString('base32')))
      if (resp.status === 200) return true
      else return false
    }

    async graph (cid, depth, missing, incomplete, skips) {
      let params
      if (typeof depth !== 'undefined') {
        params = new URLSearchParams(this.params)
        for (const [key, value] of Object.entries({ depth, missing, incomplete, skips })) {
          if (typeof value !== 'undefined') {
            params.set(key, value instanceof Set ? Array.from(value) : value)
          }
        }
      }
      const url = this.mkurl(cid.toString('base32') + '/graph', params)
      const info = await this._getJSON(url)
      return info.result
    }
  }
  return (...args) => new HttpsStore(...args)
}
