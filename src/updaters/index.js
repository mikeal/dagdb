import bent from 'bent'
import inmem from './inmemory.js'
import { CID } from 'multiformats'

const getJSON = bent('json')

class HttpUpdater {
  get root () {
    return this.info().then(info => CID.from(info.root))
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
    return CID.from(info.root)
  }
}
const fromId = async (id, ...args) => {
  if (id.startsWith('http://') || /* istanbul ignore next */ id.startsWith('https://')) {
    return new HttpUpdater(id, ...args)
  }
  throw new Error(`Unsupported identifier "${id}"`) /* c8 ignore next */
}
const create = async (id, ...args) => {
  if (id === 'inmem' || id === 'inmemory') {
    return inmem()
  }
  throw new Error('Not implemented') /* c8 ignore next */
}

export { fromId, create }
