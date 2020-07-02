import createKVStore from './kv.js'

const empty = new Uint8Array(0)

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
  } /* c8 ignore next */ while (data.Contents.length)
}

export default Block => {
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
        /* c8 ignore next */
        if (e.statusCode === 404) return false /* c8 ignore next */
        /* c8 ignore next */
        throw e
        /* c8 ignore next */
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
