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

const entries = async (db, name) => {
  const results = []
  for await (const result of db.indexes.props.entries(name)) {
    results.push(result)
  }
  return results
}
const sum = (db, name) => db.indexes.props.sum(name)
const count = (db, name) => db.indexes.props.count(name)

const sameEntries = async (db, name, comp) => {
  const ents = await entries(db, name)
  ents.forEach(ent => { delete ent.source })
  same(ents, comp)
}

describe('test-indexes', () => {
  test('basic property index', async () => {
    const verify = async db => {
      await sameEntries(db, 'one', [{ prop: 'one', key: 'test1', value: 1 }])
      const two = [
        { prop: 'two', key: 'test1', value: 2 },
        { prop: 'two', key: 'test2', value: 2 }
      ]
      await sameEntries(db, 'two', two)
      await sameEntries(db, 'three/four', [{ prop: 'three/four', key: 'test2', value: 4 }])

      same(await count(db, 'one'), 1)
      same(await count(db, 'two'), 2)
      same(await count(db, 'three/four'), 1)
      same(await sum(db, 'one'), 1)
      same(await sum(db, 'two'), 4)
      same(await sum(db, 'three/four'), 4)
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
    same(await sum(db, 'two'), 7)
    same(await count(db, 'two'), 3)

    same(await count(db, 'one'), 1)
    same(await sum(db, 'one'), 1)
    await db.set('test3', { one: 1 })
    db = await db.update()

    same(await count(db, 'one'), 2)
    same(await count(db, 'two'), 2)
    same(await sum(db, 'one'), 2)
    same(await sum(db, 'two'), 4)
  })
  test('remove index', async () => {
    let db = await load()
    await db.set('test3', { two: 3 })
    db = await db.update()
    same(await sum(db, 'two'), 7)
    same(await count(db, 'two'), 3)
    await db.del('test3')
    db = await db.update()
    same(await sum(db, 'two'), 4)
    same(await count(db, 'two'), 2)
  })
  test('string value in index', async () => {
    let db = await load()
    await db.set('string', { two: 'two' })
    db = await db.update()
    const two = [
      { prop: 'two', key: 'test1', value: 2 },
      { prop: 'two', key: 'string', value: 'two' },
      { prop: 'two', key: 'test2', value: 2 }
    ]
    await sameEntries(db, 'two', two)
    same(await sum(db, 'two'), 4)
    same(await count(db, 'two'), 3)
  })
  test('values, sources', async () => {
    const db = await load()
    const values = [2, 2]
    for await (const val of db.indexes.props.values('two')) {
      same(val, values.shift())
    }
    const sources = [
      { one: 1, two: 2 },
      { two: 2, three: { four: 4 } }
    ]
    for await (const source of db.indexes.props.sources('two')) {
      same(source, sources.shift())
    }
  })
  test('uniques', async () => {
    let db = await load()
    const fixture = { hello: 'world', one: 'one', two: 'two' }
    await db.set('fixture', fixture)
    await db.set('fixtureCopy', fixture)
    db = await db.update()
    let gen = db.indexes.props.sources('two', { uniqueSources: true })
    let sources = [
      { hello: 'world', one: 'one', two: 'two' },
      { one: 1, two: 2 },
      { two: 2, three: { four: 4 } }
    ]
    for await (const source of gen) {
      same(source, sources.shift())
    }
    gen = db.indexes.props.sources('two', 'one')
    sources = [
      { hello: 'world', one: 'one', two: 'two' },
      { one: 1, two: 2 },
      { hello: 'world', one: 'one', two: 'two' },
      { two: 2, three: { four: 4 } },
      { hello: 'world', one: 'one', two: 'two' },
      { one: 1, two: 2 },
      { hello: 'world', one: 'one', two: 'two' }
    ]
    for await (const source of gen) {
      same(source, sources.shift())
    }
    gen = db.indexes.props.sources('two', 'one', { uniqueKeys: true })
    sources = [
      { hello: 'world', one: 'one', two: 'two' },
      { one: 1, two: 2 },
      { hello: 'world', one: 'one', two: 'two' },
      { two: 2, three: { four: 4 } }
    ]
    for await (const source of gen) {
      same(source, sources.shift())
    }
  })
})
