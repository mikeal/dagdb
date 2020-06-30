import bent from 'bent'
import getJSON from 'json'
import createKVUpdater from './kv.js'

export default Block => {
  const { CID } = Block
  class HttpUpdater {
    get root () {
      return this.info().then(info => new CID(info.root))
    }

    constructor (infoUrl, updateUrl) {
      this.infoUrl = infoUrl
      this.updateUrl = updateUrl
    }

    info () {
      return getJSON(this.infoUrl)
    }

    async update (newRoot, oldRoot) {
      const url = new URL(this.updateUrl)
      url.searchParams.set('new', newRoot.toString('base32'))
      if (oldRoot) url.searchParams.set('old', oldRoot.toString('base32'))
      else url.searchParams.set('old', 'null')
      const info = await getJSON(url.toString())
      return new CID(info.root)
    }
  }
  const from = async (id, ...args) => {
    if (id.startsWith('http://') || /* istanbul ignore next */ id.startsWith('https://')) {
      return new HttpUpdater(id, ...args)
    }
    throw new Error(`Unsupported identifier "${id}"`)
  }
  return { from, kv: createKVUpdater(CID) }
}
