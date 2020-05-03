/* globals describe, it */
const Block = require('@ipld/block')
const CID = require('cids')
const bent = require('bent')
const inmem = require('../src/stores/inmemory')
const replicate = require('../src/stores/replicate')
const createUpdater = require('../src/updaters/kv')
const database = require('../src/database')(Block)
const createKV = require('./lib/mock-kv')
const test = it
const assert = require('assert')
const same = assert.deepStrictEqual
const ok = assert.ok

const getJSON = bent('json')

const create = async (fixture) => {
  const store = inmem()
  const updater = createUpdater(createKV())
  let db = await database.create(store, updater)
  if (fixture) {
    for (const [key, value] of Object.entries(fixture)) {
      await db.set(key, value)
    }
    db = db.update()
  }
  return db
}

const v1 = 'db-v1'

const fixture = {
  test1: { one: 1, two: 2 },
  test2: { two: 2, three: { four: 4 } }
}

describe('test-indexes', () => {
  test('basic property index', async () => {
    const load = async () => {
      const db = await create(fixture)
      await db.indexes.props.add('one')
      await db.indexes.props.add('two')
      await db.indexes.props.add('three/four')
      return db
    }
    const verify = async db => {
      same(await db.indexes.props.count('one'), 1)
      same(await db.indexes.props.count('two'), 2)
      same(await db.indexes.props.count('three/four'), 1)
      same(await db.indexes.props.sum('one'), 1)
      same(await db.indexes.props.sum('two'), 4)
      same(await db.indexes.props.sum('three/four'), 4)
    }
    let db = await load()
    await verify(db)
    db = await load()
    db = await db.update()
    await verify(db)
  })
})
