/* globals describe, it */
const Block = require('@ipld/block')
const inmem = require('../src/stores/inmemory')
const createUpdater = require('../src/updaters/kv')
const database = require('../src/database')(Block)
const createKV = require('./lib/mock-kv')
const test = it
const assert = require('assert')
const same = assert.deepStrictEqual

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

const fixture = {
  test1: { one: 1, two: 2 },
  test2: { two: 2, three: { four: 4 } }
}
const load = async () => {
  const db = await create(fixture)
  await db.indexes.props.add('one')
  await db.indexes.props.add('two')
  await db.indexes.props.add('three/four')
  return db
}
describe('test-indexes', () => {
  test('basic property index', async () => {
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
  test('update property index', async () => {
    let db = await load()
    await db.set('test3', { two: 3 })
    db = await db.update()
    same(await db.indexes.props.sum('two'), 7)
  })
})
