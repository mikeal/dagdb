/* globals describe, it */
import Block from '@ipld/block/defaults'
import createInmemory from '../src/stores/inmemory.js'
import createUpdater from '../src/updaters/kv.js'
import createDatabaseInterface from '../src/database.js'
import createKV from './lib/mock-kv.js'
import assert from 'assert'

const inmem = createInmemory(Block)
const database = createDatabaseInterface(Block)
const test = it
const same = assert.deepStrictEqual

const create = async (fixture) => {
  const store = inmem()
  const updater = createUpdater(Block)(createKV())
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
    await db.set('test4', { one: 'one' })
    db = await db.update()

    same(await count(db, 'one'), 3)
    same(await count(db, 'two'), 2)
    same(await sum(db, 'one'), 2)
    same(await sum(db, 'two'), 4)
  })
  test('non-object values', async () => {
    let db = await load()
    await db.set('string', 'test')
    // disabled, dag-cbor or block bug is blocking
    // await db.set('null', null)
    await db.set('true', true)
    await db.set('zoro', 0)
    db = await db.update()
  })
  test('remove index', async () => {
    let db = await load()
    await db.set('test3', { two: 3 })
    await db.set('test4', { two: 'two' })
    db = await db.update()
    same(await sum(db, 'two'), 7)
    same(await count(db, 'two'), 4)
    await db.del('test3')
    await db.del('test4')
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
  test('traverse link', async () => {
    let db = await load()
    const link = await db.link({ four: 4 })
    await db.set('withLink', { three: link })

    db = await db.update()
    const three = [
      {
        key: 'withLink',
        prop: 'three/four',
        value: 4
      },
      {
        key: 'test2',
        prop: 'three/four',
        value: 4
      }
    ]
    await sameEntries(db, 'three/four', three)
  })

  test('errors', async () => {
    const db = await load()
    let threw = true
    try {
      await db.indexes.props.get('nope')
      threw = false
    } catch (e) {
      if (e.message !== 'No property index for "nope"') throw e
    }
    same(threw, true)
    await db.set('another', 'test')
    same(await db.dirty, 1)
    same(await db.indexes.dirty, 1)
    same(await db.indexes.props.dirty, 1)

    const message = 'Cannot create new index with pending KV transactions, commit or update.'
    let methods = [
      'count',
      'sum'
    ]
    for (const method of methods) {
      try {
        await db.indexes.props[method]()
        threw = false
      } catch (e) {
        if (e.message !== message) throw e
      }
      same(threw, true)
    }
    methods = [
      'sources',
      'values',
      'entries'
    ]
    const noop = () => {}
    for (const method of methods) {
      try {
        for await (const b of db.indexes.props[method]()) {
          noop(b)
        }
        threw = false
      } catch (e) {
        if (e.message !== message) throw e
      }
      same(threw, true)
    }
  })
})
