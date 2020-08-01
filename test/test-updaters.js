/* globals describe, it */
import dagdb from '../src/index.js'
import memdown from 'memdown'
import createS3 from './lib/mock-s3.js'
import { deepStrictEqual as same, ok } from 'assert'

const test = it

const updateTests = create => {
  test('basics', async () => {
    let db = await create()
    const oldcid = db.root
    db = await db.set('hello', 'world').update()
    same(await db.get('hello'), 'world')
    db = await dagdb.open({ ...db, root: db.root })
    same(await db.get('hello'), 'world')
    same(db.root, await db.updater.root)

    db = await dagdb.open({ ...db, root: oldcid })
    await db.set('hello', 'world')
    db = await db.commit()
    await db.set('hello', 'another')
    db = await db.update()
    same(await db.get('hello'), 'another')

    db = await dagdb.open({ ...db, root: oldcid })
    await db.set('hello', 'nope')
    let threw = true
    try {
      db = await db.update()
      threw = false
    } catch (e) {
      if (!e.message.includes('Conflict, databases contain conflicting mutations')) throw e
    }
    ok(threw)
  })
}

const openTests = mkopts => {
  test('open', async () => {
    const opts = mkopts()
    let db = await dagdb.create(opts)
    await db.set('hello', 'world')
    db = await db.update()
    same(await db.get('hello'), 'world')
    db = await dagdb.open(opts)
    same(await db.get('hello'), 'world')
    same(db.root, await db.updater.root)

    await db.set('hello', 'world2')
    db = await db.update()

    db = await dagdb.open(opts)
    same(await db.get('hello'), 'world2')
    same(db.root, await db.updater.root)
  })
}

const addTests = mkopts => {
  updateTests(() => dagdb.create(mkopts()))
  openTests(mkopts)
}

describe('inmem', () => {
  updateTests(() => dagdb.create('inmem'))
})

const rand = () => Math.random().toString()

describe('level memdown', () => {
  const mkopts = () => ({ leveldown: memdown(rand()) })
  addTests(mkopts)
})

describe('s3', () => {
  const mkopts = () => ({ s3: createS3() })
  addTests(mkopts)
})

if (process.browser) {
  describe('browser', () => {
    addTests(() => ({ browser: true, updateKey: rand() }))
  })
}
