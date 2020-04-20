const createDatabase = require('./database')
const CID = require('cids')
const bent = require('bent')
const getJSON = bent('json')

const isHttp = id => id.startsWith('http://') || id.startsWith('https://')

module.exports = (Block, ...args) => {
  const database = createDatabase(Block)
  const stores = require('./stores')(Block)
  const updaters = require('./updaters')(Block)
  const native = require('./native')
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
    }
    return native(id, ...args)
  }
  const create = async (id, ...args) => {
    if (isHttp(id)) {
      const { info, store, updater } = await getInfo(id, ...args)
      if (info.root) throw new Error('Database already created')
      return database.create(store, updater, ...args)
    }
    return native.create(id, ...args)
  }
  return { create, open }
}
