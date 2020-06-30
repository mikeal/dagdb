import Block from '@ipld/block/defaults.js'
import createStore from '../../src/stores/kv.js'
import { encode, decode } from 'charwise'

const KVStore = createStore(Block)

class NotFound extends Error {
  get statusCode () {
    return 404
  }
}

const asyncGen = async function * (arr) {
  yield * arr
}

class InMemoryStore extends KVStore {
  constructor (...args) {
    super(...args)
    this.storage = {}
  }

  async _put (arr, data) {
    this.storage[encode(arr)] = data
  }

  _putKey (arr) {
    return this._put(arr, true)
  }

  _hasKey (arr) {
    return !!this.storage[encode(arr)]
  }

  async _getKey (arr) {
    const key = encode(arr)
    if (!this.storage[key]) throw new NotFound('Not found')
    return this.storage[key]
  }

  _linksFrom (key) {
    const start = encode([key, 'link-from', 0])
    const end = encode([key, 'link-from', []])
    const keys = Object.keys(this.storage).sort()
    const cids = keys.filter(s => s > start && s < end).map(k => decode(k)[2])
    return asyncGen(cids)
  }
}

export default (...args) => new InMemoryStore(...args)
