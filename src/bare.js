const createDatabase = require('./database')
const CID = require('cids')
const bent = require('bent')
const getJSON = bent('json')

module.exports = (Block, ...args) => {
  const database = createDatabase(Block)
  const stores = require('./stores')(Block)
  const updaters = require('./updaters')(Block)
  const native = require('./native')
  const open = async (id, ...args) => {
    if (id.startsWith('http://') || id.startsWith('https://')) {
      const info = await getJSON(id)
      const store = stores.from(info.blockstore, ...args)
      const updater = updaters.from(info.updater, ...args)
      if (!info) {
        return database.create(store, updater, ...args)
      }
      return database(new CID(info.root), store, updater, ...args)
    }
    return native(id, ...args)
  }
  const create = async (id, ...args) => {
    let db = await open(id)
    db = await db.update()
    return db
  }
  return { create, open }
}
