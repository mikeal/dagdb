const createKVStore = require('./kv')
const { Buffer } = require('buffer')
const empty = Buffer.from('')

const ls = async function * (s3, opts) {
  opts = { ...opts }
  let data
  do {
    data = await s3.listObjectsV2(opts).promise()
    for (const entry of data.Contents) {
      yield entry.Key.slice(entry.Key.lastIndexOf('/') + 1)
    }
    if (!data.Contents.length) {
      return
    }
    opts.StartAfter = data.Contents[data.Contents.length - 1].Key
  } while (data.Contents.length)
}

module.exports = Block => {
  const KVStore = createKVStore(Block)
  class S3Store extends KVStore {
    constructor (s3, opts = {}, ...args) {
      super(opts, ...args)
      this.keyPrefix = opts.keyPrefix || ''
      this.s3 = s3
    }

    _put (arr, Body) {
      const Key = this.keyPrefix + arr.join('/')
      return this.s3.putObject({ Key, Body }).promise()
    }

    _putKey (arr) {
      return this._put(arr, empty)
    }

    async _hasKey (arr) {
      const Key = this.keyPrefix + arr.join('/')
      let resp
      try {
        resp = await this.s3.headObject({ Key }).promise()
      } catch (e) {
        // istanbul ignore else
        if (e.statusCode === 404) return false
        // istanbul ignore next
        throw e
      }
      return { length: resp.ContentLength }
    }

    async _getKey (arr) {
      const Key = this.keyPrefix + arr.join('/')
      const resp = await this.s3.getObject({ Key }).promise()
      return resp.Body
    }

    _linksFrom (key) {
      const Prefix = [this.keyPrefix + key, 'link-from'].join('/')
      return ls(this.s3, { Prefix })
    }
  }
  return (...args) => new S3Store(...args)
}
