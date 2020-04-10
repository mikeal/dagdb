const CID = require('cids')

class RootMissmatch extends Error {
  constructor (cid) {
    super('Current root CID does not match prev CID')
    this.cid = cid
  }
}

class KVUpdater {
  constructor (store) {
    this.store = store
  }
  async update (newRoot, prevRoot) {
    // Note: this implementation assumes you have a lock on the
    // underlying kv store. If you don't, this code is prone
    // to overwrite root transaction changes under high concurrent
    // load. This is why we don't use this w/ S3 and use the Dynamo
    // updater instead.
    if (!prevRoot) {
      if (await this._hasKey(['root'])) {
        throw new Error('root already set on this updater')
      }
    } else {
      let prev = new CID(await this.store._getKey(['root']))
      if (!prev.equals(prevRoot || {})) {
        return prev
      }
    }
    return _update(newRoot)
  }
  _update (newRoot) {
    const { buffer } = newRoot
    return this._put(['root'], buffer)
  }
}

module.exports = (...args) => new KVUpdater(...args)
