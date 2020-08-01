import createDatabase from './database.js'
import bent from 'bent'
import createStores from './stores/index.js'
import createUpdaters from './updaters/index.js'

const getJSON = bent('json')

const isHttp = id => {
  if (typeof id !== 'string') return false
  return id.startsWith('http://') || id.startsWith('https://')
}

export default (Block, ...args) => {
  const { CID } = Block
  const database = createDatabase(Block)
  const stores = createStores(Block)
  const updaters = createUpdaters(Block)
  const getInfo = async (id, ...args) => {
    const info = await getJSON(id)
    if (!id.endsWith('/')) id += '/'
    const rel = str => (new URL(str, id)).toString()
    const store = await stores.from(rel(info.blockstore), ...args)
    const updater = await updaters.from(id, rel(info.updater), ...args)
    return { info, store, updater }
  }
  const open = async (id, ...args) => {
    if (isHttp(id)) {
      const { info, store, updater } = await getInfo(id, ...args)
      if (!info.root) throw new Error('Database has not been created')
      return database(new CID(info.root), store, updater, ...args)
    } else if (typeof id === 'object') {
      let { root, store, updater } = id
      if (id.leveldown || id.s3 || id.browser) {
        store = await stores.from(id, ...args)
        updater = await updaters.kv(store, id.updateKey)
        root = await updater.root
      }
      return database(root, store, updater, ...args)
    }
    throw new Error('Not implemented') /* c8 ignore next */
  }
  const create = async (id, ...args) => {
    if (isHttp(id)) {
      const { info, store, updater } = await getInfo(id, ...args)
      if (info.root) throw new Error('Database already created')
      return database.create(store, updater, ...args)
    } else {
      let store
      let updater
      if (id.leveldown || id.s3 || id.browser) {
        store = await stores.create(id, ...args)
        updater = await updaters.kv(store, id.updateKey)
      } else {
        store = await stores.create(id, ...args)
        updater = await updaters.create(id, ...args)
      }
      return database.create(store, updater, ...args)
    } /* c8 ignore next */
  }
  return { create, open }
}
