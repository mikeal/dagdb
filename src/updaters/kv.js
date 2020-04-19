const CID = require('cids')

const lock = (self) => {
  let _resolve
  const p = new Promise(resolve => {
    _resolve = resolve
  })
  const unlock = () => {
    self.lock = null
    _resolve()
  }
  return { p, unlock }
}

class KVUpdater {
  constructor (store) {
    this.store = store
    this.lock = null
  }

  get root () {
    return this.store._getKey(['root']).then(buff => new CID(buff))
  }

  async update (newRoot, prevRoot) {
    // Note: this implementation assumes you have a lock on the
    // underlying kv store. If you don't, this code is prone
    // to overwrite root transaction changes under high concurrent
    // load. This is why we don't use this w/ S3 and use the Dynamo
    // updater instead.
    while (this.lock) {
      await this.lock.p
    }
    this.lock = lock(this)
    if (!(await this.store._hasKey(['root']))) {
      if (prevRoot) throw new Error('There is no previous root')
    } else {
      const prev = new CID(await this.store._getKey(['root']))
      if (!prev.equals(prevRoot)) {
        this.lock.unlock()
        return prev
      }
    }
    await this._update(newRoot)
    this.lock.unlock()
    return newRoot
  }

  _update (newRoot) {
    const { buffer } = newRoot
    return this.store._put(['root'], buffer)
  }
}

module.exports = (...args) => new KVUpdater(...args)
