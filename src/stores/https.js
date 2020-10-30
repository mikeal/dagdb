import bent from 'bent'
import LRUStore from './lru.js'
import { create } from '../block.js'

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
    const buf = await this._getBuffer(this.mkurl(cid.toString()))
    const data = buf instanceof ArrayBuffer /* c8 ignore next */ ? new Uint8Array(buf) : buf
    return create({ bytes: data, cid })
  }

  _putBlock ({ cid, bytes }) {
    const url = this.mkurl(cid.toString())
    return this._put(url, bytes)
  }

  async _hasBlock (cid) {
    const resp = await this._head(this.mkurl(cid.toString()))
    if (resp.statusCode === 200) return true
    else return false /* c8 ignore next */
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

const _create = (...args) => new HttpsStore(...args)
export default _create
