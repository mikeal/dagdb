import { CID } from 'multiformats'

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

const getRoot = async updater => {
  let buff
  try {
    buff = await updater.store._getKey([updater.updateKey])
  } catch (e) {
    if (e.message.toLowerCase().includes('not found')) {
      return null
    } /* c8 ignore next */ else {
      /* c8 ignore next */
      throw e
      /* c8 ignore next */
    }
  }
  return CID.decode(buff)
}

class KVUpdater {
  constructor (store, updateKey = 'root') {
    this.store = store
    this.lock = null
    this.updateKey = updateKey
  }

  get root () {
    return getRoot(this)
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
    if (!(await this.store._hasKey([this.updateKey]))) {
      if (prevRoot) throw new Error('There is no previous root')
    } else {
      const prev = CID.decode(await this.store._getKey([this.updateKey]))
      if (!prevRoot || !prev.equals(prevRoot)) {
        this.lock.unlock()
        return prev
      }
    }
    await this._update(newRoot)
    this.lock.unlock()
    return newRoot
  }

  _update (newRoot) {
    const { bytes } = newRoot
    return this.store._put([this.updateKey], bytes)
  }
}

const create = (...args) => new KVUpdater(...args)
export default create
