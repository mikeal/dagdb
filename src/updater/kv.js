const CID = require('cids')

const lock = (self) => {
  const p = new Promise(resolve => {
    p.unlock = () => {
      self.lock = null
      resolve()
    }
  })
  return p
}

class KVUpdater {
  constructor (store) {
    this.store = store
    this.lock = null
  }

  async update (newRoot, prevRoot) {
    // Note: this implementation assumes you have a lock on the
    // underlying kv store. If you don't, this code is prone
    // to overwrite root transaction changes under high concurrent
    // load. This is why we don't use this w/ S3 and use the Dynamo
    // updater instead.
    while (this.lock) {
      await this.lock
    }
    this.lock = lock(this)
    const prev = new CID(await this.store._getKey(['root']))
    if (!prev.equals(prevRoot || {})) {
      this.lock.unlock()
      return prev
    }
    await this._update(newRoot)
    this.lock.unlock()
    return newRoot
  }

  _update (newRoot) {
    const { buffer } = newRoot
    return this._put(['root'], buffer)
  }
}

module.exports = (...args) => new KVUpdater(...args)
