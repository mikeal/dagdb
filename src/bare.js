import createDatabase from './database.js'
import bent from 'bent'
import createStores from './stores/index.js'
import createUpdaters from './updaters/index.js'

const getJSON = bent('json')

const isHttp = id => {
  if (typeof id !== 'string') return false
  return id.startsWith('http://') || id.startsWith('https://')
}

export default (Block, opts = {}) => {
  const { lfs, fileUpdater } = opts
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
  const mklfs = async (id, ...args) => {
    const { repo, user, updateFile, token, blockstoreFile, disableCache } = id['git+lfs']
    const store = await lfs(blockstoreFile, repo, user, token, disableCache )
    const updater = await fileUpdater(updateFile /* c8 ignore next */ || './root.cid')
    return { store, updater }
  }
  const open = async (id, ...args) => {
    /* c8 ignore next */
    if (id === 'github-action') {
      /* c8 ignore next */
      const store = await lfs()
      /* c8 ignore next */
      const updater = await fileUpdater('./root.cid', { commit: true })
      /* c8 ignore next */
      return database(updater.root, store, updater)
      /* c8 ignore next */
    }
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
      } else if (id['git+lfs']) {
        const resp = await mklfs(id)
        store = resp.store
        updater = resp.updater
        root = updater.root
      }
      return database(root, store, updater, ...args)
    }
    throw new Error('Not implemented') /* c8 ignore next */
  }
  const create = async (id, ...args) => {
    /* c8 ignore next */
    if (id === 'github-action') {
      /* c8 ignore next */
      const store = await lfs()
      /* c8 ignore next */
      const updater = await fileUpdater('./root.cid', { commit: true })
      /* c8 ignore next */
      return database.create(store, updater)
      /* c8 ignore next */
    }
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
      } else if (id['git+lfs']) {
        const resp = await mklfs(id)
        store = resp.store
        updater = resp.updater
      } else {
        store = await stores.create(id, ...args)
        updater = await updaters.create(id, ...args)
      }
      return database.create(store, updater, ...args)
    } /* c8 ignore next */
  }
  return { create, open }
}
